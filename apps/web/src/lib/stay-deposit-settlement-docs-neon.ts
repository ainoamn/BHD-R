import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  createDatabase,
  properties,
  stayBookingGuests,
  stayBookingStatusHistory,
  stayBookings,
  stayProfiles,
  units,
  type Database,
} from '@bhd-r/db';
import { applySessionSettings } from '@/lib/db-session-settings';
import type { AccountingIssuer, AccountingSignature } from '@/lib/accounting-letterhead';
import {
  depositReceiptNumbers,
  maskAccount,
  REFUND_RECEIPT_DATA_URL,
  retainedDepositMinor,
  type DepositRefundStatus,
  type RefundPayoutMethod,
} from '@/lib/stay-deposit-refund';
import { loadDepositRefunds } from '@/lib/stay-deposit-refund-neon';
import { loadStayReceiptLetterhead } from '@/lib/stay-receipt-letterhead-neon';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const HISTORY_STATUS = 'deposit_refund';
const globalForDb = globalThis as unknown as { __bhdRDepositDocsDb?: { db: Database } };

function sharedDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRDepositDocsDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRDepositDocsDb = { db };
  }
  return globalForDb.__bhdRDepositDocsDb.db;
}

async function elevated<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return sharedDb().transaction(async (tx) => {
    await applySessionSettings(tx, {
      statement_timeout: '8000',
      'app.platform_admin': 'true',
      'app.public': 'false',
    });
    return work(tx);
  });
}

export type GuestDepositSettlementDoc = {
  referenceCode: string;
  bookingId: string;
  organizationId: string;
  propertyId: string;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
  unitCode: string | null;
  guestName: string | null;
  currency: string;
  depositMinor: string;
  refundedMinor: string;
  retainedMinor: string | null;
  refundReceiptNo: string;
  incomeReceiptNo: string | null;
  settledOn: string | null;
  refundStatus: DepositRefundStatus;
  decisionNote: string | null;
  decidedBy: string | null;
  paidBy: string | null;
  paidAt: string | null;
  paidMethod: RefundPayoutMethod | null;
  paidBank: string | null;
  paidAccountMasked: string | null;
  paidHolder: string | null;
  paidReference: string | null;
  hasTransferReceipt: boolean;
  issuer: AccountingIssuer | null;
  signature: AccountingSignature | null;
};

/** Bank slip uploaded with the accountant's transfer, by stay reference. */
export async function readGuestDepositTransferReceipt(
  referenceCode: string,
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const reference = referenceCode.trim().toUpperCase();
  if (reference.length < 4) return null;
  return elevated(async (tx) => {
    const [booking] = await tx
      .select({ id: stayBookings.id, organizationId: stayBookings.organizationId })
      .from(stayBookings)
      .where(eq(stayBookings.referenceCode, reference))
      .limit(1);
    if (!booking) return null;
    const [row] = await tx
      .select({
        receipt: sql<string | null>`${stayBookingStatusHistory.metadataJson}->>'receipt'`,
      })
      .from(stayBookingStatusHistory)
      .where(
        and(
          eq(stayBookingStatusHistory.organizationId, booking.organizationId),
          eq(stayBookingStatusHistory.bookingId, booking.id),
          eq(stayBookingStatusHistory.toStatus, HISTORY_STATUS),
          sql`(${stayBookingStatusHistory.metadataJson}->>'receipt') is not null`,
        ),
      )
      .orderBy(desc(stayBookingStatusHistory.createdAt))
      .limit(1);
    const match = row?.receipt?.match(REFUND_RECEIPT_DATA_URL);
    if (!match) return null;
    return { mimeType: match[1]!, bytes: Buffer.from(match[2]!, 'base64') };
  });
}

/** Settlement / reverse document fields after an executed (or rejected) deposit refund. */
export async function loadGuestDepositSettlementDoc(
  referenceCode: string,
  locale: 'ar' | 'en' = 'ar',
): Promise<GuestDepositSettlementDoc | null> {
  const reference = referenceCode.trim().toUpperCase();
  if (reference.length < 4) return null;
  const base = await elevated(async (tx) => {
    const [booking] = await tx
      .select({
        id: stayBookings.id,
        organizationId: stayBookings.organizationId,
        propertyId: stayBookings.propertyId,
        currency: stayBookings.currency,
        referenceCode: stayBookings.referenceCode,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        unitCode: units.code,
        depositMinor: stayProfiles.depositMinor,
        contactName: sql<
          string | null
        >`${stayBookings.pricingSnapshotJson}->'guestContact'->>'displayName'`,
      })
      .from(stayBookings)
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .leftJoin(stayProfiles, eq(stayProfiles.id, stayBookings.stayProfileId))
      .leftJoin(units, eq(units.id, stayBookings.unitId))
      .where(eq(stayBookings.referenceCode, reference))
      .limit(1);
    if (!booking) return null;

    const refunds = await loadDepositRefunds(tx, booking.organizationId, [booking.id]);
    const refund = refunds.get(booking.id);
    if (!refund || (refund.status !== 'executed' && refund.status !== 'rejected')) return null;

    const [guest] = await tx
      .select({ name: stayBookingGuests.displayName })
      .from(stayBookingGuests)
      .where(
        and(eq(stayBookingGuests.bookingId, booking.id), eq(stayBookingGuests.isPrimary, true)),
      )
      .limit(1);

    const deposit =
      refund.settledDepositMinor ??
      (booking.depositMinor && booking.depositMinor > 0n ? booking.depositMinor.toString() : null);
    if (!deposit) return null;

    const refunded =
      refund.status === 'executed'
        ? refund.amountMinor
        : refund.paidMinor !== '0'
          ? refund.paidMinor
          : '0';
    const retained = retainedDepositMinor(deposit, refund.status, refund.amountMinor);
    const numbers = depositReceiptNumbers(booking.referenceCode);
    const transfer = refund.transfer;

    return {
      referenceCode: booking.referenceCode,
      bookingId: booking.id,
      organizationId: booking.organizationId,
      propertyId: booking.propertyId,
      propertyNameAr: booking.propertyNameAr,
      propertyNameEn: booking.propertyNameEn,
      unitCode: booking.unitCode,
      guestName: guest?.name ?? booking.contactName,
      currency: refund.currency || booking.currency,
      depositMinor: deposit,
      refundedMinor: refunded,
      retainedMinor: retained,
      refundReceiptNo: refunded !== '0' ? numbers.refund : numbers.refund,
      incomeReceiptNo: retained ? numbers.income : null,
      settledOn:
        refund.status === 'executed'
          ? (transfer?.at ?? refund.decidedAt)
          : refund.decidedAt,
      refundStatus: refund.status,
      decisionNote: refund.decisionNote,
      decidedBy: refund.decidedBy,
      paidBy: transfer?.recordedBy ?? null,
      paidAt: transfer?.at ?? null,
      paidMethod: transfer?.method ?? null,
      paidBank: transfer?.bank ?? null,
      paidAccountMasked: transfer?.account ? maskAccount(transfer.account) : null,
      paidHolder: transfer?.holder ?? null,
      paidReference: transfer?.reference ?? null,
      hasTransferReceipt: Boolean(transfer?.hasReceipt),
    };
  });
  if (!base) return null;

  const letterhead = await loadStayReceiptLetterhead({
    organizationId: base.organizationId,
    referenceCode: base.referenceCode,
    docKind: 'deposit_refund',
    amountMinor: base.refundedMinor,
    locale,
  }).catch(() => null);

  return {
    ...base,
    issuer: letterhead?.issuer ?? null,
    signature: letterhead?.signature ?? null,
  };
}

