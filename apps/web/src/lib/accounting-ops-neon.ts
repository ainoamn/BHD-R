import 'server-only';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { SessionClaims } from '@bhd-r/authz';
import type { CurrencyCode } from '@bhd-r/contracts';
import {
  addresses,
  chequeOperations,
  cheques,
  contracts,
  invoices,
  journalEntries,
  journalLines,
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
  postingChequeBounce,
  postingChequeCancelReceive,
  postingChequeCollect,
  postingChequeDeposit,
  postingChequeReceive,
  postingChequeRedeposit,
  postingIncomeReceived,
  postingPurchase,
  postingSale,
  type PostingDimensions,
} from '@/lib/accounting-posting';
import type { JournalLineInput } from '@/lib/accounting-gl';
import type { ChequeImportRow } from '@/lib/accounting-ops';
import { muscatToday } from '@/lib/contract-list-facets';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import {
  buildLeaseStatement,
  ledgerTermsOf,
  scheduleChequeNumber,
  withAlignedScheduleCheques,
} from '@/lib/tenant-ledger';

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

export type ChequeRegisterStatus =
  | 'pending'
  | 'in_hand'
  | 'under_collection'
  | 'cleared'
  | 'bounced'
  | 'cancelled';

export type ChequeOperationName =
  | 'receive'
  | 'deposit'
  | 'collect'
  | 'bounce'
  | 'redeposit'
  | 'cancel'
  | 'postpone'
  | 'undo';

export type ChequeOperationSummary = {
  id: string;
  operation: ChequeOperationName;
  fromStatus: string | null;
  toStatus: string | null;
  occurredOn: string;
  notes: string | null;
  bounceReason: string | null;
  journalEntryId: string | null;
  createdAt: string;
};

export type AccountingChequeRow = {
  id: string;
  chequeNumber: string;
  bankName: string;
  amountMinor: string;
  paidMinor: string;
  currency: string;
  dueOn: string;
  reviewStatus: ChequeRegisterStatus | string;
  bounceReason: string | null;
  receivedOn: string | null;
  depositedOn: string | null;
  clearedOn: string | null;
  /** Ledger line status from the same builder as tenant invoices. */
  lineStatus: string;
  kind: string;
  /** Ledger / rent-document line key (`rent-3`, `cheque-…`) for receipt & invoice links. */
  lineKey: string | null;
  leaseId: string | null;
  tenantName: string | null;
  propertyName: string | null;
  unitCode: string | null;
  operations: ChequeOperationSummary[];
};

export type AccountingChequesSummary = {
  arrearsMinor: string;
  expectedMinor: string;
  overdueCount: number;
  upcomingCount: number;
  paidCount: number;
  paidMinor: string;
  remainingCount: number;
  remainingMinor: string;
  pastCount: number;
  depositCount: number;
  depositMinor: string;
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
  /** Schedule rows awaiting accountant receipt confirmation — not yet on the live register. */
  awaitingReceipt?: AccountingChequeRow[];
  summary: AccountingChequesSummary;
};

const REGISTER_STATUSES = [
  'pending',
  'in_hand',
  'under_collection',
  'cleared',
  'bounced',
  'cancelled',
] as const;

const CHEQUE_OPERATIONS = [
  'receive',
  'deposit',
  'collect',
  'bounce',
  'redeposit',
  'cancel',
  'postpone',
  'undo',
] as const;

function isRegisterStatus(value: string): value is ChequeRegisterStatus {
  return (REGISTER_STATUSES as readonly string[]).includes(value);
}

function isChequeOperation(value: string): value is ChequeOperationName {
  return (CHEQUE_OPERATIONS as readonly string[]).includes(value);
}

/** Map legacy free-lifecycle values onto the PDC register model. */
export function normalizeChequeRegisterStatus(raw: string | null | undefined): ChequeRegisterStatus {
  const value = (raw ?? '').trim();
  if (isRegisterStatus(value)) return value;
  // Awaiting accountant receipt confirmation — keep pending until accepted.
  if (value === 'pending') return 'pending';
  if (value === 'accepted' || value === 'postponed') return 'in_hand';
  if (value === 'deposited') return 'under_collection';
  if (value === 'insufficient_funds') return 'bounced';
  if (value === 'partially_cleared') return 'cleared';
  if (value === 'rejected') return 'cancelled';
  if (value === 'cleared' || value === 'bounced' || value === 'cancelled') return value;
  return 'in_hand';
}

