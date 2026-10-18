import 'server-only';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { SessionClaims } from '@bhd-r/authz';
import type { CurrencyCode } from '@bhd-r/contracts';
import { cheques, leases, parties, properties, units } from '@bhd-r/db';
import {
  canManageAccounting,
  canReadAccounting,
  ensureAccountCodeMap,
  fail,
  postSourceDocumentInTx,
} from '@/lib/accounting-gl-neon';
import {
  channelFromMethod,
  postingIncomeReceived,
  postingPurchase,
  postingSale,
  type PostingDimensions,
} from '@/lib/accounting-posting';
import type { ChequeImportRow } from '@/lib/accounting-ops';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';

export type { ChequeImportRow };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export type AccountingPropertyOption = {
  id: string;
  nameAr: string;
  nameEn: string;
};

export type AccountingUnitOption = {
  id: string;
  propertyId: string;
  code: string;
  nameAr: string;
  nameEn: string;
};

/** Buildings and units the viewer may dimension expense/income/trading journals against. */
export async function listAccountingDimensions(claims: SessionClaims): Promise<{
  properties: AccountingPropertyOption[];
  units: AccountingUnitOption[];
}> {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const ownerPartyId = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    const propertyRows = await tx
      .select({
        id: properties.id,
        nameAr: properties.nameAr,
        nameEn: properties.nameEn,
      })
      .from(properties)
      .where(
        and(
          eq(properties.organizationId, orgId),
          ne(properties.status, 'archived'),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .orderBy(asc(properties.nameAr));
    const propertyIds = propertyRows.map((row) => row.id);
    const unitRows = propertyIds.length
      ? await tx
          .select({
            id: units.id,
            propertyId: units.propertyId,
            code: units.code,
            nameAr: units.nameAr,
            nameEn: units.nameEn,
          })
          .from(units)
          .where(
            and(
              eq(units.organizationId, orgId),
              inArray(units.propertyId, propertyIds),
              ne(units.status, 'archived'),
            ),
          )
          .orderBy(asc(units.code))
      : [];
    return {
      properties: propertyRows.map((row) => ({
        id: row.id,
        nameAr: row.nameAr || row.nameEn || row.id,
        nameEn: row.nameEn || row.nameAr || row.id,
      })),
      units: unitRows.map((row) => ({
        id: row.id,
        propertyId: row.propertyId,
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
      })),
    };
  });
}

function dimsOf(input: {
  currency: string;
  propertyId?: string;
  unitId?: string;
  partyId?: string;
}): PostingDimensions {
  return {
    currency: input.currency,
    ...(input.propertyId ? { propertyId: input.propertyId } : {}),
    ...(input.unitId ? { unitId: input.unitId } : {}),
    ...(input.partyId ? { partyId: input.partyId } : {}),
  };
}

export type OpsEntryKind = 'income' | 'purchase' | 'sale';

/** Post income, purchase or sale as a balanced source journal with optional property/unit dims. */
export async function createOpsEntry(
  claims: SessionClaims,
  input: {
    kind: OpsEntryKind;
    description: string;
    amountMinor: string;
    currency?: string;
    occurredOn: string;
    method?: string;
    propertyId?: string;
    unitId?: string;
    partyId?: string;
  },
) {
  if (!canManageAccounting(claims)) fail('forbidden');
  if (!ISO_DATE.test(input.occurredOn)) fail('invalid_date');
  if (!/^[1-9]\d*$/.test(input.amountMinor)) fail('invalid_amount');
  if (input.description.trim().length < 2) fail('invalid_input');
  if (input.propertyId && !UUID.test(input.propertyId)) fail('invalid_input');
  if (input.unitId && !UUID.test(input.unitId)) fail('invalid_input');
  const currency = (input.currency || 'OMR') as CurrencyCode;
  const channel = channelFromMethod(input.method);
  const orgId = claims.organizationId!;
  const sourceId = randomUUID();
  const memo = input.description.trim().slice(0, 500);
  const dims = dimsOf({
    currency,
    ...(input.propertyId ? { propertyId: input.propertyId } : {}),
    ...(input.unitId ? { unitId: input.unitId } : {}),
    ...(input.partyId ? { partyId: input.partyId } : {}),
  });

  return withinViewerTenant(claims, async (tx) => {
    if (input.propertyId) {
      const ok = await tx.query.properties.findFirst({
        where: and(eq(properties.id, input.propertyId), eq(properties.organizationId, orgId)),
        columns: { id: true },
      });
      if (!ok) fail('invalid_input');
    }
    if (input.unitId) {
      const ok = await tx.query.units.findFirst({
        where: and(eq(units.id, input.unitId), eq(units.organizationId, orgId)),
        columns: { id: true, propertyId: true },
      });
      if (!ok) fail('invalid_input');
      if (input.propertyId && ok.propertyId !== input.propertyId) fail('invalid_input');
    }
    const map = await ensureAccountCodeMap(tx, orgId);
    const lines =
      input.kind === 'income'
        ? postingIncomeReceived(map, input.amountMinor, dims, channel, '4300', memo)
        : input.kind === 'purchase'
          ? postingPurchase(
              map,
              input.amountMinor,
              dims,
              input.method === 'payable' ? 'payable' : channel,
              memo,
            )
          : postingSale(
              map,
              input.amountMinor,
              dims,
              input.method === 'receivable' ? 'receivable' : channel,
              memo,
            );
    const label =
      input.kind === 'income' ? 'دخل' : input.kind === 'purchase' ? 'مشتريات' : 'مبيعات';
    const journal = await postSourceDocumentInTx(tx, {
      organizationId: orgId,
      actorUserId: claims.sub,
      occurredOn: input.occurredOn,
      description: `${label}: ${memo}`.slice(0, 500),
      sourceType: `ops_${input.kind}`,
      sourceId,
      lines,
    });
    return { journal, sourceId, kind: input.kind };
  });
}

