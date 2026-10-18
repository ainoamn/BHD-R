import 'server-only';
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { SessionClaims } from '@bhd-r/authz';
import type { CurrencyCode } from '@bhd-r/contracts';
import {
  addresses,
  cheques,
  contracts,
  invoices,
  leases,
  parties,
  properties,
  units,
} from '@bhd-r/db';
import {
  canManageAccounting,
  canReadAccounting,
  ensureAccountCodeMap,
  fail,
  postSourceDocumentInTx,
  type GlTx,
} from '@/lib/accounting-gl-neon';
import {
  channelFromMethod,
  postingIncomeReceived,
  postingPurchase,
  postingSale,
  type PostingDimensions,
} from '@/lib/accounting-posting';
import type { ChequeImportRow } from '@/lib/accounting-ops';
import { muscatToday } from '@/lib/contract-list-facets';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import { buildLeaseStatement, ledgerTermsOf } from '@/lib/tenant-ledger';

export type { ChequeImportRow };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export type AccountingPropertyOption = {
  id: string;
  nameAr: string;
  nameEn: string;
  serial: string | null;
  place: string | null;
  ownerPartyId: string;
  ownerName: string;
};

export type AccountingUnitOption = {
  id: string;
  propertyId: string;
  code: string;
  nameAr: string;
  nameEn: string;
};

export type AccountingTenantOption = {
  partyId: string;
  name: string;
  propertyId: string;
  unitId: string | null;
};

