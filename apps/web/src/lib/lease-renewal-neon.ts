import 'server-only';
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  approvalRequests,
  contractSignatures,
  contractTemplates,
  contracts,
  leases,
  outboxEvents,
  parties,
  properties,
  units,
  users,
  workflowEvents,
} from '@bhd-r/db';
import {
  formatChildContractReference,
  nextChildContractSequence,
} from '@bhd-r/domain';
import { sanitizeRichText } from '@bhd-r/security';
import {
  ELECTRONIC_RENEWAL_NOTICE,
  ELECTRONIC_RENEWAL_NOTICE_VERSION,
  type ElectronicRenewalDocumentation,
} from '@/lib/electronic-renewal-notice';
import { appLink, notifyInTx } from '@/lib/email-notify';
import { formatMoney } from '@/lib/format';
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

function signatureHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function provisionalDocumentHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function arDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

const DEFAULT_RENEWAL_REQUIREMENTS: RenewalRequirement[] = [
  { code: 'civil_id', labelAr: 'البطاقة الشخصية', labelEn: 'Civil ID card' },
  { code: 'salary_certificate', labelAr: 'شهادة راتب', labelEn: 'Salary certificate' },
  { code: 'bank_statement', labelAr: 'كشف حساب بنكي', labelEn: 'Bank statement' },
];

export type RenewalRequirement = {
  code: string;
  labelAr: string;
  labelEn: string;
};