export type AccountingChequeRow = {
  id: string;
  chequeNumber: string;
  bankName: string;
  amountMinor: string;
  currency: string;
  dueOn: string;
  reviewStatus: string;
  leaseId: string | null;
  tenantName: string | null;
  propertyName: string | null;
  unitCode: string | null;
};

/** All organisation cheques (tenant rent schedule), with property / unit labels. */
export async function listAccountingCheques(claims: SessionClaims): Promise<AccountingChequeRow[]> {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const ownerPartyId = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: cheques.id,
        chequeNumber: cheques.chequeNumber,
        bankName: cheques.bankName,
        amountMinor: cheques.amountMinor,
        currency: cheques.currency,
        dueOn: cheques.dueOn,
        reviewStatus: cheques.reviewStatus,
        leaseId: cheques.leaseId,
        tenantName: parties.displayName,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        unitCode: units.code,
        propertyOwnerPartyId: properties.ownerPartyId,
      })
      .from(cheques)
      .leftJoin(parties, eq(parties.id, cheques.ownerPartyId))
      .leftJoin(leases, eq(leases.id, cheques.leaseId))
      .leftJoin(units, eq(units.id, leases.unitId))
      .leftJoin(properties, eq(properties.id, units.propertyId))
      .where(eq(cheques.organizationId, orgId))
      .orderBy(asc(cheques.dueOn), desc(cheques.createdAt))
      .limit(2000);
    return rows
      .filter((row) => !ownerPartyId || row.propertyOwnerPartyId === ownerPartyId || !row.leaseId)
      .map((row) => ({
        id: row.id,
        chequeNumber: row.chequeNumber,
        bankName: row.bankName,
        amountMinor: row.amountMinor.toString(),
        currency: row.currency,
        dueOn: String(row.dueOn),
        reviewStatus: row.reviewStatus,
        leaseId: row.leaseId,
        tenantName: row.tenantName,
        propertyName: row.propertyNameAr || row.propertyNameEn || null,
        unitCode: row.unitCode,
      }));
  });
}

/**
 * Import tenant cheques (CSV-parsed rows). Skips duplicate cheque numbers in the org.
 * Requires leaseId or tenantPartyId so the cheque is linked to a tenant party.
 */
export async function importAccountingCheques(
  claims: SessionClaims,
  rows: ChequeImportRow[],
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  if (!canManageAccounting(claims)) fail('forbidden');
  if (!rows.length) fail('invalid_input');
  if (rows.length > 500) fail('invalid_input');
  const orgId = claims.organizationId!;
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  await withinViewerTenant(claims, async (tx) => {
    const existing = await tx
      .select({ chequeNumber: cheques.chequeNumber })
      .from(cheques)
      .where(eq(cheques.organizationId, orgId));
    const seen = new Set(existing.map((row) => row.chequeNumber.toLowerCase()));

    for (const [index, row] of rows.entries()) {
      const number = row.chequeNumber.trim();
      const bank = row.bankName.trim() || '—';
      if (!number || !ISO_DATE.test(row.dueOn) || !/^[1-9]\d*$/.test(row.amountMinor)) {
        errors.push(`row_${index + 1}:invalid`);
        skipped += 1;
        continue;
      }
      if (seen.has(number.toLowerCase())) {
        skipped += 1;
        continue;
      }
      let tenantPartyId = row.tenantPartyId?.trim() || '';
      let leaseId = row.leaseId?.trim() || undefined;
      if (leaseId) {
        if (!UUID.test(leaseId)) {
          errors.push(`row_${index + 1}:bad_lease`);
          skipped += 1;
          continue;
        }
        const lease = await tx
          .select({
            id: leases.id,
            tenantPartyId: leases.tenantPartyId,
          })
          .from(leases)
          .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
          .limit(1);
        if (!lease[0]?.tenantPartyId) {
          errors.push(`row_${index + 1}:lease_missing`);
          skipped += 1;
          continue;
        }
        tenantPartyId = lease[0].tenantPartyId;
      } else if (tenantPartyId) {
        if (!UUID.test(tenantPartyId)) {
          errors.push(`row_${index + 1}:bad_party`);
          skipped += 1;
          continue;
        }
        const party = await tx.query.parties.findFirst({
          where: and(eq(parties.id, tenantPartyId), eq(parties.organizationId, orgId)),
          columns: { id: true },
        });
        if (!party) {
          errors.push(`row_${index + 1}:party_missing`);
          skipped += 1;
          continue;
        }
      } else {
        errors.push(`row_${index + 1}:need_lease_or_party`);
        skipped += 1;
        continue;
      }
      const currency = ((row.currency || 'OMR').toUpperCase().slice(0, 3) || 'OMR') as CurrencyCode;
      await tx.insert(cheques).values({
        organizationId: orgId,
        leaseId: leaseId,
        ownerPartyId: tenantPartyId,
        bankName: bank.slice(0, 160),
        chequeNumber: number.slice(0, 80),
        amountMinor: BigInt(row.amountMinor),
        currency,
        dueOn: row.dueOn,
      });
      seen.add(number.toLowerCase());
      imported += 1;
    }
  });

  return { imported, skipped, errors: errors.slice(0, 20) };
}
