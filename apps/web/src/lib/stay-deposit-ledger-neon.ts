import 'server-only';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  properties,
  stayBookingGuests,
  stayBookings,
  stayProfiles,
  stayRefunds,
  units,
  type Database,
} from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import {
  loadStayAccountingRowsForViewer,
  ownerPartyScope,
  readClaims,
  withinViewerTenant,
} from '@/lib/portal-ops-data';
import {
  depositHolding,
  depositReceiptNumbers,
  maskAccount,
  retainedDepositMinor,
  type DepositRefundView,
} from '@/lib/stay-deposit-refund';
import { loadDepositRefunds } from '@/lib/stay-deposit-refund-neon';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Flat, display-ready row (same shape as the property hub rows). */
export type DepositLedgerRow = Record<string, string | null>;

const LEDGER_LIMIT = 500;

/** A deposit is received at check-in; stays before that hold no guest money as deposit. */
const STAYS_HOLDING_DEPOSIT = ['checked_in', 'checked_out', 'closed'] as const;

/** Full account numbers for refund approvers and accountants; masked for everyone else. */
export function accountReader(revealAccounts: boolean) {
  return (value: string | null | undefined) =>
    !value ? null : revealAccounts ? value : maskAccount(value);
}

/** Refund request, decision and transfer of one stay, as flat row fields. */
export function refundFields(
  refund: DepositRefundView | undefined,
  account: (value: string | null | undefined) => string | null,
): DepositLedgerRow {
  const transfer = refund?.transfer;
  return {
    refundStatus: refund?.status ?? null,
    refundAmountMinor: refund?.amountMinor ?? null,
    refundRequestedAt: refund?.requestedAt ?? null,
    refundRequestedBy: refund?.requestedBy ?? null,
    refundGuestNote: refund?.guestNote ?? null,
    refundGuestMethod: refund?.guestPayout?.method ?? null,
    refundGuestAccount: account(refund?.guestPayout?.account),
    refundGuestBank: refund?.guestPayout?.bank ?? null,
    refundGuestHolder: refund?.guestPayout?.holder ?? null,
    refundGuestPhone: account(refund?.guestPayout?.phone),
    refundDecidedAt: refund?.decidedAt ?? null,
    refundDecidedBy: refund?.decidedBy ?? null,
    refundDecisionNote: refund?.decisionNote ?? null,
    refundPaidAt: transfer?.at ?? null,
    refundPaidMethod: transfer?.method ?? null,
    refundPaidAccount: account(transfer?.account),
    refundPaidBank: transfer?.bank ?? null,
    refundPaidHolder: transfer?.holder ?? null,
    refundPaidReference: transfer?.reference ?? null,
    refundPaidBy: transfer?.recordedBy ?? null,
    refundReceipt: transfer?.hasReceipt ? '1' : null,
  };
}

function isoDay(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
}

/**
 * Stay deposits as a trust ledger, apart from income: one row per stay that received a
 * deposit, with what was refunded to the guest and what the property kept as income.
 */
export async function loadDepositLedger(
  tx: Tx,
  orgId: string,
  scope: { propertyId?: string | null; ownerPartyId?: string | null },
  revealAccounts: boolean,
): Promise<DepositLedgerRow[]> {
  const stays = await tx
    .select({
      id: stayBookings.id,
      referenceCode: stayBookings.referenceCode,
      status: stayBookings.status,
      currency: stayBookings.currency,
      propertyId: stayBookings.propertyId,
      propertyNameAr: properties.nameAr,
      propertyNameEn: properties.nameEn,
      unitCode: units.code,
      checkInOn: stayBookings.checkInOn,
      checkOutOn: stayBookings.checkOutOn,
      depositMinor: stayProfiles.depositMinor,
      contactName: sql<
        string | null
      >`${stayBookings.pricingSnapshotJson}->'guestContact'->>'displayName'`,
    })
    .from(stayBookings)
    .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
    .leftJoin(stayProfiles, eq(stayProfiles.id, stayBookings.stayProfileId))
    .leftJoin(units, eq(units.id, stayBookings.unitId))
    .where(
      and(
        eq(stayBookings.organizationId, orgId),
        eq(properties.organizationId, orgId),
        inArray(stayBookings.status, [...STAYS_HOLDING_DEPOSIT]),
        ...(scope.propertyId ? [eq(stayBookings.propertyId, scope.propertyId)] : []),
        ...(scope.ownerPartyId ? [eq(properties.ownerPartyId, scope.ownerPartyId)] : []),
        or(
          sql`${stayProfiles.depositMinor} > 0`,
          sql`exists (select 1 from ${stayRefunds} where ${stayRefunds.organizationId} = ${orgId} and ${stayRefunds.idempotencyKey} = 'deposit:' || ${stayBookings.id}::text)`,
        ),
      ),
    )
    .orderBy(desc(stayBookings.checkInOn))
    .limit(LEDGER_LIMIT);
  if (!stays.length) return [];
  const ids = stays.map((row) => row.id);
  const [refunds, guests] = await Promise.all([
    loadDepositRefunds(tx, orgId, ids),
    tx
      .select({ bookingId: stayBookingGuests.bookingId, name: stayBookingGuests.displayName })
      .from(stayBookingGuests)
      .where(and(inArray(stayBookingGuests.bookingId, ids), eq(stayBookingGuests.isPrimary, true))),
  ]);
  const guestByBooking = new Map(guests.map((row) => [row.bookingId, row.name]));
  const account = accountReader(revealAccounts);
  return stays.flatMap((row) => {
    const refund = refunds.get(row.id);
    const deposit =
      refund?.settledDepositMinor ??
      (row.depositMinor && row.depositMinor > 0n ? row.depositMinor.toString() : null);
    if (!deposit) return [];
    const refunded = refund?.status === 'executed' ? refund.amountMinor : null;
    const retained = retainedDepositMinor(deposit, refund?.status, refund?.amountMinor);
    const receipts = depositReceiptNumbers(row.referenceCode);
    const settledOn =
      refund?.status === 'executed'
        ? (refund.transfer?.at ?? refund.decidedAt)
        : refund?.status === 'rejected'
          ? refund.decidedAt
          : null;
    return [
      {
        ...refundFields(refund, account),
        id: row.id,
        kind: 'deposit',
        reference: row.referenceCode,
        bookingStatus: row.status,
        status: depositHolding(row.status, refund?.status),
        propertyId: row.propertyId,
        propertyName: row.propertyNameAr || row.propertyNameEn || null,
        propertyNameEn: row.propertyNameEn || row.propertyNameAr || null,
        unitCode: row.unitCode ?? null,
        party: guestByBooking.get(row.id) ?? row.contactName,
        currency: refund?.currency || row.currency,
        depositMinor: deposit,
        refundedMinor: refunded,
        retainedMinor: retained,
        receivedOn: isoDay(row.checkInOn),
        checkOutOn: isoDay(row.checkOutOn),
        settledOn: settledOn ?? null,
        refundReceiptNo: refunded ? receipts.refund : null,
        incomeReceiptNo: retained ? receipts.income : null,
      },
    ];
  });
}