export type RenewalDocumentUpload = {
  code: string;
  fileName: string;
  contentType: string;
  objectKey: string | null;
  uploadedAt: string;
  note: string | null;
};

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
  /** Documents the tenant must attach before / with e-sign. */
  requirements?: RenewalRequirement[] | undefined;
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
    const ownerSignsNow = hasPermission(claims, 'contract.sign');
    const now = new Date();
    const requirements = normalizeRenewalRequirements(input.requirements);
    const [viewer] = await tx
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);

    const payload = {
      contract: {
        reference: contractReference,
        kind: 'renewal' as const,
        parentReference,
        type: 'lease' as const,
      },
      owner: { id: owner.id, displayName: owner.displayName },
      tenant: { id: tenant.id, displayName: tenant.displayName },
      property: { id: property.id, nameAr: property.nameAr, nameEn: property.nameEn },
      unit: { id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn },
      startsOn,
      endsOn: input.endsOn,
      billingDay: lease.billingDay,
      rent: { amountMinor: rentMinor, currency: lease.currency },
      amount: { amountMinor: rentMinor, currency: lease.currency },
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
      requirements,
      renewalDocuments: [] as RenewalDocumentUpload[],
      electronicNotice: {
        version: ELECTRONIC_RENEWAL_NOTICE.version,
        titleAr: ELECTRONIC_RENEWAL_NOTICE.titleAr,
        titleEn: ELECTRONIC_RENEWAL_NOTICE.titleEn,
        bodyAr: ELECTRONIC_RENEWAL_NOTICE.bodyAr,
        bodyEn: ELECTRONIC_RENEWAL_NOTICE.bodyEn,
      },
      approval: {
        mode: ownerSignsNow ? 'awaiting_counterparty' : 'awaiting_manager',
        byUserId: claims.sub,
        byName: viewer?.displayName ?? null,
        at: now.toISOString(),
      },
      ...(input.leaseTerms && typeof input.leaseTerms === 'object'
        ? { leaseTerms: input.leaseTerms }
        : {}),
    };

    try {
      const documentHash = provisionalDocumentHash([
        'renewal',
        orgId,
        contractReference,
        startsOn,
        input.endsOn,
        rentMinor,
        JSON.stringify(requirements.map((row) => row.code)),
      ]);
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
          status: ownerSignsNow ? 'partially_signed' : 'draft',
          sentAt: ownerSignsNow ? now : null,
          renderedPdfHash: ownerSignsNow ? documentHash : null,
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
        status: ownerSignsNow ? 'approved' : 'pending',
        decidedAt: ownerSignsNow ? now : null,
        decisionNote: ownerSignsNow
          ? `Delivered to tenant by ${viewer?.displayName ?? claims.sub}`
          : null,
      });

      if (ownerSignsNow) {
        await tx
          .insert(contractSignatures)
          .values({
            organizationId: orgId,
            contractId: contract.id,
            signerPartyId: lease.ownerPartyId,
            signerRole: 'owner',
            method: 'system_on_approval',
            evidence: {
              signedByUserId: claims.sub,
              signedByName: viewer?.displayName ?? null,
              signedByEmail: viewer?.email ?? null,
              signedByRoles: claims.roles,
              onBehalfOf: 'owner',
              source: 'lease_renewal_create',
            },
            signatureHash: signatureHash([
              contract.id,
              lease.ownerPartyId,
              claims.sub,
              now.toISOString(),
            ]),
            signedAt: now,
          })
          .onConflictDoNothing();

        await tx.insert(outboxEvents).values({
          organizationId: orgId,
          topic: 'contract.signature-requested',
          aggregateType: 'contract',
          aggregateId: contract.id,
          payload: { tenantPartyId: lease.tenantPartyId, contractId: contract.id },
        });

        const details = [
          { label: 'رقم الملحق', value: contractReference },
          { label: 'العقار', value: `${property.nameAr} — ${unit.nameAr || unit.code}` },
          { label: 'بداية التجديد', value: arDate(startsOn) },
          { label: 'نهاية التجديد', value: arDate(input.endsOn) },
          {
            label: 'الإيجار الشهري',
            value: formatMoney(rentMinor, lease.currency, 'ar'),
          },
        ];
        const contractLink = appLink(`/ar/tenant/contracts/${contract.id}`);
        await notifyInTx(tx, {
          orgId,
          aggregateType: 'contract',
          aggregateId: contract.id,
          audience: { parties: [lease.tenantPartyId] },
          content: () => ({
            tone: 'contract',
            subject: `✍️ ملحق التجديد ${contractReference} بانتظار توقيعك`,
            title: 'ملحق تجديد الإيجار جاهز لتوقيعك',
            intro: `وقّع المالك ملحق التجديد، وبقي توقيعك ومرفق المستندات المطلوبة ليصبح سارياً.`,
            details,
            lines: [
              requirements.length
                ? `المستندات المطلوبة: ${requirements.map((row) => row.labelAr).join('، ')}.`
                : 'راجع الملحق ثم وقّع إلكترونياً من حسابك.',
              'افتح الملحق من حساب المستأجر، ارفع المستندات، ثم وقّع.',
            ],
            cta: { label: 'مراجعة الملحق وتوقيعه', url: contractLink },
          }),
        });
      }

      await tx.insert(workflowEvents).values({
        organizationId: orgId,
        actorUserId: claims.sub,
        resourceType: 'lease',
        resourceId: lease.id,
        eventType: ownerSignsNow ? 'lease.renewal_sent_to_tenant' : 'lease.renewal_requested',
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
          deliveredToTenant: ownerSignsNow,
          requirementCount: requirements.length,
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

function normalizeRenewalRequirements(
  input: RenewalRequirement[] | undefined,
): RenewalRequirement[] {
  const source = input?.length ? input : DEFAULT_RENEWAL_REQUIREMENTS;
  const seen = new Set<string>();
  const out: RenewalRequirement[] = [];
  for (const row of source) {
    const code = (row.code ?? '').trim().toLowerCase();
    if (!/^[a-z0-9_]{2,40}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    const labelAr = (row.labelAr ?? '').trim().slice(0, 120) || code;
    const labelEn = (row.labelEn ?? '').trim().slice(0, 120) || code;
    out.push({ code, labelAr, labelEn });
    if (out.length >= 20) break;
  }
  return out.length ? out : DEFAULT_RENEWAL_REQUIREMENTS;
}

/**
 * Deliver an unfinished draft renewal to the tenant for e-sign + documents.
 * Used to repair renewals created before auto-delivery shipped.
 */
export async function deliverDraftRenewalOnNeon(
  claims: SessionClaims,
  contractId: string,
): Promise<{ contractId: string; status: string }> {
  if (!hasPermission(claims, 'contract.sign')) fail('forbidden');
  const orgId = claims.organizationId ?? fail('organization_required');

  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contractId}, 31))`);
    const contract = await tx.query.contracts.findFirst({
      where: and(
        eq(contracts.id, contractId),
        eq(contracts.organizationId, orgId),
        eq(contracts.kind, 'renewal'),
      ),
    });
    if (!contract) fail('contract_not_found');
    if (contract.status === 'partially_signed' || contract.status === 'sent') {
      return { contractId: contract.id, status: contract.status };
    }
    if (contract.status !== 'draft') fail('renewal_not_deliverable');

    const now = new Date();
    const [viewer] = await tx
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    const snapshot = (contract.payloadSnapshot ?? {}) as Record<string, unknown>;
    const requirements = normalizeRenewalRequirements(
      Array.isArray(snapshot.requirements)
        ? (snapshot.requirements as RenewalRequirement[])
        : undefined,
    );
    const reference =
      contract.reference?.trim() || `CTR-${contract.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const documentHash =
      contract.renderedPdfHash ||
      provisionalDocumentHash(['renewal-deliver', contract.id, reference, now.toISOString()]);

    const nextPayload = {
      ...snapshot,
      requirements,
      renewalDocuments: Array.isArray(snapshot.renewalDocuments)
        ? snapshot.renewalDocuments
        : [],
      amount:
        snapshot.amount && typeof snapshot.amount === 'object'
          ? snapshot.amount
          : snapshot.rent && typeof snapshot.rent === 'object'
            ? snapshot.rent
            : snapshot.amount,
      approval: {
        mode: 'awaiting_counterparty',
        byUserId: claims.sub,
        byName: viewer?.displayName ?? null,
        at: now.toISOString(),
      },
    };

    await tx
      .update(contracts)
      .set({
        status: 'partially_signed',
        sentAt: now,
        renderedPdfHash: documentHash,
        payloadSnapshot: nextPayload,
        updatedAt: now,
      })
      .where(and(eq(contracts.id, contract.id), eq(contracts.organizationId, orgId)));

    await tx
      .update(approvalRequests)
      .set({
        status: 'approved',
        decidedAt: now,
        decisionNote: `Delivered to tenant by ${viewer?.displayName ?? claims.sub}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(approvalRequests.organizationId, orgId),
          eq(approvalRequests.resourceType, 'contract'),
          eq(approvalRequests.resourceId, contract.id),
          inArray(approvalRequests.status, ['pending', 'on_hold']),
        ),
      );

    await tx
      .insert(contractSignatures)
      .values({
        organizationId: orgId,
        contractId: contract.id,
        signerPartyId: contract.ownerPartyId,
        signerRole: 'owner',
        method: 'system_on_approval',
        evidence: {
          signedByUserId: claims.sub,
          signedByName: viewer?.displayName ?? null,
          signedByEmail: viewer?.email ?? null,
          signedByRoles: claims.roles,
          onBehalfOf: 'owner',
          source: 'lease_renewal_deliver',
        },
        signatureHash: signatureHash([
          contract.id,
          contract.ownerPartyId,
          claims.sub,
          now.toISOString(),
        ]),
        signedAt: now,
      })
      .onConflictDoNothing();

    await tx.insert(outboxEvents).values({
      organizationId: orgId,
      topic: 'contract.signature-requested',
      aggregateType: 'contract',
      aggregateId: contract.id,
      payload: { tenantPartyId: contract.tenantPartyId, contractId: contract.id },
    });

    const property = snapshot.property as { nameAr?: string } | undefined;
    const unit = snapshot.unit as { nameAr?: string; code?: string } | undefined;
    const rent = (snapshot.rent ?? snapshot.amount) as
      | { amountMinor?: string; currency?: string }
      | undefined;
    const startsOn = typeof snapshot.startsOn === 'string' ? snapshot.startsOn : '';
    const endsOn = typeof snapshot.endsOn === 'string' ? snapshot.endsOn : '';
    await notifyInTx(tx, {
      orgId,
      aggregateType: 'contract',
      aggregateId: contract.id,
      audience: { parties: [contract.tenantPartyId] },
      content: () => ({
        tone: 'contract',
        subject: `✍️ ملحق التجديد ${reference} بانتظار توقيعك`,
        title: 'ملحق تجديد الإيجار جاهز لتوقيعك',
        intro: 'وقّع المالك ملحق التجديد، وبقي توقيعك ومرفق المستندات المطلوبة.',
        details: [
          { label: 'رقم الملحق', value: reference },
          {
            label: 'العقار',
            value: `${property?.nameAr ?? '—'} — ${unit?.nameAr || unit?.code || '—'}`,
          },
          ...(startsOn ? [{ label: 'بداية التجديد', value: arDate(startsOn) }] : []),
          ...(endsOn ? [{ label: 'نهاية التجديد', value: arDate(endsOn) }] : []),
          ...(rent?.amountMinor && rent.currency
            ? [
                {
                  label: 'الإيجار الشهري',
                  value: formatMoney(rent.amountMinor, rent.currency, 'ar'),
                },
              ]
            : []),
        ],
        lines: [
          requirements.length
            ? `المستندات المطلوبة: ${requirements.map((row) => row.labelAr).join('، ')}.`
            : 'راجع الملحق ثم وقّع إلكترونياً.',
        ],
        cta: {
          label: 'مراجعة الملحق وتوقيعه',
          url: appLink(`/ar/tenant/contracts/${contract.id}`),
        },
      }),
    });

    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'contract',
      resourceId: contract.id,
      eventType: 'lease.renewal_sent_to_tenant',
      fromStatus: 'draft',
      toStatus: 'partially_signed',
      metadata: { deliveredByRepair: true, requirementCount: requirements.length },
    });

    return { contractId: contract.id, status: 'partially_signed' };
  });
}

function sniffRenewalDocument(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    bytes.length >= 8 &&
    bytes.readUInt32BE(0) === 0x89504e47 &&
    bytes.readUInt32BE(4) === 0x0d0a1a0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  return null;
}

/**
 * Tenant uploads a required renewal document onto the addendum payload.
 */
export async function uploadRenewalDocumentOnNeon(
  claims: SessionClaims,
  contractId: string,
  input: { code: string; fileName: string; bytes: Buffer },
): Promise<{ code: string; uploadedAt: string }> {
  const orgId = claims.organizationId ?? fail('organization_required');
  const partyId = claims.partyId ?? fail('forbidden');
  const code = input.code.trim().toLowerCase();
  if (!/^[a-z0-9_]{2,40}$/.test(code)) fail('validation_failed');
  const sniffed = sniffRenewalDocument(input.bytes);
  if (!sniffed) fail('renewal_document_invalid');
  if (input.bytes.byteLength < 32 || input.bytes.byteLength > 8 * 1024 * 1024) {
    fail('renewal_document_invalid');
  }

  const { putPrivateObject, s3BucketsReady } = await import('@/lib/upload-property-media-neon');

  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contractId}, 47))`);
    const contract = await tx.query.contracts.findFirst({
      where: and(
        eq(contracts.id, contractId),
        eq(contracts.organizationId, orgId),
        eq(contracts.tenantPartyId, partyId),
        eq(contracts.kind, 'renewal'),
      ),
    });
    if (!contract) fail('contract_not_found');
    if (!['sent', 'partially_signed'].includes(contract.status)) fail('renewal_not_deliverable');

    const snapshot = (contract.payloadSnapshot ?? {}) as Record<string, unknown>;
    const requirements = normalizeRenewalRequirements(
      Array.isArray(snapshot.requirements)
        ? (snapshot.requirements as RenewalRequirement[])
        : undefined,
    );
    if (!requirements.some((row) => row.code === code)) fail('renewal_document_code');

    let objectKey: string | null = null;
    if (s3BucketsReady()) {
      objectKey = `org/${orgId}/renewals/${contractId}/${code}-${Date.now()}.${sniffed.ext}`;
      try {
        await putPrivateObject(objectKey, input.bytes, sniffed.mime);
      } catch (error) {
        console.error(
          'renewal document upload failed',
          error instanceof Error ? error.message : '',
        );
        objectKey = null;
      }
    }

    const uploadedAt = new Date().toISOString();
    const fileName = input.fileName.trim().slice(0, 180) || `${code}.${sniffed.ext}`;
    const entry: RenewalDocumentUpload = {
      code,
      fileName,
      contentType: sniffed.mime,
      objectKey,
      uploadedAt,
      note: objectKey
        ? null
        : `inline:${input.bytes.toString('base64').slice(0, 12)}…`, // marker only; bytes stay in S3 when possible
    };

    // When S3 is unavailable, keep a compact inline data URL (images/PDF ≤ 1.5MB).
    const previous = Array.isArray(snapshot.renewalDocuments)
      ? (snapshot.renewalDocuments as RenewalDocumentUpload[])
      : [];
    let stored = entry;
    if (!objectKey && input.bytes.byteLength <= 1.5 * 1024 * 1024) {
      stored = {
        ...entry,
        note: `data:${sniffed.mime};base64,${input.bytes.toString('base64')}`,
      };
    } else if (!objectKey) {
      fail('renewal_document_storage');
    }

    const nextDocs = [...previous.filter((row) => row.code !== code), stored];
    await tx
      .update(contracts)
      .set({
        payloadSnapshot: { ...snapshot, requirements, renewalDocuments: nextDocs },
        updatedAt: new Date(),
      })
      .where(and(eq(contracts.id, contract.id), eq(contracts.organizationId, orgId)));

    return { code, uploadedAt };
  });
}

