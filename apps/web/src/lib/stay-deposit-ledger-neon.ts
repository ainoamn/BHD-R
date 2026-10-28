import 'server-only';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  properties,
  reservations,
  stayBookingGuests,
  stayBookings,
  stayProfiles,
  stayRefunds,
  units,
  type Database,
} from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import {
  listReservationDepositAccountingRows,
  loadStayAccountingRowsForViewer,
  ownerPartyScope,
  readClaims,
  withinViewerTenant,
} from '@/lib/portal-ops-data';
import {
  depositHolding,
  depositReceiptNumbers,
  maskAccount,
  refundDueMinor,
  retainedDepositMinor,
  type DepositRefundView,
} from '@/lib/stay-deposit-refund';
import { depositReceiptState, type DepositClaimView } from '@/lib/stay-deposit-claims';
import { loadDepositClaims } from '@/lib/stay-deposit-claims-neon';
import { loadDepositRefunds } from '@/lib/stay-deposit-refund-neon';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Flat, display-ready row (same shape as the property hub rows). */
export type DepositLedgerRow = Record<string, string | null>;

const LEDGER_LIMIT = 500;

/**
 * Stay statuses that may hold or have held a guest deposit.
 * `confirmed` is included: many stays collect / require the deposit at booking, and past
 * check-in dates without a desk check-in still owe a trust row for the accountant.
 */