export type DepositLedgerViewer = {
  canPayRefunds: boolean;
  canDecideRefunds: boolean;
};

/** Who may open the deposits ledger: accountants, refund approvers and booking managers. */
export function canReadDepositLedger(claims: SessionClaims): boolean {
  return (
    hasPermission(claims, 'accounting.read') ||
    hasPermission(claims, 'payment.refund') ||
    hasPermission(claims, 'stay.refund.approve') ||
    hasPermission(claims, 'stay.booking.manage')
  );
}

/** Deposits ledger of the viewer's organization (owners see their own properties only). */
export async function loadDepositLedgerForViewer(
  claims: SessionClaims,
): Promise<{ rows: DepositLedgerRow[]; viewer: DepositLedgerViewer }> {
  const orgId = claims.organizationId;
  const viewer: DepositLedgerViewer = {
    canPayRefunds: hasPermission(claims, 'payment.refund'),
    canDecideRefunds:
      hasPermission(claims, 'stay.booking.manage') || hasPermission(claims, 'stay.refund.approve'),
  };
  if (!orgId) return { rows: [], viewer };
  const revealAccounts = viewer.canPayRefunds || viewer.canDecideRefunds;
  const rows = await withinViewerTenant(claims, (tx) =>
    loadDepositLedger(tx, orgId, { ownerPartyId: ownerPartyScope(claims) }, revealAccounts),
  );
  return { rows, viewer };
}

/**
 * Income lines from stays for the accounting list: stay payments plus kept deposit deductions.
 * Deposits held in trust are not income and never appear here.
 */
export async function loadStayIncomeRowsForViewer(): Promise<Record<string, unknown>[]> {
  const [payments, kept] = await Promise.all([
    loadStayAccountingRowsForViewer(),
    (async () => {
      if (!hasDatabaseUrl()) return [];
      const claims = await readClaims();
      if (!claims?.organizationId) return [];
      try {
        return await loadRetainedDepositIncome(claims);
      } catch {
        return [];
      }
    })(),
  ]);
  return [...kept, ...payments];
}

/**
 * Kept deposits as income lines of the general accounting list. The deposits themselves stay
 * out of it: only the deducted part becomes the property's income.
 */
export async function loadRetainedDepositIncome(
  claims: SessionClaims,
): Promise<Record<string, unknown>[]> {
  const orgId = claims.organizationId;
  if (!orgId) return [];
  const rows = await withinViewerTenant(claims, (tx) =>
    loadDepositLedger(tx, orgId, { ownerPartyId: ownerPartyScope(claims) }, false),
  );
  return rows.flatMap((row) => {
    if (!row.retainedMinor) return [];
    const property = row.propertyName ?? '—';
    const note = row.refundDecisionNote;
    const description = `دخل من خصم تأمين ${row.reference} · ${property}${note ? ` · ${note}` : ''}`;
    return [
      {
        id: `deposit-income-${row.id}`,
        recordKind: 'deposit_retained',
        status: 'posted',
        reference: row.incomeReceiptNo,
        description,
        memo: description,
        occurredOn: isoDay(row.settledOn),
        currency: row.currency,
        amountMinor: row.retainedMinor,
        debitMinor: row.retainedMinor,
        creditMinor: '0',
        propertyId: row.propertyId,
        bookingId: row.id,
        depositMinor: row.depositMinor,
        refundedMinor: row.refundedMinor,
        refundReceiptNo: row.refundReceiptNo,
        createdAt: row.settledOn,
      },
    ];
  });
}
