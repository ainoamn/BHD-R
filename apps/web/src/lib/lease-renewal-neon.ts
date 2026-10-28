import 'server-only';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  approvalRequests,
  contractTemplates,
  contracts,
  leases,
  parties,
  properties,
  units,
  workflowEvents,
} from '@bhd-r/db';
import {
  formatChildContractReference,
  nextChildContractSequence,
} from '@bhd-r/domain';
import { sanitizeRichText } from '@bhd-r/security';
import {
  buildRenewalTermsDraft,
  type RenewalPreviousMeters,
} from '@/lib/lease-terms-draft-from';
import type { LeaseTermsDraft, PaymentFrequency, PaymentMethod } from '@/lib/lease-terms';
import type { PropertyRecordTenant, PropertyRecordUnit } from '@/lib/property-records-neon';
import { withinViewerTenant } from '@/lib/portal-ops-data';

function fail(code: string): never {
  throw new Error(code);
}

export type CreateLeaseRenewalInput = {
  templateVersionId: string;
  endsOn: string;
  rent?: { amountMinor: string; currency: string } | undefined;
  additionalTerms?: string | undefined;
  graceDays?: number | undefined;
  graceAsDiscount?: boolean | undefined;
  graceAmount?: { amountMinor: string; currency: string } | undefined;
  adjustments?: ReadonlyArray<{
    kind: 'add' | 'discount';
    title: string;
    amount: { amountMinor: string; currency: string };
  }>;
  paymentMethod?: 'cheque' | 'cash' | 'bank_transfer' | undefined;
  paymentFrequency?:
    | 'monthly'
    | 'bimonthly'
    | 'quarterly'
    | 'semiannual'
    | 'annual'
    | undefined;
  months?: number | undefined;
  cheques?: ReadonlyArray<{
    bankName: string;
    chequeNumber: string;
    amount: { amountMinor: string; currency: string };
    dueOn: string;
  }>;
  leaseTerms?: Record<string, unknown> | null | undefined;
  chequeAccountName?: string | null | undefined;
  chequeBankName?: string | null | undefined;
  rentBankAccountId?: string | null | undefined;
};

export type LeaseRenewalTenantSeed = {
  partyId: string;
  entityType: 'person' | 'company';
  nameAr: string;
  nameEn: string;
  civilId: string;
  passport: string;
  nationality: string;
  crNumber: string;
  crExpiry: string;
  signatoryName: string;
  signatoryCivilId: string;
  signatoryNationality: string;
  phone: string;
  email: string;
};

export type LeaseRenewalContext = {
  lease: {
    id: string;
    status: string;
    startsOn: string;
    endsOn: string;
    rentMinor: string;
    depositMinor: string | null;
    currency: string;
    billingDay: number;
    contractId: string | null;
    unitId: string;
    ownerPartyId: string;
    tenantPartyId: string;
  };
  contract: {
    id: string;
    reference: string | null;
    status: string;
    graceDays: number;
    graceAmountMinor: string | null;
  } | null;
  property: { id: string; nameAr: string; nameEn: string };
  unit: PropertyRecordUnit;
  ownerName: string;
  tenantName: string;
  tenant: PropertyRecordTenant;
  initialTenant: LeaseRenewalTenantSeed;
  /** Prefill for LeaseContractForm — VAT, extras, payee, deposit from previous contract. */
  initialTerms: LeaseTermsDraft;
  /** Prior meter readings kept on the renewal form while optional new ones can be added. */
  previousMeters: RenewalPreviousMeters;
  defaultTemplateVersionId: string;
  /** Day after current endsOn — start of the renewed period. */
  renewalStartsOn: string;
  templates: Array<{
    id: string;
    key: string;
    version: number;
    language: string;
  }>;
};

function snapshotNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return null;
}

function snapshotText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asPaymentMethod(value: unknown): PaymentMethod | null {
  return value === 'cheque' || value === 'cash' || value === 'bank_transfer' ? value : null;
}

function asPaymentFrequency(value: unknown): PaymentFrequency | null {
  return value === 'monthly' ||
    value === 'bimonthly' ||
    value === 'quarterly' ||
    value === 'semiannual' ||
    value === 'annual'
    ? value
    : null;
}