function reviewStatusFromLine(chequeStatus: string | null, lineStatus: string): ChequeRegisterStatus {
  if (chequeStatus) return normalizeChequeRegisterStatus(chequeStatus);
  if (lineStatus === 'paid' || lineStatus === 'partially_paid') return 'cleared';
  if (lineStatus === 'bounced') return 'bounced';
  if (lineStatus === 'stopped') return 'cancelled';
  if (lineStatus === 'collecting') return 'under_collection';
  return 'in_hand';
}

function receiveCreditCode(chequeNumber: string): '1200' | '4000' | '2100' {
  if (/-DEP-/i.test(chequeNumber)) return '2100';
  return '1200';
}

function parsePrevDueNote(notes: string | null | undefined): string | null {
  const match = (notes ?? '').match(/prev_due=(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function postponeNotes(prevDue: string, userNotes?: string): string {
  const base = `prev_due=${prevDue}`;
  const extra = userNotes?.trim();
  return extra ? `${base}\n${extra}`.slice(0, 2000) : base;
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
    reviewStatus: 'pending';
    receivedOn: string | null;
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
      ...terms.depositItems
        .map((item, at) => ({ item, at }))
        .filter(({ item }) => item.method === 'cheque')
        .map(({ item, at }) => ({
          number: scheduleChequeNumber(lease.leaseId, 'DEP', at + 1, item.reference),
          bank: item.bankName,
          dueOn: item.dueOn ?? terms.startsOn,
          amountMinor: Math.round(Number(item.amountMinor) || 0),
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
        // Stay hidden from the live register until the accountant confirms receipt.
        reviewStatus: 'pending',
        receivedOn: null,
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
    const [chequeRows, invoiceRows, orphanCheques, operationRows] = await Promise.all([
      leaseIds.length
        ? tx
            .select({
              id: cheques.id,
              leaseId: cheques.leaseId,
              chequeNumber: cheques.chequeNumber,
              bankName: cheques.bankName,
              amountMinor: cheques.amountMinor,
              collectedMinor: cheques.collectedMinor,
              dueOn: cheques.dueOn,
              reviewStatus: cheques.reviewStatus,
              bounceReason: cheques.bounceReason,
              receivedOn: cheques.receivedOn,
              depositedOn: cheques.depositedOn,
              clearedOn: cheques.clearedOn,
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
          collectedMinor: cheques.collectedMinor,
          currency: cheques.currency,
          dueOn: cheques.dueOn,
          reviewStatus: cheques.reviewStatus,
          bounceReason: cheques.bounceReason,
          receivedOn: cheques.receivedOn,
          depositedOn: cheques.depositedOn,
          clearedOn: cheques.clearedOn,
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
      tx
        .select({
          id: chequeOperations.id,
          chequeId: chequeOperations.chequeId,
          operation: chequeOperations.operation,
          fromStatus: chequeOperations.fromStatus,
          toStatus: chequeOperations.toStatus,
          occurredOn: chequeOperations.occurredOn,
          notes: chequeOperations.notes,
          bounceReason: chequeOperations.bounceReason,
          journalEntryId: chequeOperations.journalEntryId,
          createdAt: chequeOperations.createdAt,
          undoneAt: chequeOperations.undoneAt,
        })
        .from(chequeOperations)
        .where(and(eq(chequeOperations.organizationId, orgId), isNull(chequeOperations.undoneAt)))
        .orderBy(desc(chequeOperations.createdAt))
        .limit(8000),
    ]);

    const opsByCheque = new Map<string, ChequeOperationSummary[]>();
    for (const op of operationRows) {
      const list = opsByCheque.get(op.chequeId) ?? [];
      if (list.length >= 5) continue;
      list.push({
        id: op.id,
        operation: op.operation as ChequeOperationName,
        fromStatus: op.fromStatus,
        toStatus: op.toStatus,
        occurredOn: String(op.occurredOn),
        notes: op.notes,
        bounceReason: op.bounceReason,
        journalEntryId: op.journalEntryId,
        createdAt: op.createdAt.toISOString(),
      });
      opsByCheque.set(op.chequeId, list);
    }

    const chequeMeta = new Map(
      chequeRows.map((row) => [
        row.id,
        {
          bounceReason: row.bounceReason,
          receivedOn: row.receivedOn ? String(row.receivedOn) : null,
          depositedOn: row.depositedOn ? String(row.depositedOn) : null,
          clearedOn: row.clearedOn ? String(row.clearedOn) : null,
          reviewStatus: normalizeChequeRegisterStatus(row.reviewStatus),
        },
      ]),
    );

    const today = muscatToday();
    const usedChequeIds = new Set<string>();
    const out: AccountingChequeRow[] = [];
    let arrears = 0n;
    let expected = 0n;
    let overdueCount = 0;
    let upcomingCount = 0;
    let paidCount = 0;
    let paidMinor = 0n;
    let remainingCount = 0;
    let remainingMinor = 0n;
    let pastCount = 0;
    let depositCount = 0;
    let depositMinor = 0n;
    let currency = 'OMR';

    for (const lease of leaseRows) {
      currency = lease.currency || currency;
      const parsed = ledgerTermsOf({ leaseTerms: lease.leaseTerms });
      const terms = parsed ? withAlignedScheduleCheques(parsed, lease.leaseId) : null;
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
            collectedMinor: cheque.collectedMinor?.toString() ?? null,
            dueOn: String(cheque.dueOn),
            reviewStatus: normalizeChequeRegisterStatus(
              cheque.reviewStatus,
            ) as import('@/lib/tenant-ledger').LedgerChequeStatus,
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
        // Include rent, VAT, deposit insurance, and standalone cheques.
        if (
          line.kind !== 'rent' &&
          line.kind !== 'vat' &&
          line.kind !== 'cheque' &&
          line.kind !== 'deposit'
        ) {
          continue;
        }
        // Skip non-cheque deposit payments (cash/transfer) — register tracks cheques only.
        if (line.kind === 'deposit' && !line.chequeNumber && !line.chequeId) continue;
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
        if (line.status === 'paid' || paid >= amount) {
          paidCount += 1;
          paidMinor += amount;
        } else if (open > 0n) {
          remainingCount += 1;
          remainingMinor += open;
        }
        if (line.dueOn < today) pastCount += 1;
        if (line.kind === 'deposit') {
          depositCount += 1;
          depositMinor += amount;
        }
        const meta = line.chequeId ? chequeMeta.get(line.chequeId) : undefined;
        const registerStatus = reviewStatusFromLine(line.chequeStatus, line.status);
        out.push({
          id: line.chequeId ?? `line:${lease.leaseId}:${line.key}`,
          chequeNumber: line.chequeNumber || '—',
          bankName: line.bankName || '—',
          amountMinor: line.amountMinor,
          paidMinor: line.paidMinor,
          currency: lease.currency || 'OMR',
          dueOn: line.dueOn,
          reviewStatus: registerStatus,
          bounceReason: meta?.bounceReason ?? null,
          receivedOn: meta?.receivedOn ?? null,
          depositedOn: meta?.depositedOn ?? null,
          clearedOn: meta?.clearedOn ?? null,
          lineStatus: line.status,
          kind: line.kind,
          lineKey: line.key,
          leaseId: lease.leaseId,
          tenantName: lease.tenantName,
          propertyName: lease.propertyNameAr || lease.propertyNameEn || null,
          unitCode: lease.unitCode,
          operations: line.chequeId ? (opsByCheque.get(line.chequeId) ?? []) : [],
        });
      }
    }

    for (const row of orphanCheques) {
      if (usedChequeIds.has(row.id)) continue;
      if (ownerPartyId && row.propertyOwnerPartyId && row.propertyOwnerPartyId !== ownerPartyId) {
        continue;
      }
      const dueOn = String(row.dueOn);
      const registerStatus = normalizeChequeRegisterStatus(row.reviewStatus);
      const closed = registerStatus === 'cleared' || registerStatus === 'cancelled';
      const awaiting = registerStatus === 'pending';
      const paidAmount = !awaiting && registerStatus === 'cleared' ? row.amountMinor : 0n;
      let lineStatus = awaiting ? 'pending' : 'upcoming';
      if (registerStatus === 'cleared') lineStatus = 'paid';
      else if (registerStatus === 'bounced') lineStatus = 'bounced';
      else if (registerStatus === 'cancelled') lineStatus = 'stopped';
      else if (registerStatus === 'under_collection') lineStatus = 'collecting';
      else if (!awaiting && dueOn < today) lineStatus = 'overdue';
      else if (!awaiting && dueOn <= today) lineStatus = 'due_soon';
      if (!awaiting) {
        if (lineStatus === 'overdue' || lineStatus === 'bounced') overdueCount += 1;
        else if (!closed && dueOn >= today) {
          expected += row.amountMinor;
          upcomingCount += 1;
        }
        if (closed && registerStatus === 'cleared') {
          paidCount += 1;
          paidMinor += paidAmount > 0n ? paidAmount : row.amountMinor;
        } else if (!closed) {
          remainingCount += 1;
          remainingMinor += row.amountMinor - paidAmount;
        }
        if (dueOn < today) pastCount += 1;
      }
      out.push({
        id: row.id,
        chequeNumber: row.chequeNumber,
        bankName: row.bankName,
        amountMinor: row.amountMinor.toString(),
        paidMinor: paidAmount.toString(),
        currency: row.currency,
        dueOn,
        reviewStatus: registerStatus,
        bounceReason: row.bounceReason,
        receivedOn: row.receivedOn ? String(row.receivedOn) : null,
        depositedOn: row.depositedOn ? String(row.depositedOn) : null,
        clearedOn: row.clearedOn ? String(row.clearedOn) : null,
        lineStatus,
        kind: 'cheque',
        lineKey: row.leaseId ? `cheque-${row.id}` : null,
        leaseId: row.leaseId,
        tenantName: row.tenantName,
        propertyName: row.propertyNameAr || row.propertyNameEn || null,
        unitCode: row.unitCode,
        operations: opsByCheque.get(row.id) ?? [],
      });
    }

    out.sort(
      (a, b) => a.dueOn.localeCompare(b.dueOn) || a.chequeNumber.localeCompare(b.chequeNumber),
    );

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

    const awaitingReceipt = out
      .filter((row) => normalizeChequeRegisterStatus(row.reviewStatus) === 'pending')
      .slice(0, 500);
    const live = out
      .filter((row) => normalizeChequeRegisterStatus(row.reviewStatus) !== 'pending')
      .slice(0, 4000);

    return {
      cheques: live,
      awaitingReceipt,
      summary: {
        arrearsMinor: arrears.toString(),
        expectedMinor: expected.toString(),
        overdueCount,
        upcomingCount,
        paidCount,
        paidMinor: paidMinor.toString(),
        remainingCount,
        remainingMinor: remainingMinor.toString(),
        pastCount,
        depositCount,
        depositMinor: depositMinor.toString(),
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
  const status = normalizeChequeRegisterStatus(row.reviewStatus);
  return (
    row.lineStatus !== 'paid' &&
    status !== 'cleared' &&
    status !== 'cancelled' &&
    status !== 'pending'
  );
}

async function reverseJournalEntry(
  tx: GlTx,
  orgId: string,
  actorUserId: string,
  entryId: string,
  description: string,
): Promise<void> {
  const entry = await tx.query.journalEntries.findFirst({
    where: and(
      eq(journalEntries.organizationId, orgId),
      eq(journalEntries.id, entryId),
      eq(journalEntries.status, 'posted'),
    ),
    columns: { id: true, reversalOfId: true },
  });
  if (!entry || entry.reversalOfId) return;
  const already = await tx.query.journalEntries.findFirst({
    where: and(eq(journalEntries.organizationId, orgId), eq(journalEntries.reversalOfId, entry.id)),
    columns: { id: true },
  });
  if (already) {
    await tx
      .update(journalEntries)
      .set({ sourceType: 'cheque_op_undone' })
      .where(eq(journalEntries.id, entry.id));
    return;
  }
  const sourceLines = await tx.select().from(journalLines).where(eq(journalLines.journalEntryId, entry.id));
  if (!sourceLines.length) return;
  const reversalRows = await tx
    .insert(journalEntries)
    .values({
      organizationId: orgId,
      reference: `REV-${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      occurredOn: muscatToday(),
      description: description.slice(0, 500),
      status: 'posted',
      sourceType: 'journal_reversal',
      sourceId: entry.id,
      reversalOfId: entry.id,
      postedByUserId: actorUserId,
      postedAt: new Date(),
    })
    .returning({ id: journalEntries.id });
  if (!reversalRows[0]) return;
  await tx.insert(journalLines).values(
    sourceLines.map((line) => ({
      organizationId: orgId,
      journalEntryId: reversalRows[0]!.id,
      accountId: line.accountId,
      partyId: line.partyId,
      propertyId: line.propertyId,
      unitId: line.unitId,
      debitMinor: line.creditMinor,
      creditMinor: line.debitMinor,
      currency: line.currency,
      minorUnit: line.minorUnit,
      memo: line.memo,
    })),
  );
  await tx
    .update(journalEntries)
    .set({ sourceType: 'cheque_op_undone' })
    .where(eq(journalEntries.id, entry.id));
}

async function leaseDims(
  tx: GlTx,
  orgId: string,
  leaseId: string | null,
): Promise<Pick<PostingDimensions, 'partyId' | 'propertyId' | 'unitId'>> {
  if (!leaseId) return {};
  const lease = await tx
    .select({
      tenantPartyId: leases.tenantPartyId,
      unitId: leases.unitId,
      propertyId: units.propertyId,
    })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(and(eq(leases.id, leaseId), eq(leases.organizationId, orgId)))
    .limit(1);
  if (!lease[0]) return {};
  return {
    ...(lease[0].tenantPartyId ? { partyId: lease[0].tenantPartyId } : {}),
    ...(lease[0].propertyId ? { propertyId: lease[0].propertyId } : {}),
    ...(lease[0].unitId ? { unitId: lease[0].unitId } : {}),
  };
}

type ChequeOpOpts = {
  occurredOn?: string;
  dueOn?: string;
  bounceReason?: string;
  notes?: string;
  bankChargeMinor?: string;
};

/** Strict PDC register operation — one transition + optional journal + operations log. */
export async function applyChequeOperation(
  claims: SessionClaims,
  id: string,
  operation: string,
  opts?: ChequeOpOpts,
): Promise<{ id: string; status: string; operationId: string; journalId?: string }> {
  if (!canManageAccounting(claims)) fail('forbidden');
  if (!UUID.test(id) || !isChequeOperation(operation)) fail('invalid_input');
  const orgId = claims.organizationId!;
  const occurredOn = (opts?.occurredOn ?? muscatToday()).trim();
  if (!ISO_DATE.test(occurredOn)) fail('invalid_input');
  const nextDue = opts?.dueOn?.trim();
  if (nextDue && !ISO_DATE.test(nextDue)) fail('invalid_input');
  const noteText = opts?.notes?.trim();
  const bounceReason = (opts?.bounceReason ?? '').trim().slice(0, 80);
  const bankCharge = opts?.bankChargeMinor?.trim();

  return withinViewerTenant(claims, async (tx) => {
    const row = await tx
      .select({
        id: cheques.id,
        status: cheques.reviewStatus,
        amountMinor: cheques.amountMinor,
        currency: cheques.currency,
        chequeNumber: cheques.chequeNumber,
        dueOn: cheques.dueOn,
        leaseId: cheques.leaseId,
        receivedOn: cheques.receivedOn,
        depositedOn: cheques.depositedOn,
        clearedOn: cheques.clearedOn,
        bounceReason: cheques.bounceReason,
      })
      .from(cheques)
      .where(and(eq(cheques.id, id), eq(cheques.organizationId, orgId)))
      .limit(1);
    if (!row[0]) fail('not_found');
    const current = normalizeChequeRegisterStatus(row[0].status);
    const amount = row[0].amountMinor;
    if (amount <= 0n) fail('invalid_input');
    const dimsBase = await leaseDims(tx, orgId, row[0].leaseId);
    const dims: PostingDimensions = { currency: row[0].currency, ...dimsBase };
    const map = await ensureAccountCodeMap(tx, orgId);
    const memo = `شيك ${row[0].chequeNumber}`.slice(0, 500);

    if (operation === 'undo') {
      const last = await tx
        .select()
        .from(chequeOperations)
        .where(
          and(
            eq(chequeOperations.organizationId, orgId),
            eq(chequeOperations.chequeId, id),
            isNull(chequeOperations.undoneAt),
            ne(chequeOperations.operation, 'undo'),
          ),
        )
        .orderBy(desc(chequeOperations.createdAt))
        .limit(1);
      if (!last[0]) fail('invalid_input');
      const target = last[0];
      if (target.journalEntryId) {
        await reverseJournalEntry(
          tx,
          orgId,
          claims.sub,
          target.journalEntryId,
          `تراجع عملية شيك ${row[0].chequeNumber}`,
        );
      }
      const restoreStatus = normalizeChequeRegisterStatus(
        target.fromStatus ?? current,
      );
      const patch: Record<string, unknown> = {
        reviewStatus: restoreStatus,
        reviewedByUserId: claims.sub,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      };
      if (target.operation === 'deposit' || target.operation === 'redeposit') {
        patch.depositedOn = null;
      }
      if (target.operation === 'collect') {
        patch.clearedOn = null;
        patch.collectedMinor = null;
      }
      if (target.operation === 'bounce') {
        patch.bounceReason = null;
      }
      if (target.operation === 'postpone') {
        const prev = parsePrevDueNote(target.notes);
        if (prev) patch.dueOn = prev;
      }
      if (target.operation === 'receive') {
        patch.receivedOn = null;
      }
      if (target.operation === 'cancel') {
        patch.reviewNotes = null;
      }
      await tx.update(cheques).set(patch).where(eq(cheques.id, id));
      await tx
        .update(chequeOperations)
        .set({ undoneAt: new Date(), updatedAt: new Date() })
        .where(eq(chequeOperations.id, target.id));
      const undoRows = await tx
        .insert(chequeOperations)
        .values({
          organizationId: orgId,
          chequeId: id,
          operation: 'undo',
          fromStatus: current,
          toStatus: restoreStatus,
          occurredOn,
          amountMinor: amount,
          notes: noteText?.slice(0, 2000) ?? `undo:${target.operation}`,
          actorUserId: claims.sub,
        })
        .returning({ id: chequeOperations.id });
      return {
        id,
        status: restoreStatus,
        operationId: undoRows[0]!.id,
      };
    }

    let toStatus: ChequeRegisterStatus = current;
    let lines: JournalLineInput[] | null = null;
    let description = '';
    let opNotes = noteText?.slice(0, 2000) ?? null;
    let opBounce: string | null = null;
    const patch: Record<string, unknown> = {
      reviewedByUserId: claims.sub,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    };

    if (operation === 'receive') {
      // `pending` = schedule synced, awaiting accountant receipt confirmation.
      if (current !== 'in_hand' && current !== 'pending') fail('invalid_transition');
      toStatus = 'in_hand';
      lines = postingChequeReceive(
        map,
        amount.toString(),
        dims,
        memo,
        receiveCreditCode(row[0].chequeNumber),
      );
      description = `استلام شيك ${row[0].chequeNumber}`;
      patch.receivedOn = occurredOn;
      patch.reviewStatus = 'in_hand';
    } else if (operation === 'deposit') {
      if (current !== 'in_hand') fail('invalid_transition');
      // Ensure intermediate 1140 balance exists before moving to under collection.
      const priorReceive = await tx
        .select({ id: chequeOperations.id, journalEntryId: chequeOperations.journalEntryId })
        .from(chequeOperations)
        .where(
          and(
            eq(chequeOperations.chequeId, id),
            eq(chequeOperations.operation, 'receive'),
            isNull(chequeOperations.undoneAt),
          ),
        )
        .limit(1);
      if (!priorReceive[0]?.journalEntryId) {
        const receiveOpId = randomUUID();
        const receivePosted = await postSourceDocumentInTx(tx, {
          organizationId: orgId,
          actorUserId: claims.sub,
          occurredOn,
          description: `استلام شيك ${row[0].chequeNumber}`.slice(0, 500),
          sourceType: 'cheque_op',
          sourceId: receiveOpId,
          lines: postingChequeReceive(
            map,
            amount.toString(),
            dims,
            memo,
            receiveCreditCode(row[0].chequeNumber),
          ),
        });
        await tx.insert(chequeOperations).values({
          id: receiveOpId,
          organizationId: orgId,
          chequeId: id,
          operation: 'receive',
          fromStatus: current,
          toStatus: 'in_hand',
          occurredOn,
          amountMinor: amount,
          notes: 'auto_receive_before_deposit',
          journalEntryId: receivePosted.id,
          actorUserId: claims.sub,
        });
        if (!row[0].receivedOn) patch.receivedOn = occurredOn;
      }
      toStatus = 'under_collection';
      lines = postingChequeDeposit(map, amount.toString(), dims, memo);
      description = `إيداع شيك ${row[0].chequeNumber}`;
      patch.reviewStatus = 'under_collection';
      patch.depositedOn = occurredOn;
    } else if (operation === 'collect') {
      if (current !== 'under_collection') fail('invalid_transition');
      toStatus = 'cleared';
      lines = postingChequeCollect(map, amount.toString(), dims, memo);
      description = `تحصيل شيك ${row[0].chequeNumber}`;
      patch.reviewStatus = 'cleared';
      patch.clearedOn = occurredOn;
      patch.collectedMinor = amount;
    } else if (operation === 'bounce') {
      if (current !== 'under_collection') fail('invalid_transition');
      toStatus = 'bounced';
      const reason = bounceReason || 'insufficient_funds';
      opBounce = reason;
      lines = postingChequeBounce(map, amount.toString(), dims, memo, bankCharge);
      description = `ارتجاع شيك ${row[0].chequeNumber}`;
      patch.reviewStatus = 'bounced';
      patch.bounceReason = reason;
      patch.reviewNotes = noteText?.slice(0, 2000) ?? reason;
    } else if (operation === 'redeposit') {
      if (current !== 'bounced') fail('invalid_transition');
      toStatus = 'under_collection';
      lines = postingChequeRedeposit(map, amount.toString(), dims, memo);
      description = `إعادة إيداع شيك ${row[0].chequeNumber}`;
      patch.reviewStatus = 'under_collection';
      patch.depositedOn = occurredOn;
      patch.bounceReason = null;
    } else if (operation === 'cancel') {
      if (current !== 'in_hand') fail('invalid_transition');
      toStatus = 'cancelled';
      const priorReceive = await tx
        .select({ journalEntryId: chequeOperations.journalEntryId })
        .from(chequeOperations)
        .where(
          and(
            eq(chequeOperations.chequeId, id),
            eq(chequeOperations.operation, 'receive'),
            isNull(chequeOperations.undoneAt),
          ),
        )
        .limit(1);
      if (priorReceive[0]?.journalEntryId) {
        lines = postingChequeCancelReceive(
          map,
          amount.toString(),
          dims,
          memo,
          receiveCreditCode(row[0].chequeNumber),
        );
      }
      description = `إلغاء شيك ${row[0].chequeNumber}`;
      patch.reviewStatus = 'cancelled';
      patch.reviewNotes = noteText?.slice(0, 2000) ?? 'cancelled';
    } else if (operation === 'postpone') {
      if (current !== 'in_hand') fail('invalid_transition');
      if (!nextDue) fail('invalid_input');
      toStatus = 'in_hand';
      opNotes = postponeNotes(String(row[0].dueOn), noteText);
      patch.dueOn = nextDue;
      patch.reviewStatus = 'in_hand';
      patch.reviewNotes = noteText?.slice(0, 2000) ?? 'تأجيل بطلب من المستأجر';
      description = `تأجيل شيك ${row[0].chequeNumber}`;
    } else {
      fail('invalid_input');
    }

    const operationId = randomUUID();
    let journalId: string | undefined;
    if (lines) {
      const posted = await postSourceDocumentInTx(tx, {
        organizationId: orgId,
        actorUserId: claims.sub,
        occurredOn,
        description: description.slice(0, 500),
        sourceType: 'cheque_op',
        sourceId: operationId,
        lines,
      });
      journalId = posted.id;
    }

    await tx.update(cheques).set(patch).where(eq(cheques.id, id));
    await tx.insert(chequeOperations).values({
      id: operationId,
      organizationId: orgId,
      chequeId: id,
      operation,
      fromStatus: current,
      toStatus,
      occurredOn,
      amountMinor: amount,
      notes: opNotes,
      bounceReason: opBounce,
      journalEntryId: journalId ?? null,
      actorUserId: claims.sub,
    });

    return {
      id,
      status: toStatus,
      operationId,
      ...(journalId ? { journalId } : {}),
    };
  });
}

/** Accountant confirms clearance — deposit must already be under collection. */
export async function confirmChequeCollected(
  claims: SessionClaims,
  id: string,
): Promise<{ id: string; journalId?: string }> {
  const result = await applyChequeOperation(claims, id, 'collect');
  return { id: result.id, ...(result.journalId ? { journalId: result.journalId } : {}) };
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
      const leaseId = row.leaseId?.trim() || undefined;
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
        reviewStatus: 'in_hand',
        receivedOn: row.dueOn,
      });
      seen.add(number.toLowerCase());
      imported += 1;
    }
  });

  return { imported, skipped, errors: errors.slice(0, 20) };
}