/** Buildings, units, owners and current tenants for expense/income/journal pickers. */
export async function listAccountingDimensions(claims: SessionClaims): Promise<{
  properties: AccountingPropertyOption[];
  units: AccountingUnitOption[];
  tenants: AccountingTenantOption[];
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
        serialNumber: properties.serialNumber,
        ownerPartyId: properties.ownerPartyId,
        ownerName: parties.displayName,
        city: addresses.city,
        wilayat: addresses.wilayat,
      })
      .from(properties)
      .leftJoin(parties, eq(parties.id, properties.ownerPartyId))
      .leftJoin(addresses, eq(addresses.id, properties.addressId))
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
    const tenantRows = propertyIds.length
      ? await tx
          .select({
            partyId: leases.tenantPartyId,
            name: parties.displayName,
            propertyId: units.propertyId,
            unitId: leases.unitId,
          })
          .from(leases)
          .innerJoin(units, eq(units.id, leases.unitId))
          .leftJoin(parties, eq(parties.id, leases.tenantPartyId))
          .where(
            and(
              eq(leases.organizationId, orgId),
              inArray(units.propertyId, propertyIds),
              inArray(leases.status, ['active', 'clearance_pending', 'cancel_requested']),
            ),
          )
          .orderBy(asc(parties.displayName))
      : [];
    return {
      properties: propertyRows.map((row) => ({
        id: row.id,
        nameAr: row.nameAr || row.nameEn || row.id,
        nameEn: row.nameEn || row.nameAr || row.id,
        serial: row.serialNumber,
        place: [row.city, row.wilayat].filter(Boolean).join(' · ') || null,
        ownerPartyId: row.ownerPartyId,
        ownerName: row.ownerName || '',
      })),
      units: unitRows.map((row) => ({
        id: row.id,
        propertyId: row.propertyId,
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
      })),
      tenants: tenantRows
        .filter((row) => row.partyId)
        .map((row) => ({
          partyId: row.partyId,
          name: row.name || row.partyId,
          propertyId: row.propertyId,
          unitId: row.unitId,
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
  paidMinor: string;
  currency: string;
  dueOn: string;
  reviewStatus: string;
  /** Ledger line status from the same builder as tenant invoices. */
  lineStatus: string;
  kind: string;
  leaseId: string | null;
  tenantName: string | null;
  propertyName: string | null;
  unitCode: string | null;
};

export type AccountingChequesSummary = {
  arrearsMinor: string;
  expectedMinor: string;
  overdueCount: number;
  upcomingCount: number;
  currency: string;
  windows: {
    today: { amountMinor: string; count: number };
    week: { amountMinor: string; count: number };
    month: { amountMinor: string; count: number };
    year: { amountMinor: string; count: number };
  };
};

export type AccountingChequesPayload = {
  cheques: AccountingChequeRow[];
  summary: AccountingChequesSummary;
};

/** Stable placeholder when the lease schedule has no physical cheque number. */
function scheduleChequeNumber(
  leaseId: string,
  kind: 'RENT' | 'VAT',
  index: number,
  explicit: string | null | undefined,
): string {
  const trimmed = (explicit ?? '').trim();
  if (trimmed) return trimmed.slice(0, 80);
  const short = leaseId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `SCH-${short}-${kind}-${index}`.slice(0, 80);
}

function reviewStatusFromLine(
  chequeStatus: string | null,
  lineStatus: string,
): string {
  if (chequeStatus) return chequeStatus;
  if (lineStatus === 'paid') return 'cleared';
  if (lineStatus === 'bounced') return 'bounced';
  if (lineStatus === 'stopped') return 'cancelled';
  if (lineStatus === 'collecting') return 'deposited';
  return 'pending';
}

/**
 * Pull rent/VAT schedule rows from signed / active lease contracts into `cheques`
 * when they are not already registered (idempotent by org + cheque number).
 * Rows without a physical cheque number get a stable `SCH-…` placeholder so the
 * register matches tenant invoices.
 */
async function ensureChequesFromApprovedLeases(
  tx: GlTx,
  orgId: string,
  ownerPartyId: string | null,
): Promise<void> {
  const leaseRows = await tx
    .select({
      leaseId: leases.id,
      tenantPartyId: leases.tenantPartyId,
      currency: leases.currency,
      leaseTerms: sql<unknown>`${contracts.payloadSnapshot}->'leaseTerms'`,
    })
    .from(leases)
    .innerJoin(contracts, eq(contracts.id, leases.contractId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(
      and(
        eq(leases.organizationId, orgId),
        or(
          eq(contracts.status, 'signed'),
          inArray(leases.status, ['active', 'clearance_pending', 'ended', 'cancel_requested']),
        ),
        ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
      ),
    )
    .limit(500);

  if (!leaseRows.length) return;

  const existing = await tx
    .select({ chequeNumber: cheques.chequeNumber })
    .from(cheques)
    .where(eq(cheques.organizationId, orgId));
  const seen = new Set(existing.map((row) => row.chequeNumber.toLowerCase()));
  const toInsert: Array<{
    organizationId: string;
    leaseId: string;
    ownerPartyId: string;
    bankName: string;
    chequeNumber: string;
    amountMinor: bigint;
    currency: string;
    dueOn: string;
  }> = [];

  for (const lease of leaseRows) {
    const terms = ledgerTermsOf({ leaseTerms: lease.leaseTerms });
    if (!terms) continue;
    const scheduleRows = [
      ...terms.schedule.map((row) => ({
        number: scheduleChequeNumber(lease.leaseId, 'RENT', row.index, row.chequeNumber),
        bank: row.bankName,
        dueOn: row.dueOn,
        amountMinor: Math.round(Number(row.totalMinor) || 0),
      })),
      ...terms.vatCheques.map((row) => ({
        number: scheduleChequeNumber(lease.leaseId, 'VAT', row.index, row.chequeNumber),
        bank: null as string | null,
        dueOn: row.dueOn,
        amountMinor: Math.round(Number(row.amountMinor) || 0),
      })),
    ];
    for (const row of scheduleRows) {
      if (!ISO_DATE.test(row.dueOn) || row.amountMinor <= 0) continue;
      const key = row.number.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      toInsert.push({
        organizationId: orgId,
        leaseId: lease.leaseId,
        ownerPartyId: lease.tenantPartyId,
        bankName: (row.bank ?? '—').slice(0, 160) || '—',
        chequeNumber: row.number,
        amountMinor: BigInt(row.amountMinor),
        currency: lease.currency || 'OMR',
        dueOn: row.dueOn,
      });
    }
  }

  if (toInsert.length) {
    await tx.insert(cheques).values(toInsert).onConflictDoNothing();
  }
}

/**
 * Tenant collection register: same lease schedule / arrears logic as tenant invoices,
 * merged with cheque review status and property labels.
 */
export async function listAccountingCheques(
  claims: SessionClaims,
): Promise<AccountingChequesPayload> {
  if (!canReadAccounting(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const ownerPartyId = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    await ensureChequesFromApprovedLeases(tx, orgId, ownerPartyId);

    const leaseRows = await tx
      .select({
        leaseId: leases.id,
        tenantPartyId: leases.tenantPartyId,
        currency: leases.currency,
        tenantName: parties.displayName,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        unitCode: units.code,
        propertyOwnerPartyId: properties.ownerPartyId,
        leaseTerms: sql<unknown>`${contracts.payloadSnapshot}->'leaseTerms'`,
        contractAmountMinor: sql<
          string | null
        >`${contracts.payloadSnapshot}->'amount'->>'amountMinor'`,
      })
      .from(leases)
      .innerJoin(contracts, eq(contracts.id, leases.contractId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .leftJoin(parties, eq(parties.id, leases.tenantPartyId))
      .where(
        and(
          eq(leases.organizationId, orgId),
          or(
            eq(contracts.status, 'signed'),
            inArray(leases.status, ['active', 'clearance_pending', 'ended', 'cancel_requested']),
          ),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(500);

    const leaseIds = leaseRows.map((row) => row.leaseId);
    const [chequeRows, invoiceRows, orphanCheques] = await Promise.all([
      leaseIds.length
        ? tx
            .select({
              id: cheques.id,
              leaseId: cheques.leaseId,
              chequeNumber: cheques.chequeNumber,
              bankName: cheques.bankName,
              amountMinor: cheques.amountMinor,
              dueOn: cheques.dueOn,
              reviewStatus: cheques.reviewStatus,
            })
            .from(cheques)
            .where(and(eq(cheques.organizationId, orgId), inArray(cheques.leaseId, leaseIds)))
            .limit(4000)
        : Promise.resolve([]),
      leaseIds.length
        ? tx
            .select({
              id: invoices.id,
              leaseId: invoices.leaseId,
              number: invoices.invoiceNumber,
              status: invoices.status,
              issuedOn: invoices.issuedOn,
              dueOn: invoices.dueOn,
              totalMinor: invoices.totalMinor,
              paidMinor: invoices.paidMinor,
              billingPeriodStart: invoices.billingPeriodStart,
            })
            .from(invoices)
            .where(
              and(
                eq(invoices.organizationId, orgId),
                inArray(invoices.leaseId, leaseIds),
                ne(invoices.status, 'draft'),
              ),
            )
            .limit(4000)
        : Promise.resolve([]),
      tx
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
        .limit(2000),
    ]);

    const today = muscatToday();
    const usedChequeIds = new Set<string>();
    const out: AccountingChequeRow[] = [];
    let arrears = 0n;
    let expected = 0n;
    let overdueCount = 0;
    let upcomingCount = 0;
    let currency = 'OMR';

    for (const lease of leaseRows) {
      currency = lease.currency || currency;
      const terms = ledgerTermsOf({ leaseTerms: lease.leaseTerms });
      if (terms) {
        // Align schedule cheque numbers with the placeholders we sync into `cheques`.
        terms.schedule = terms.schedule.map((row) => ({
          ...row,
          chequeNumber: scheduleChequeNumber(lease.leaseId, 'RENT', row.index, row.chequeNumber),
        }));
        terms.vatCheques = terms.vatCheques.map((row) => ({
          ...row,
          chequeNumber: scheduleChequeNumber(lease.leaseId, 'VAT', row.index, row.chequeNumber),
        }));
      }
      const statement = buildLeaseStatement({
        terms,
        contractAmountMinor: lease.contractAmountMinor,
        cheques: chequeRows
          .filter((cheque) => cheque.leaseId === lease.leaseId)
          .map((cheque) => ({
            id: cheque.id,
            chequeNumber: cheque.chequeNumber,
            bankName: cheque.bankName,
            amountMinor: cheque.amountMinor.toString(),
            dueOn: String(cheque.dueOn),
            reviewStatus: cheque.reviewStatus,
          })),
        invoices: invoiceRows
          .filter((invoice) => invoice.leaseId === lease.leaseId)
          .map((invoice) => ({
            id: invoice.id,
            number: invoice.number,
            status: invoice.status,
            issuedOn: String(invoice.issuedOn),
            dueOn: String(invoice.dueOn),
            totalMinor: invoice.totalMinor.toString(),
            paidMinor: invoice.paidMinor.toString(),
            billingPeriodStart: invoice.billingPeriodStart
              ? String(invoice.billingPeriodStart)
              : null,
          })),
        today,
      });

      arrears += BigInt(statement.arrears.totalMinor || '0');
      for (const line of statement.lines) {
        if (line.kind !== 'rent' && line.kind !== 'vat' && line.kind !== 'cheque') continue;
        if (line.chequeId) usedChequeIds.add(line.chequeId);
        const amount = BigInt(line.amountMinor || '0');
        const paid = BigInt(line.paidMinor || '0');
        const open = amount > paid ? amount - paid : 0n;
        if (line.status === 'overdue' || line.status === 'bounced') {
          overdueCount += 1;
        } else if (
          open > 0n &&
          (line.status === 'upcoming' || line.status === 'due_soon' || line.status === 'due')
        ) {
          expected += open;
          upcomingCount += 1;
        }
        out.push({
          id: line.chequeId ?? `line:${lease.leaseId}:${line.key}`,
          chequeNumber: line.chequeNumber || '—',
          bankName: line.bankName || '—',
          amountMinor: line.amountMinor,
          paidMinor: line.paidMinor,
          currency: lease.currency || 'OMR',
          dueOn: line.dueOn,
          reviewStatus: reviewStatusFromLine(line.chequeStatus, line.status),
          lineStatus: line.status,
          kind: line.kind,
          leaseId: lease.leaseId,
          tenantName: lease.tenantName,
          propertyName: lease.propertyNameAr || lease.propertyNameEn || null,
          unitCode: lease.unitCode,
        });
      }
    }

    for (const row of orphanCheques) {
      if (usedChequeIds.has(row.id)) continue;
      if (ownerPartyId && row.propertyOwnerPartyId && row.propertyOwnerPartyId !== ownerPartyId) {
        continue;
      }
      const dueOn = String(row.dueOn);
      const closed =
        row.reviewStatus === 'cleared' ||
        row.reviewStatus === 'cancelled' ||
        row.reviewStatus === 'rejected';
      let lineStatus = 'upcoming';
      if (row.reviewStatus === 'cleared') lineStatus = 'paid';
      else if (row.reviewStatus === 'bounced') lineStatus = 'bounced';
      else if (row.reviewStatus === 'cancelled') lineStatus = 'stopped';
      else if (row.reviewStatus === 'deposited') lineStatus = 'collecting';
      else if (dueOn < today) lineStatus = 'overdue';
      else if (dueOn <= today) lineStatus = 'due_soon';
      if (lineStatus === 'overdue' || lineStatus === 'bounced') overdueCount += 1;
      else if (!closed && dueOn >= today) {
        expected += row.amountMinor;
        upcomingCount += 1;
      }
      out.push({
        id: row.id,
        chequeNumber: row.chequeNumber,
        bankName: row.bankName,
        amountMinor: row.amountMinor.toString(),
        paidMinor: row.reviewStatus === 'cleared' ? row.amountMinor.toString() : '0',
        currency: row.currency,
        dueOn,
        reviewStatus: row.reviewStatus,
        lineStatus,
        kind: 'cheque',
        leaseId: row.leaseId,
        tenantName: row.tenantName,
        propertyName: row.propertyNameAr || row.propertyNameEn || null,
        unitCode: row.unitCode,
      });
    }

    out.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.chequeNumber.localeCompare(b.chequeNumber));

    const weekEnd = plusIsoDays(today, 7);
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthEnd = plusIsoDays(
      `${today.slice(0, 7)}-${new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate().toString().padStart(2, '0')}`,
      0,
    );
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const yearEnd = `${today.slice(0, 4)}-12-31`;
    const bucket = (match: (dueOn: string) => boolean) => {
      let amount = 0n;
      let count = 0;
      for (const row of out) {
        if (!openCheque(row) || !match(row.dueOn)) continue;
        const left = BigInt(row.amountMinor) - BigInt(row.paidMinor || '0');
        if (left <= 0n) continue;
        amount += left;
        count += 1;
      }
      return { amountMinor: amount.toString(), count };
    };

    return {
      cheques: out.slice(0, 4000),
      summary: {
        arrearsMinor: arrears.toString(),
        expectedMinor: expected.toString(),
        overdueCount,
        upcomingCount,
        currency,
        windows: {
          today: bucket((due) => due === today),
          week: bucket((due) => due >= today && due <= weekEnd),
          month: bucket((due) => due >= monthStart && due <= monthEnd),
          year: bucket((due) => due >= yearStart && due <= yearEnd),
        },
      },
    };
  });
}

function plusIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function openCheque(row: AccountingChequeRow): boolean {
  return (
    row.lineStatus !== 'paid' &&
    row.reviewStatus !== 'cleared' &&
    row.reviewStatus !== 'cancelled' &&
    row.reviewStatus !== 'rejected'
  );
}

/** Accountant confirms the office received the installment. Marks the cheque cleared. */
export async function confirmChequeCollected(claims: SessionClaims, id: string): Promise<{ id: string }> {
  if (!canManageAccounting(claims)) fail('forbidden');
  if (!UUID.test(id)) fail('invalid_input');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const row = await tx
      .select({ id: cheques.id, status: cheques.reviewStatus })
      .from(cheques)
      .where(and(eq(cheques.id, id), eq(cheques.organizationId, orgId)))
      .limit(1);
    if (!row[0]) fail('not_found');
    if (row[0].status === 'cancelled' || row[0].status === 'rejected') fail('invalid_input');
    await tx
      .update(cheques)
      .set({ reviewStatus: 'cleared', updatedAt: new Date() })
      .where(eq(cheques.id, id));
    return { id };
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