export async function loadLeaseRenewalContext(
  claims: SessionClaims,
  leaseId: string,
): Promise<LeaseRenewalContext | null> {
  return withinViewerTenant(claims, async (tx) => {
    const orgId = claims.organizationId!;
    const lease = await tx.query.leases.findFirst({
      where: and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)),
    });
    if (!lease || lease.status !== 'active' || !lease.contractId) return null;

    const [contract, unit, owner, tenant, templateRows] = await Promise.all([
      tx.query.contracts.findFirst({
        where: and(eq(contracts.id, lease.contractId), eq(contracts.organizationId, orgId)),
      }),
      tx.query.units.findFirst({
        where: and(eq(units.id, lease.unitId), eq(units.organizationId, orgId)),
      }),
      tx.query.parties.findFirst({
        where: and(eq(parties.id, lease.ownerPartyId), eq(parties.organizationId, orgId)),
      }),
      tx.query.parties.findFirst({
        where: and(eq(parties.id, lease.tenantPartyId), eq(parties.organizationId, orgId)),
      }),
      tx
        .select({
          id: contractTemplates.id,
          key: contractTemplates.key,
          version: contractTemplates.version,
          language: contractTemplates.language,
        })
        .from(contractTemplates)
        .where(and(eq(contractTemplates.organizationId, orgId), eq(contractTemplates.active, true)))
        .orderBy(desc(contractTemplates.version)),
    ]);
    if (!unit || !owner || !tenant) return null;

    const property = await tx.query.properties.findFirst({
      where: and(eq(properties.id, unit.propertyId), eq(properties.organizationId, orgId)),
    });
    if (!property) return null;

    const snapshot =
      contract?.payloadSnapshot && typeof contract.payloadSnapshot === 'object'
        ? (contract.payloadSnapshot as Record<string, unknown>)
        : {};
    const nestedTerms =
      snapshot.leaseTerms && typeof snapshot.leaseTerms === 'object'
        ? snapshot.leaseTerms
        : snapshot.terms && typeof snapshot.terms === 'object'
          ? snapshot.terms
          : null;
    const graceDays =
      snapshotNumber(snapshot.graceDays) ??
      snapshotNumber((nestedTerms as { graceDays?: unknown } | null)?.graceDays) ??
      0;
    const graceAmount =
      snapshotText((snapshot.graceAmount as { amountMinor?: unknown } | undefined)?.amountMinor) ??
      (typeof snapshot.graceAmountMinor === 'string' || typeof snapshot.graceAmountMinor === 'number'
        ? String(snapshot.graceAmountMinor)
        : null);

    const end = new Date(`${lease.endsOn}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const renewalStartsOn = end.toISOString().slice(0, 10);

    const fallbackAdjustments: Array<{
      kind: 'add' | 'discount';
      title: string;
      amountMinor: string;
    }> = [];
    const rawAdjustments = Array.isArray(snapshot.adjustments) ? snapshot.adjustments : [];
    for (const row of rawAdjustments) {
      if (!row || typeof row !== 'object') continue;
      const item = row as Record<string, unknown>;
      const kind = item.kind === 'discount' ? 'discount' : item.kind === 'add' ? 'add' : null;
      const title = snapshotText(item.title);
      const amountMinor =
        snapshotText((item.amount as { amountMinor?: unknown } | undefined)?.amountMinor) ??
        (typeof item.amountMinor === 'string' || typeof item.amountMinor === 'number'
          ? String(item.amountMinor)
          : null);
      if (!kind || !title || !amountMinor) continue;
      fallbackAdjustments.push({ kind, title, amountMinor });
    }

    const tenantDetails =
      snapshot.tenantDetails && typeof snapshot.tenantDetails === 'object'
        ? (snapshot.tenantDetails as Record<string, unknown>)
        : {};

    const unitRecord: PropertyRecordUnit = {
      id: unit.id,
      code: unit.code,
      rentMinor: lease.rentMinor.toString(),
      salePriceMinor: null,
      depositMinor: lease.depositMinor?.toString() ?? null,
      currency: lease.currency,
      floor: unit.floor ?? null,
      areaSquareMeters: unit.areaSquareMeters?.toString() ?? null,
      electricityMeter: null,
      waterMeter: null,
    };

    const tenantRecord: PropertyRecordTenant = {
      id: tenant.id,
      displayName: tenant.displayName,
      type: tenant.type === 'company' ? 'company' : 'person',
      email: tenant.email,
      phone: tenant.phone,
    };

    const initialTenant: LeaseRenewalTenantSeed = {
      partyId: tenant.id,
      entityType: tenant.type === 'company' ? 'company' : 'person',
      nameAr:
        snapshotText(tenantDetails.nameAr) ??
        snapshotText(tenantDetails.displayName) ??
        tenant.displayName,
      nameEn: snapshotText(tenantDetails.nameEn) ?? '',
      civilId: snapshotText(tenantDetails.civilId) ?? '',
      passport: snapshotText(tenantDetails.passport) ?? '',
      nationality: snapshotText(tenantDetails.nationality) ?? '',
      crNumber: snapshotText(tenantDetails.crNumber) ?? '',
      crExpiry: snapshotText(tenantDetails.crExpiry) ?? '',
      signatoryName: snapshotText(tenantDetails.signatoryName) ?? '',
      signatoryCivilId: snapshotText(tenantDetails.signatoryCivilId) ?? '',
      signatoryNationality: snapshotText(tenantDetails.signatoryNationality) ?? '',
      phone: snapshotText(tenantDetails.phone) ?? tenant.phone ?? '',
      email: snapshotText(tenantDetails.email) ?? tenant.email ?? '',
    };

    const leaseTermsNested =
      nestedTerms && typeof nestedTerms === 'object'
        ? (nestedTerms as Record<string, unknown>)
        : null;

    const { draft: initialTerms, previousMeters } = buildRenewalTermsDraft({
      currency: lease.currency,
      renewalStartsOn,
      months: 12,
      rentMinor: lease.rentMinor.toString(),
      depositMinor: lease.depositMinor?.toString() ?? null,
      billingDay: lease.billingDay,
      leaseTermsRaw: nestedTerms,
      fallbackAdjustments,
      fallbackPaymentMethod:
        asPaymentMethod(snapshot.paymentMethod) ??
        asPaymentMethod(leaseTermsNested?.paymentMethod),
      fallbackPaymentFrequency:
        asPaymentFrequency(snapshot.paymentFrequency) ??
        asPaymentFrequency(leaseTermsNested?.paymentFrequency),
      fallbackVatEnabled:
        typeof leaseTermsNested?.vat === 'object' && leaseTermsNested.vat
          ? Boolean((leaseTermsNested.vat as { enabled?: unknown }).enabled)
          : typeof leaseTermsNested?.vatEnabled === 'boolean'
            ? leaseTermsNested.vatEnabled
            : null,
      fallbackContractType:
        leaseTermsNested?.contractType === 'commercial' ||
        leaseTermsNested?.contractType === 'residential'
          ? leaseTermsNested.contractType
          : '',
      fallbackChequeBankName:
        snapshotText(leaseTermsNested?.chequeBankName) ??
        snapshotText(snapshot.chequeBankName),
      fallbackChequeAccountName:
        snapshotText(leaseTermsNested?.chequeAccountName) ??
        snapshotText(snapshot.chequeAccountName),
      fallbackRentBankAccountId:
        snapshotText(leaseTermsNested?.rentBankAccountId) ??
        snapshotText(snapshot.rentBankAccountId),
    });

    const leaseTemplates = templateRows.filter(
      (row) =>
        row.key.includes('lease') ||
        row.key.includes('renew') ||
        row.key.includes('addendum') ||
        row.key.includes('annex'),
    );
    const defaultTemplateVersionId =
      leaseTemplates[0]?.id ?? templateRows[0]?.id ?? '';

    return {
      lease: {
        id: lease.id,
        status: lease.status,
        startsOn: lease.startsOn,
        endsOn: lease.endsOn,
        rentMinor: lease.rentMinor.toString(),
        depositMinor: lease.depositMinor?.toString() ?? null,
        currency: lease.currency,
        billingDay: lease.billingDay,
        contractId: lease.contractId,
        unitId: lease.unitId,
        ownerPartyId: lease.ownerPartyId,
        tenantPartyId: lease.tenantPartyId,
      },
      contract: contract
        ? {
            id: contract.id,
            reference: contract.reference,
            status: contract.status,
            graceDays,
            graceAmountMinor: graceAmount,
          }
        : null,
      property: {
        id: property.id,
        nameAr: property.nameAr,
        nameEn: property.nameEn,
      },
      unit: unitRecord,
      ownerName: owner.displayName,
      tenantName: tenant.displayName,
      tenant: tenantRecord,
      initialTenant,
      initialTerms,
      previousMeters,
      defaultTemplateVersionId,
      renewalStartsOn,
      templates: templateRows.map((row) => ({
        id: row.id,
        key: row.key,
        version: row.version,
        language: row.language,
      })),
    };
  });
}

/**
 * Create a renewal addendum on Neon (Vercel) — bypasses Nest so owner save
 * does not depend on Render cold starts.
 */
export async function createLeaseRenewalOnNeon(
  claims: SessionClaims,
  leaseId: string,
  input: CreateLeaseRenewalInput,
): Promise<{
  contractId: string;
  reference: string | null;
  leaseId: string;
  proposedStartsOn: string;
  chequeCount: number;
}> {
  if (!hasPermission(claims, 'lease.update') || !hasPermission(claims, 'contract.create')) {
    fail('forbidden');
  }
  const orgId = claims.organizationId ?? fail('organization_required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn)) fail('renewal_date_invalid');

  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${leaseId}, 19))`);
    const lease = await tx.query.leases.findFirst({
      where: and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)),
    });
    if (!lease || lease.status !== 'active' || !lease.contractId) fail('lease_not_renewable');
    if (input.endsOn <= lease.endsOn) fail('renewal_date_invalid');
    if (input.rent?.currency && input.rent.currency !== lease.currency) {
      fail('renewal_currency_mismatch');
    }

    const [signedParent, template, owner, tenant, unit] = await Promise.all([
      tx.query.contracts.findFirst({
        where: and(
          eq(contracts.id, lease.contractId),
          eq(contracts.organizationId, orgId),
          eq(contracts.status, 'signed'),
        ),
      }),
      tx.query.contractTemplates.findFirst({
        where: and(
          eq(contractTemplates.id, input.templateVersionId),
          eq(contractTemplates.organizationId, orgId),
        ),
      }),
      tx.query.parties.findFirst({ where: eq(parties.id, lease.ownerPartyId) }),
      tx.query.parties.findFirst({ where: eq(parties.id, lease.tenantPartyId) }),
      tx.query.units.findFirst({ where: eq(units.id, lease.unitId) }),
    ]);

    const parentContract =
      signedParent ??
      (await tx.query.contracts.findFirst({
        where: and(
          eq(contracts.id, lease.contractId),
          eq(contracts.organizationId, orgId),
          ne(contracts.status, 'void'),
        ),
      }));
    if (!parentContract) fail('contract_not_found');
    if (!template) fail('renewal_template_missing');
    if (!owner || !tenant || !unit) fail('party_not_found');

    const pendingRenewal = await tx.query.contracts.findFirst({
      where: and(
        eq(contracts.organizationId, orgId),
        eq(contracts.parentContractId, parentContract.id),
        eq(contracts.kind, 'renewal'),
        inArray(contracts.status, ['draft', 'sent', 'partially_signed']),
      ),
    });
    if (pendingRenewal) fail('renewal_pending');

    const property = await tx.query.properties.findFirst({
      where: and(eq(properties.id, unit.propertyId), eq(properties.organizationId, orgId)),
    });
    if (!property) fail('property_not_found');

    const effectiveDate = new Date(`${lease.endsOn}T00:00:00.000Z`);
    effectiveDate.setUTCDate(effectiveDate.getUTCDate() + 1);
    const startsOn = effectiveDate.toISOString().slice(0, 10);
    const parentReference =
      parentContract.reference?.trim() ||
      `CTR-${parentContract.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${parentContract.id}, 41))`);
    const siblings = await tx
      .select({ reference: contracts.reference })
      .from(contracts)
      .where(
        and(eq(contracts.organizationId, orgId), eq(contracts.parentContractId, parentContract.id)),
      );
    const contractReference = formatChildContractReference(
      parentReference,
      nextChildContractSequence(
        parentReference,
        siblings.map((row) => row.reference).filter((value): value is string => Boolean(value)),
      ),
    );

    const rentMinor = input.rent?.amountMinor ?? lease.rentMinor.toString();
    const graceDays = input.graceDays ?? 0;
    const graceAsDiscount = input.graceAsDiscount ?? true;
    const graceAmountMinor =
      input.graceAmount?.amountMinor ??
      (graceDays > 0 ? String(Math.round((Number(rentMinor) / 30) * graceDays)) : '0');
    const adjustments = (input.adjustments ?? []).map((row) => ({
      kind: row.kind,
      title: row.title,
      amount: row.amount,
    }));
    const chequeInputs = input.cheques ?? [];

    const payload = {
      contract: {
        reference: contractReference,
        kind: 'renewal' as const,
        parentReference,
      },
      owner: { id: owner.id, displayName: owner.displayName },
      tenant: { id: tenant.id, displayName: tenant.displayName },
      property: { id: property.id, nameAr: property.nameAr, nameEn: property.nameEn },
      unit: { id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn },
      startsOn,
      endsOn: input.endsOn,
      billingDay: lease.billingDay,
      rent: { amountMinor: rentMinor, currency: lease.currency },
      previous: { endsOn: lease.endsOn, rentMinor: lease.rentMinor.toString() },
      graceDays,
      graceAsDiscount,
      graceAmount: { amountMinor: graceAmountMinor, currency: lease.currency },
      adjustments,
      paymentMethod: input.paymentMethod ?? null,
      paymentFrequency: input.paymentFrequency ?? null,
      months: input.months ?? null,
      additionalTerms: input.additionalTerms ? sanitizeRichText(input.additionalTerms) : null,
      chequeAccountName: input.chequeAccountName ?? null,
      chequeBankName: input.chequeBankName ?? null,
      rentBankAccountId: input.rentBankAccountId ?? null,
      cheques: chequeInputs,
      ...(input.leaseTerms && typeof input.leaseTerms === 'object'
        ? { leaseTerms: input.leaseTerms }
        : {}),
    };

    try {
      const contractRows = await tx
        .insert(contracts)
        .values({
          organizationId: orgId,
          reference: contractReference,
          kind: 'renewal',
          parentContractId: parentContract.id,
          templateVersionId: input.templateVersionId,
          unitId: lease.unitId,
          ownerPartyId: lease.ownerPartyId,
          tenantPartyId: lease.tenantPartyId,
          payloadSnapshot: payload,
        })
        .returning({ id: contracts.id, reference: contracts.reference });
      const contract = contractRows[0]!;
      await tx.insert(approvalRequests).values({
        organizationId: orgId,
        reference: `APR-${contractReference}`,
        type: 'contract_approval',
        subject: `Renewal ${contractReference}`,
        resourceType: 'contract',
        resourceId: contract.id,
        requestedByUserId: claims.sub,
      });
      await tx.insert(workflowEvents).values({
        organizationId: orgId,
        actorUserId: claims.sub,
        resourceType: 'lease',
        resourceId: lease.id,
        eventType: 'lease.renewal_requested',
        fromStatus: lease.status,
        toStatus: lease.status,
        metadata: {
          contractId: contract.id,
          previousEndsOn: lease.endsOn,
          proposedEndsOn: input.endsOn,
          previousRentMinor: lease.rentMinor.toString(),
          proposedRentMinor: rentMinor,
          currency: lease.currency,
          chequeCount: chequeInputs.length,
        },
      });
      return {
        contractId: contract.id,
        reference: contract.reference,
        leaseId: lease.id,
        proposedStartsOn: startsOn,
        chequeCount: chequeInputs.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/unique|duplicate/i.test(message)) fail('renewal_duplicate');
      throw error;
    }
  });
}