/**
 * Tenant completes the renewal package: required docs + consent → system records
 * the e-signature, marks the addendum signed, queues clearance, and notifies both sides.
 */
export async function completeTenantRenewalPackageOnNeon(
  claims: SessionClaims,
  contractId: string,
  input: { endsOn?: string | undefined; consentAccepted: boolean },
): Promise<{ contractId: string; status: 'signed'; reference: string | null }> {
  if (!input.consentAccepted) fail('renewal_consent_required');
  const orgId = claims.organizationId ?? fail('organization_required');
  const partyId = claims.partyId ?? fail('forbidden');

  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contractId}, 59))`);
    const contract = await tx.query.contracts.findFirst({
      where: and(
        eq(contracts.id, contractId),
        eq(contracts.organizationId, orgId),
        eq(contracts.tenantPartyId, partyId),
        eq(contracts.kind, 'renewal'),
      ),
    });
    if (!contract) fail('contract_not_found');
    if (!['sent', 'partially_signed'].includes(contract.status)) fail('renewal_not_deliverable');
    if (contract.status === 'signed') {
      return {
        contractId: contract.id,
        status: 'signed' as const,
        reference: contract.reference,
      };
    }

    const snapshot = { ...(contract.payloadSnapshot as Record<string, unknown>) };
    const requirements = normalizeRenewalRequirements(
      Array.isArray(snapshot.requirements)
        ? (snapshot.requirements as RenewalRequirement[])
        : undefined,
    );
    const uploads = Array.isArray(snapshot.renewalDocuments)
      ? (snapshot.renewalDocuments as RenewalDocumentUpload[])
      : [];
    const uploadedCodes = new Set(uploads.map((row) => row.code));
    const missing = requirements.filter((row) => !uploadedCodes.has(row.code));
    if (missing.length) fail('renewal_documents_incomplete');

    const termProposal = snapshot.tenantTermProposal;
    if (
      termProposal &&
      typeof termProposal === 'object' &&
      (termProposal as { status?: string }).status === 'pending'
    ) {
      fail('renewal_term_pending');
    }
    // End date is system-owned; changes go only through renewal-term (object / auto-approve).

    const now = new Date();
    const nowIso = now.toISOString();
    const documentation: ElectronicRenewalDocumentation = {
      noticeVersion: ELECTRONIC_RENEWAL_NOTICE_VERSION,
      signedBySystem: true,
      humanIntervention: false,
      docsPendingAdminReview: true,
      completedAt: nowIso,
      tenantConsentAt: nowIso,
    };
    snapshot.electronicNotice = {
      version: ELECTRONIC_RENEWAL_NOTICE.version,
      titleAr: ELECTRONIC_RENEWAL_NOTICE.titleAr,
      titleEn: ELECTRONIC_RENEWAL_NOTICE.titleEn,
      bodyAr: ELECTRONIC_RENEWAL_NOTICE.bodyAr,
      bodyEn: ELECTRONIC_RENEWAL_NOTICE.bodyEn,
    };
    snapshot.electronicDocumentation = documentation;
    snapshot.approval = {
      ...(typeof snapshot.approval === 'object' && snapshot.approval
        ? (snapshot.approval as Record<string, unknown>)
        : {}),
      mode: 'electronic_system',
      tenantCompletedAt: nowIso,
      docsPendingAdminReview: true,
    };

    const documentHash =
      contract.renderedPdfHash ||
      provisionalDocumentHash([
        'renewal-complete',
        contract.id,
        String(snapshot.endsOn ?? ''),
        nowIso,
      ]);

    // Owner signature (system) if missing — automated path already may have one.
    const existing = await tx
      .select({ role: contractSignatures.signerRole, partyId: contractSignatures.signerPartyId })
      .from(contractSignatures)
      .where(eq(contractSignatures.contractId, contract.id));
    const hasOwner = existing.some((row) => row.partyId === contract.ownerPartyId);
    const hasTenant = existing.some((row) => row.partyId === contract.tenantPartyId);

    if (!hasOwner) {
      await tx.insert(contractSignatures).values({
        organizationId: orgId,
        contractId: contract.id,
        signerPartyId: contract.ownerPartyId,
        signerRole: 'owner',
        method: 'system_on_approval',
        evidence: {
          onBehalfOf: 'owner',
          source: 'electronic_renewal_package',
          noticeVersion: ELECTRONIC_RENEWAL_NOTICE_VERSION,
          humanIntervention: false,
        },
        signatureHash: signatureHash([
          contract.id,
          contract.ownerPartyId,
          'system',
          nowIso,
        ]),
        signedAt: now,
      });
    }

    if (!hasTenant) {
      await tx.insert(contractSignatures).values({
        organizationId: orgId,
        contractId: contract.id,
        signerPartyId: partyId,
        signerRole: 'tenant',
        method: 'tenant_consent_electronic',
        evidence: {
          signedByUserId: claims.sub,
          consentTextVersion: ELECTRONIC_RENEWAL_NOTICE_VERSION,
          consentAr: ELECTRONIC_RENEWAL_NOTICE.consentAr,
          consentEn: ELECTRONIC_RENEWAL_NOTICE.consentEn,
          documentSha256: documentHash,
          source: 'tenant_renewal_workspace',
          humanIntervention: false,
          signedBySystem: true,
        },
        signatureHash: signatureHash([
          contract.id,
          partyId,
          claims.sub,
          ELECTRONIC_RENEWAL_NOTICE_VERSION,
          nowIso,
        ]),
        signedAt: now,
      });
    }

    await tx
      .update(contracts)
      .set({
        status: 'signed',
        completedAt: now,
        sentAt: contract.sentAt ?? now,
        renderedPdfHash: documentHash,
        payloadSnapshot: snapshot,
        updatedAt: now,
      })
      .where(and(eq(contracts.id, contract.id), eq(contracts.organizationId, orgId)));

    if (contract.parentContractId) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${contract.parentContractId}, 23))`,
      );
      const currentLease = await tx.query.leases.findFirst({
        where: and(
          eq(leases.contractId, contract.parentContractId),
          eq(leases.organizationId, orgId),
          eq(leases.status, 'active'),
        ),
      });
      if (currentLease) {
        const endsOn =
          typeof snapshot.endsOn === 'string' ? snapshot.endsOn : currentLease.endsOn;
        const rent = snapshot.rent as { amountMinor?: string; currency?: string } | undefined;
        const rentMinor = rent?.amountMinor ?? currentLease.rentMinor.toString();
        await tx
          .update(leases)
          .set({
            renewalPendingContractId: contract.id,
            renewalPendingEndsOn: endsOn,
            renewalPendingRentMinor: BigInt(rentMinor),
            updatedAt: now,
          })
          .where(eq(leases.id, currentLease.id));
        await tx.insert(workflowEvents).values({
          organizationId: orgId,
          actorUserId: claims.sub,
          resourceType: 'lease',
          resourceId: currentLease.id,
          eventType: 'lease.renewal_pending_clearance',
          fromStatus: currentLease.status,
          toStatus: currentLease.status,
          metadata: {
            renewalContractId: contract.id,
            electronic: true,
            docsPendingAdminReview: true,
            nextEndsOn: endsOn,
            nextRentMinor: rentMinor,
          },
        });
      }
    }

    await tx.insert(outboxEvents).values({
      organizationId: orgId,
      topic: 'contract.signed',
      aggregateType: 'contract',
      aggregateId: contract.id,
      payload: {
        completed: true,
        kind: 'renewal',
        electronic: true,
        docsPendingAdminReview: true,
      },
    });

    const reference =
      contract.reference?.trim() ||
      `CTR-${contract.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    const link = appLink(`/ar/tenant/contracts/${contract.id}`);
    await notifyInTx(tx, {
      orgId,
      aggregateType: 'contract',
      aggregateId: contract.id,
      audience: { parties: [contract.tenantPartyId] },
      content: () => ({
        tone: 'contract',
        subject: `📜 ملحق التجديد ${reference} موثّق إلكترونياً`,
        title: 'تم توثيق ملحق التجديد',
        intro:
          'اعتمد النظام الملحق إلكترونياً بعد استلام مستنداتك وتوقيعك. يمكنك فتح النسخة الموثّقة من حسابك. ستراجع الإدارة المستندات.',
        lines: [ELECTRONIC_RENEWAL_NOTICE.bodyAr],
        cta: { label: 'عرض الملحق الموثّق', url: link },
      }),
    });
    await notifyInTx(tx, {
      orgId,
      aggregateType: 'contract',
      aggregateId: contract.id,
      audience: { parties: [contract.ownerPartyId] },
      content: () => ({
        tone: 'contract',
        subject: `📎 ملحق تجديد موثّق — راجع المستندات · ${reference}`,
        title: 'تجديد موثّق إلكترونياً — مراجعة المستندات',
        intro:
          'أكمل المستأجر الحزمة ووثّق النظام الملحق آلياً. راجع المرفقات؛ يمكنك إلغاء الملحق إن اختلفت المستندات.',
        cta: {
          label: 'فتح الملحق',
          url: appLink(`/ar/owner/contracts/${contract.id}`),
        },
      }),
    });

    return { contractId: contract.id, status: 'signed' as const, reference: contract.reference };
  });
}

/** Owner voids a signed renewal when attached documents do not match. */
export async function voidRenewalForDocumentMismatchOnNeon(
  claims: SessionClaims,
  contractId: string,
  note?: string | null,
): Promise<{ contractId: string; status: 'void' }> {
  const orgId = claims.organizationId ?? fail('organization_required');
  if (!hasPermission(claims, 'lease.update') && !hasPermission(claims, 'contract.sign')) {
    fail('forbidden');
  }

  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${contractId}, 61))`);
    const contract = await tx.query.contracts.findFirst({
      where: and(
        eq(contracts.id, contractId),
        eq(contracts.organizationId, orgId),
        eq(contracts.kind, 'renewal'),
      ),
    });
    if (!contract) fail('contract_not_found');
    if (contract.status === 'void') return { contractId: contract.id, status: 'void' as const };
    if (!['signed', 'partially_signed', 'sent'].includes(contract.status)) {
      fail('renewal_not_deliverable');
    }

    const now = new Date();
    const snapshot = {
      ...(contract.payloadSnapshot as Record<string, unknown>),
      voidReason: 'document_mismatch',
      voidedAt: now.toISOString(),
      voidNote: note?.trim().slice(0, 500) || null,
      voidedByUserId: claims.sub,
    };
    await tx
      .update(contracts)
      .set({ status: 'void', payloadSnapshot: snapshot, updatedAt: now })
      .where(eq(contracts.id, contract.id));

    await tx
      .update(leases)
      .set({
        renewalPendingContractId: null,
        renewalPendingEndsOn: null,
        renewalPendingRentMinor: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(leases.organizationId, orgId),
          eq(leases.renewalPendingContractId, contract.id),
        ),
      );

    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'contract',
      resourceId: contract.id,
      eventType: 'contract.voided_document_mismatch',
      fromStatus: contract.status,
      toStatus: 'void',
      metadata: { note: note?.trim().slice(0, 200) || null },
    });

    const reference = contract.reference ?? contract.id.slice(0, 8).toUpperCase();
    await notifyInTx(tx, {
      orgId,
      aggregateType: 'contract',
      aggregateId: contract.id,
      audience: { parties: [contract.tenantPartyId] },
      content: () => ({
        tone: 'contract',
        subject: `⛔ أُلغي ملحق التجديد ${reference} لاختلاف المستندات`,
        title: 'أُلغي ملحق التجديد',
        intro: note?.trim()
          ? `ألغت الإدارة الملحق بسبب اختلاف المستندات: ${note.trim()}. تتحمل المسؤولية الإدارية والقانونية وفق إقرار التوثيق الإلكتروني.`
          : 'ألغت الإدارة الملحق بسبب اختلاف المستندات المرفقة. تتحمل المسؤولية الإدارية والقانونية وفق إقرار التوثيق الإلكتروني.',
        cta: {
          label: 'حساب المستأجر',
          url: appLink('/ar/tenant'),
        },
      }),
    });

    return { contractId: contract.id, status: 'void' as const };
  });
}