const STAYS_HOLDING_DEPOSIT = ['confirmed', 'checked_in', 'checked_out', 'closed'] as const;

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
  const receipt = refund ? depositReceiptState(refund) : null;
  return {
    refundStatus: refund?.status ?? null,
    refundAmountMinor: refund?.amountMinor ?? null,
    refundPaidMinor: refund && refund.paidMinor !== '0' ? refund.paidMinor : null,
    refundDueMinor: refund ? refundDueMinor(refund) : null,
    refundReceiptState: receipt?.state ?? null,
    refundReceiptDeadline: receipt?.deadline ?? null,
    refundReceiptAt: refund?.guestReceiptAt ?? null,
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
    refundPaidNote: transfer?.note ?? null,
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
    const refunded =
      refund?.status === 'executed'
        ? refund.amountMinor
        : refund && refund.paidMinor !== '0'
          ? refund.paidMinor
          : null;
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

/** Website rent/sale booking deposits paid by the client (عربون), shown on the trust ledger. */
async function loadReservationDepositLedgerRows(
  tx: Tx,
  orgId: string,
  ownerPartyId: string | null,
): Promise<DepositLedgerRow[]> {
  const snapshot = reservations.termsSnapshot;
  const rows = await tx
    .select({
      id: reservations.id,
      status: reservations.status,
      currency: reservations.currency,
      referenceCode: sql<string | null>`${snapshot}->>'referenceCode'`,
      mode: sql<string | null>`${snapshot}->>'mode'`,
      depositMinor: sql<string | null>`${snapshot}->>'depositMinor'`,
      paidAt: sql<string | null>`${snapshot}->>'depositPaidAt'`,
      contactName: sql<string | null>`${snapshot}->'contact'->>'fullName'`,
      propertyId: properties.id,
      propertyNameAr: properties.nameAr,
      propertyNameEn: properties.nameEn,
      unitCode: units.code,
    })
    .from(reservations)
    .innerJoin(units, eq(units.id, reservations.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(
      and(
        eq(reservations.organizationId, orgId),
        sql`${snapshot}->>'depositPaidAt' is not null`,
        sql`coalesce(${snapshot}->>'depositMinor','') ~ '^[1-9][0-9]*$'`,
        ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
      ),
    )
    .orderBy(desc(sql`${snapshot}->>'depositPaidAt'`))
    .limit(LEDGER_LIMIT);

  return rows.flatMap((row) => {
    if (!row.depositMinor || !row.paidAt) return [];
    const reference = row.referenceCode ?? row.id.slice(0, 8).toUpperCase();
    const settled =
      row.status === 'converted' || row.status === 'cancelled' || row.status === 'expired';
    return [
      {
        id: row.id,
        kind: 'reservation_deposit',
        reference,
        bookingStatus: row.status,
        status: settled ? 'deposit_settled' : 'deposit_held',
        propertyId: row.propertyId,
        propertyName: row.propertyNameAr || row.propertyNameEn || null,
        propertyNameEn: row.propertyNameEn || row.propertyNameAr || null,
        unitCode: row.unitCode ?? null,
        party: row.contactName,
        currency: row.currency ?? 'OMR',
        depositMinor: row.depositMinor,
        refundedMinor: null,
        retainedMinor: null,
        receivedOn: row.paidAt.slice(0, 10),
        checkOutOn: null,
        settledOn: settled ? row.paidAt.slice(0, 10) : null,
        refundReceiptNo: null,
        incomeReceiptNo: null,
        refundStatus: null,
        refundAmountMinor: null,
        refundPaidMinor: null,
        refundDueMinor: null,
        refundDecisionNote:
          row.mode === 'sale' ? 'عربون حجز شراء من الموقع' : 'عربون حجز إيجار من الموقع',
      },
    ];
  });
}

/** Cancelled stays with an approved/executed booking-payment refund for the accountant. */
async function loadBookingCancelRefundLedgerRows(
  tx: Tx,
  orgId: string,
  scope: { ownerPartyId?: string | null },
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
      contactName: sql<
        string | null
      >`${stayBookings.pricingSnapshotJson}->'guestContact'->>'displayName'`,
    })
    .from(stayRefunds)
    .innerJoin(stayBookings, eq(stayBookings.id, stayRefunds.bookingId))
    .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
    .leftJoin(units, eq(units.id, stayBookings.unitId))
    .where(
      and(
        eq(stayRefunds.organizationId, orgId),
        sql`${stayRefunds.idempotencyKey} like 'booking_cancel:%'`,
        inArray(stayRefunds.status, ['approved', 'executed']),
        eq(stayBookings.organizationId, orgId),
        ...(scope.ownerPartyId ? [eq(properties.ownerPartyId, scope.ownerPartyId)] : []),
      ),
    )
    .orderBy(asc(stayRefunds.updatedAt))
    .limit(LEDGER_LIMIT);
  if (!stays.length) return [];
  const refunds = await loadDepositRefunds(
    tx,
    orgId,
    stays.map((row) => row.id),
  );
  const account = accountReader(revealAccounts);
  return stays.flatMap((row) => {
    const refund = refunds.get(row.id);
    if (!refund) return [];
    const amount = refund.amountMinor;
    const refunded =
      refund.status === 'executed'
        ? refund.amountMinor
        : refund.paidMinor !== '0'
          ? refund.paidMinor
          : null;
    return [
      {
        ...refundFields(refund, account),
        id: row.id,
        kind: 'stay_payment_refund',
        reference: row.referenceCode,
        bookingStatus: row.status,
        status: depositHolding(row.status, refund.status),
        propertyId: row.propertyId,
        propertyName: row.propertyNameAr || row.propertyNameEn || null,
        propertyNameEn: row.propertyNameEn || row.propertyNameAr || null,
        unitCode: row.unitCode ?? null,
        party: row.contactName,
        currency: refund.currency || row.currency,
        depositMinor: amount,
        refundedMinor: refunded,
        retainedMinor: null,
        receivedOn: isoDay(row.checkInOn),
        checkOutOn: isoDay(row.checkOutOn),
        settledOn: refund.status === 'executed' ? (refund.transfer?.at ?? refund.decidedAt) : null,
        refundReceiptNo: null,
        incomeReceiptNo: null,
        refundDecisionNote: refund.decisionNote,
      },
    ];
  });
}

/** Deposits ledger of the viewer's organization (owners see their own properties only). */
export async function loadDepositLedgerForViewer(claims: SessionClaims): Promise<{
  rows: DepositLedgerRow[];
  claims: Record<string, DepositClaimView[]>;
  viewer: DepositLedgerViewer;
}> {
  const orgId = claims.organizationId;
  const viewer: DepositLedgerViewer = {
    canPayRefunds: hasPermission(claims, 'payment.refund'),
    canDecideRefunds:
      hasPermission(claims, 'stay.booking.manage') || hasPermission(claims, 'stay.refund.approve'),
  };
  if (!orgId) return { rows: [], claims: {}, viewer };
  const revealAccounts = viewer.canPayRefunds || viewer.canDecideRefunds;
  const ownerPartyId = ownerPartyScope(claims);
  const { rows, byBooking } = await withinViewerTenant(claims, async (tx) => {
    const [stayRows, reservationRows, cancelRows] = await Promise.all([
      loadDepositLedger(tx, orgId, { ownerPartyId }, revealAccounts),
      loadReservationDepositLedgerRows(tx, orgId, ownerPartyId),
      loadBookingCancelRefundLedgerRows(tx, orgId, { ownerPartyId }, revealAccounts),
    ]);
    const rows = [...reservationRows, ...stayRows, ...cancelRows];
    const stayIds = [...stayRows, ...cancelRows].flatMap((row) => (row.id ? [row.id] : []));
    return { rows, byBooking: await loadDepositClaims(tx, orgId, stayIds) };
  });
  return { rows, claims: Object.fromEntries(byBooking), viewer };
}

/**
 * Booking money lines for the accounting list: stay payments, kept deposit deductions, and
 * rent or purchase booking deposits paid on the website. Stay deposits held in trust are not
 * income and never appear here.
 */
export async function loadStayIncomeRowsForViewer(): Promise<Record<string, unknown>[]> {
  const viewerRows = async (
    load: (claims: SessionClaims) => Promise<Record<string, unknown>[]>,
  ): Promise<Record<string, unknown>[]> => {
    if (!hasDatabaseUrl()) return [];
    const claims = await readClaims();
    if (!claims?.organizationId) return [];
    try {
      return await load(claims);
    } catch {
      return [];
    }
  };
  const [payments, kept, reservationDeposits] = await Promise.all([
    loadStayAccountingRowsForViewer(),
    viewerRows(loadRetainedDepositIncome),
    viewerRows(listReservationDepositAccountingRows),
  ]);
  return [...reservationDeposits, ...kept, ...payments];
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
