import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { contractTemplates, contracts, leases, parties, properties, units } from '@bhd-r/db';
import { withinViewerTenant } from '@/lib/portal-ops-data';

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
  unit: { id: string; code: string; nameAr: string; nameEn: string };
  ownerName: string;
  tenantName: string;
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
    const graceDays =
      snapshotNumber(snapshot.graceDays) ??
      snapshotNumber((snapshot.terms as { graceDays?: unknown } | undefined)?.graceDays) ??
      0;
    const graceAmount =
      snapshotText((snapshot.graceAmount as { amountMinor?: unknown } | undefined)?.amountMinor) ??
      (typeof snapshot.graceAmountMinor === 'string' || typeof snapshot.graceAmountMinor === 'number'
        ? String(snapshot.graceAmountMinor)
        : null);

    const end = new Date(`${lease.endsOn}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const renewalStartsOn = end.toISOString().slice(0, 10);

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
      unit: {
        id: unit.id,
        code: unit.code,
        nameAr: unit.nameAr,
        nameEn: unit.nameEn,
      },
      ownerName: owner.displayName,
      tenantName: tenant.displayName,
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
