import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { resolveStaysEnabledFromEnv, readStaysFlagsFromEnv } from '@bhd-r/config';
import {
  contractSignatures,
  contractTemplates,
  contracts,
  createDatabase,
  leases,
  outboxEvents,
  stayBookingGuests,
  stayBookingStatusHistory,
  stayBookings,
  stayFolios,
  stayHolds,
  stayInventoryLocks,
  stayPaymentIntents,
  stayProfiles,
  type Database,
} from '@bhd-r/db';
import { DEFAULT_CONTRACT_TEMPLATES } from '@/lib/contract-default-templates';
import { allocateChildContractReference } from '@/lib/contract-reference-neon';
import { assertStayBookingTransition, nightsBetween } from '@bhd-r/domain';
import { publicWebOrigin } from '@/lib/seo';
import { termsBlocksFromStored, type TermsBlock } from '@/lib/booking-terms';
import {
  createLockInTransaction,
  isRangeAvailableInTransaction,
  priceStayRangeForUnitOnNeon,
  PublicStayBookingError,
} from '@/lib/public-stays-booking-neon';
import { loadStayStamps, type StayStamp } from '@/lib/stay-arrival-neon';
import {
  guestDepositRefund,
  type GuestDepositRefund,
  type RefundRequestPayout,
} from '@/lib/stay-deposit-refund';
import {
  insertGuestDepositRefundRequest,
  loadBookingDeposits,
  loadDepositRefunds,
} from '@/lib/stay-deposit-refund-neon';
import type { DepositClaimView } from '@/lib/stay-deposit-claims';
import { loadDepositClaims } from '@/lib/stay-deposit-claims-neon';
import { stayRescheduleCharge, type StayRescheduleCharge } from '@/lib/stay-reschedule-pricing';
import { loadStayBookingPayments, type StayBookingPaymentLine } from '@/lib/stay-booking-payments';
import type { StayDepositGateStatus } from '@/lib/stay-deposit-gate';
import { ensureStayDepositPaymentInTx, loadStayDepositGate } from '@/lib/stay-deposit-gate-neon';
import { resolveStayPeriodTimes, type StayPeriodType } from '@/lib/stay-period-times';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPublicStaysGuestDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPublicStaysGuestDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPublicStaysGuestDb = { db };
  }
  return globalForDb.__bhdRPublicStaysGuestDb;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function asPublic<T>(work: (transaction: Tx) => Promise<T>): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.public', 'true', true)`);
    await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
    return work(transaction);
  });
}

function assertPlatformEnabled(): void {
  if (!readStaysFlagsFromEnv().platformEnabled) {
    throw new PublicStayBookingError('not_found', 'Stays booking is not enabled', 404);
  }
}

function assertOrgEnabled(organizationId: string): void {
  const resolution = resolveStaysEnabledFromEnv({
    organizationId,
    propertyEnabled: true,
    unitEnabled: true,
  });
  if (!resolution.enabled) {
    throw new PublicStayBookingError('not_found', 'Stay listing not found', 404);
  }
}

export type GuestStayBookingProjection = {
  id: string;
  referenceCode: string;
  organizationId: string;
  propertyId: string;
  unitTypeId: string;
  unitId: string;
  checkInOn: string;
  checkOutOn: string;
  timezone: string;
  status: string;
  bookingMode: string;
  currency: string;
  totalMinor: string;
  nights: number;
  guestDisplayName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  adults?: number | null;
  children?: number | null;
  stayType?: string | null;
  /** Property period clocks for the booking stay type. */
  checkInTime?: string | null;
  checkOutTime?: string | null;
  paymentIntentId?: string | null;
  /** Succeeded charges on this booking — one receipt each. */
  payments?: StayBookingPaymentLine[];
  listingSlug?: string | null;
  listingTitleAr?: string | null;
  listingTitleEn?: string | null;
  esignCompleted?: boolean;
  acceptedTerms?: AcceptedTerms | null;
  bookingFor?: 'self' | 'other' | null;
  bookedByName?: string | null;
  canPay?: boolean;
  canCancel?: boolean;
  canRebook?: boolean;
  canReschedule?: boolean;
  /** Guest asked to move dates; waiting on owner or on a top-up payment. */
  pendingReschedule?: {
    status: 'awaiting_owner' | 'awaiting_guest_payment' | 'awaiting_payment';
    checkInOn: string;
    checkOutOn: string;
    stayType: string;
    extraDueMinor: string;
    quotedTotalMinor: string;
    chargedTotalMinor: string;
    paymentRedirectUrl?: string | null;
  } | null;
  checkIn?: StayStamp | null;
  checkOut?: StayStamp | null;
  /** Security deposit held for the stay (not part of the booking total). */
  depositMinor?: string | null;
  depositStatus?: StayDepositGateStatus | null;
  depositPaymentUrl?: string | null;
  depositRefund?: GuestDepositRefund | null;
  canRequestDepositRefund?: boolean;
  /** The guest's deposit requests and objections to the host, oldest first. */
  depositClaims?: DepositClaimView[];
  /** Owner cancel/reject outcome shown on the guest cancelled screen. */
  cancelOutcome?: {
    note: string | null;
    refundDecision: 'refund' | 'keep' | null;
    paidAmountMinor: string | null;
    currency: string | null;
    fromRequest: boolean;
  } | null;
  /** Latest owner rejection of a date-change request (booking stays active). */
  rescheduleRejection?: {
    note: string | null;
    at: string;
  } | null;
  /** Parent stay contract when issued. */
  contract?: { id: string; reference: string; status: string } | null;
  /** Latest date-change amendment. */
  amendmentContract?: { id: string; reference: string; status: string } | null;
};

const STAMPED_STATUSES = new Set(['checked_in', 'checked_out', 'closed']);
const DEPARTED_STATUSES = new Set(['checked_out', 'closed']);

const GUEST_RESCHEDULABLE = new Set([
  'payment_pending',
  'request_pending',
  'payment_failed',
  'confirmed',
  'pre_arrival',
]);
const PAID_STATUSES = new Set(['confirmed', 'pre_arrival']);

type AcceptedTerms = {
  version: number;
  bodyAr: string | null;
  bodyEn: string | null;
  blocks: TermsBlock[];
};

function readAcceptedTerms(snapshot: unknown): AcceptedTerms | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const terms = (snapshot as { acceptedTerms?: unknown }).acceptedTerms;
  if (!terms || typeof terms !== 'object') return null;
  const row = terms as Record<string, unknown>;
  if (typeof row.version !== 'number') return null;
  const bodyAr = typeof row.bodyAr === 'string' ? row.bodyAr : null;
  const bodyEn = typeof row.bodyEn === 'string' ? row.bodyEn : null;
  return {
    version: row.version,
    bodyAr,
    bodyEn,
    blocks: termsBlocksFromStored({ blocks: row.blocks, bodyAr, bodyEn }),
  };
}

function readEsignCompleted(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const esign = (snapshot as { esign?: unknown }).esign;
  if (!esign || typeof esign !== 'object') return false;
  return (esign as { completed?: unknown }).completed === true;
}

function readGuestContact(snapshot: unknown): {
  displayName?: string;
  email?: string;
  phone?: string;
} {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const root = snapshot as Record<string, unknown>;
  const contact =
    root.guestContact && typeof root.guestContact === 'object'
      ? (root.guestContact as Record<string, unknown>)
      : {};
  return {
    ...(typeof contact.displayName === 'string' ? { displayName: contact.displayName } : {}),
    ...(typeof contact.email === 'string' ? { email: contact.email } : {}),
    ...(typeof contact.phone === 'string' ? { phone: contact.phone } : {}),
  };
}

function readBookedBy(snapshot: unknown): {
  bookingFor: 'self' | 'other' | null;
  bookedByName: string | null;
} {
  if (!snapshot || typeof snapshot !== 'object') return { bookingFor: null, bookedByName: null };
  const root = snapshot as Record<string, unknown>;
  const bookingFor =
    root.bookingFor === 'self' || root.bookingFor === 'other' ? root.bookingFor : null;
  const bookedBy =
    root.bookedBy && typeof root.bookedBy === 'object'
      ? (root.bookedBy as Record<string, unknown>)
      : {};
  const name = typeof bookedBy.displayName === 'string' ? bookedBy.displayName.trim() : '';
  return { bookingFor, bookedByName: name || null };
}

function readStayTypeFromSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const root = snapshot as Record<string, unknown>;
  if (typeof root.stayType === 'string') return root.stayType;
  const fees = Array.isArray(root.fees) ? root.fees : [];
  for (const item of fees) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.code === 'stay_type' && typeof row.stayType === 'string') return row.stayType;
  }
  return null;
}

function readPendingReschedule(snapshot: unknown): GuestStayBookingProjection['pendingReschedule'] {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const pending = (snapshot as Record<string, unknown>).pendingReschedule;
  if (!pending || typeof pending !== 'object') return null;
  const row = pending as Record<string, unknown>;
  const status =
    row.status === 'awaiting_owner' ||
    row.status === 'awaiting_guest_payment' ||
    row.status === 'awaiting_payment'
      ? row.status
      : 'awaiting_payment';
  if (typeof row.checkInOn !== 'string' || typeof row.checkOutOn !== 'string') return null;
  return {
    status,
    checkInOn: row.checkInOn,
    checkOutOn: row.checkOutOn,
    stayType: typeof row.stayType === 'string' ? row.stayType : 'overnight_stay',
    extraDueMinor: typeof row.extraDueMinor === 'string' ? row.extraDueMinor : '0',
    quotedTotalMinor: typeof row.quotedTotalMinor === 'string' ? row.quotedTotalMinor : '0',
    chargedTotalMinor: typeof row.chargedTotalMinor === 'string' ? row.chargedTotalMinor : '0',
  };
}

function actionFlags(status: string): {
  canPay: boolean;
  canCancel: boolean;
  canRebook: boolean;
  canReschedule: boolean;
} {
  return {
    canReschedule: GUEST_RESCHEDULABLE.has(status),
    canPay: status === 'payment_pending' || status === 'payment_failed',
    canCancel:
      status === 'payment_pending' ||
      status === 'request_pending' ||
      status === 'payment_failed' ||
      status === 'confirmed' ||
      status === 'pre_arrival',
    canRebook:
      status === 'expired' ||
      status === 'cancelled' ||
      status === 'payment_failed' ||
      status === 'payment_pending',
  };
}

function toProjection(booking: {
  id: string;
  referenceCode: string;
  organizationId: string;
  propertyId: string;
  unitTypeId: string;
  unitId: string;
  checkInOn: string;
  checkOutOn: string;
  timezone: string;
  status: string;
  bookingMode: string;
  currency: string;
  totalMinor: bigint;
  pricingSnapshotJson?: unknown;
  guestDisplayName?: string | null;
  paymentIntentId?: string | null;
  listingSlug?: string | null;
}): GuestStayBookingProjection {
  const contact = readGuestContact(booking.pricingSnapshotJson);
  const adults =
    booking.pricingSnapshotJson &&
    typeof booking.pricingSnapshotJson === 'object' &&
    typeof (booking.pricingSnapshotJson as { adults?: unknown }).adults === 'number'
      ? (booking.pricingSnapshotJson as { adults: number }).adults
      : null;
  const children =
    booking.pricingSnapshotJson &&
    typeof booking.pricingSnapshotJson === 'object' &&
    typeof (booking.pricingSnapshotJson as { children?: unknown }).children === 'number'
      ? (booking.pricingSnapshotJson as { children: number }).children
      : null;
  const flags = actionFlags(booking.status);
  const pendingReschedule = readPendingReschedule(booking.pricingSnapshotJson);
  return {
    id: booking.id,
    referenceCode: booking.referenceCode,
    organizationId: booking.organizationId,
    propertyId: booking.propertyId,
    unitTypeId: booking.unitTypeId,
    unitId: booking.unitId,
    checkInOn: booking.checkInOn,
    checkOutOn: booking.checkOutOn,
    timezone: booking.timezone,
    status: booking.status,
    bookingMode: booking.bookingMode,
    currency: booking.currency,
    totalMinor: booking.totalMinor.toString(),
    nights: nightsBetween({
      checkInOn: booking.checkInOn,
      checkOutOn: booking.checkOutOn,
    }),
    guestDisplayName: booking.guestDisplayName ?? contact.displayName ?? null,
    guestEmail: contact.email ?? null,
    guestPhone: contact.phone ?? null,
    adults,
    children,
    stayType: readStayTypeFromSnapshot(booking.pricingSnapshotJson),
    paymentIntentId: booking.paymentIntentId ?? null,
    listingSlug: booking.listingSlug ?? null,
    esignCompleted: readEsignCompleted(booking.pricingSnapshotJson),
    acceptedTerms: readAcceptedTerms(booking.pricingSnapshotJson),
    ...readBookedBy(booking.pricingSnapshotJson),
    ...flags,
    canReschedule: flags.canReschedule && !pendingReschedule,
    canPay: flags.canPay && Boolean(booking.paymentIntentId),
    pendingReschedule: pendingReschedule ?? null,
  };
}

type ListingRef = { slug: string; titleAr: string | null; titleEn: string | null };

async function resolveListing(
  transaction: Tx,
  organizationId: string,
  stayProfileId: string,
): Promise<ListingRef | null> {
  const listingRows = await transaction.execute(sql`
    SELECT spl.slug, spl.title_ar, spl.title_en
    FROM stay_profiles sp
    INNER JOIN stay_public_listings spl
      ON spl.unit_type_id = sp.unit_type_id
     AND spl.organization_id = sp.organization_id
    WHERE sp.id = ${stayProfileId}::uuid
      AND sp.organization_id = ${organizationId}::uuid
      AND spl.enabled = true
    ORDER BY spl.published_at DESC NULLS LAST, spl.updated_at DESC NULLS LAST
    LIMIT 1
  `);
  type Row = { slug?: unknown; title_ar?: unknown; title_en?: unknown };
  const rows = (
    Array.isArray(listingRows) ? listingRows : ((listingRows as { rows?: Row[] }).rows ?? [])
  ) as Row[];
  const row = rows[0];
  const slug = typeof row?.slug === 'string' ? row.slug.trim() : '';
  if (!slug) return null;
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : null;
  return { slug, titleAr: text(row?.title_ar), titleEn: text(row?.title_en) };
}

async function resolvePaymentIntentId(
  transaction: Tx,
  organizationId: string,
  bookingId: string,
): Promise<string | null> {
  const result = await transaction.execute(sql`
    SELECT id::text AS id
    FROM stay_payment_intents
    WHERE organization_id = ${organizationId}::uuid
      AND booking_id = ${bookingId}::uuid
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: Array<{ id: string }> }).rows ?? []);
  const id = (rows[0] as { id?: string } | undefined)?.id;
  return typeof id === 'string' && id ? id : null;
}

/** Expire unpaid drafts whose hold elapsed, then return freshest booking row. */
async function refreshUnpaidBooking(transaction: Tx, bookingId: string) {
  const now = new Date();
  await transaction.execute(sql`
    UPDATE stay_inventory_locks l
    SET status = 'released', updated_at = ${now.toISOString()}
    FROM stay_bookings b
    LEFT JOIN stay_holds h ON h.id = b.hold_id
    WHERE b.id = ${bookingId}::uuid
      AND b.status = 'payment_pending'
      AND l.id = b.inventory_lock_id
      AND l.status = 'active'
      AND l.kind = 'hold'
      AND (
        (h.id IS NOT NULL AND h.status = 'active' AND h.expires_at <= now())
        OR (l.expires_at IS NOT NULL AND l.expires_at <= now())
        OR h.id IS NULL
      )
  `);
  await transaction.execute(sql`
    UPDATE stay_holds h
    SET status = 'expired', updated_at = ${now.toISOString()}
    FROM stay_bookings b
    WHERE b.id = ${bookingId}::uuid
      AND b.hold_id = h.id
      AND h.status = 'active'
      AND h.expires_at <= now()
  `);
  await transaction.execute(sql`
    UPDATE stay_bookings b
    SET status = 'expired', updated_at = ${now.toISOString()}
    WHERE b.id = ${bookingId}::uuid
      AND b.status = 'payment_pending'
      AND NOT EXISTS (
        SELECT 1 FROM stay_holds h
        WHERE h.id = b.hold_id
          AND h.status = 'active'
          AND h.expires_at > now()
      )
      AND NOT EXISTS (
        SELECT 1 FROM stay_inventory_locks l
        WHERE l.id = b.inventory_lock_id
          AND l.status = 'active'
          AND (l.expires_at IS NULL OR l.expires_at > now())
      )
  `);
  return transaction.query.stayBookings.findFirst({
    where: eq(stayBookings.id, bookingId),
  });
}

async function loadRescheduleRejection(
  transaction: Tx,
  organizationId: string,
  bookingId: string,
): Promise<GuestStayBookingProjection['rescheduleRejection']> {
  const [row] = await transaction
    .select({
      at: stayBookingStatusHistory.createdAt,
      metadata: stayBookingStatusHistory.metadataJson,
    })
    .from(stayBookingStatusHistory)
    .where(
      and(
        eq(stayBookingStatusHistory.organizationId, organizationId),
        eq(stayBookingStatusHistory.bookingId, bookingId),
        eq(stayBookingStatusHistory.reason, 'owner_rejected_reschedule'),
      ),
    )
    .orderBy(desc(stayBookingStatusHistory.createdAt))
    .limit(1);
  if (!row) return null;
  // A later applied reschedule supersedes an older rejection notice.
  const [laterApply] = await transaction
    .select({ id: stayBookingStatusHistory.id })
    .from(stayBookingStatusHistory)
    .where(
      and(
        eq(stayBookingStatusHistory.organizationId, organizationId),
        eq(stayBookingStatusHistory.bookingId, bookingId),
        eq(stayBookingStatusHistory.reason, 'guest_rescheduled'),
        gt(stayBookingStatusHistory.createdAt, row.at),
      ),
    )
    .limit(1);
  if (laterApply) return null;
  const meta =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata)
      : null;
  const note = typeof meta?.note === 'string' && meta.note.trim() ? meta.note.trim() : null;
  return {
    note,
    at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
  };
}

async function loadCancelOutcome(
  transaction: Tx,
  organizationId: string,
  bookingId: string,
): Promise<GuestStayBookingProjection['cancelOutcome']> {
  const [row] = await transaction
    .select({ metadata: stayBookingStatusHistory.metadataJson })
    .from(stayBookingStatusHistory)
    .where(
      and(
        eq(stayBookingStatusHistory.organizationId, organizationId),
        eq(stayBookingStatusHistory.bookingId, bookingId),
        eq(stayBookingStatusHistory.toStatus, 'cancelled'),
        sql`${stayBookingStatusHistory.metadataJson}->>'ownerCancel' = 'true'`,
      ),
    )
    .orderBy(desc(stayBookingStatusHistory.createdAt))
    .limit(1);
  const meta =
    row?.metadata && typeof row.metadata === 'object'
      ? (row.metadata)
      : null;
  if (!meta) return null;
  const decision =
    meta.refundDecision === 'refund' || meta.refundDecision === 'keep' ? meta.refundDecision : null;
  const note = typeof meta.note === 'string' && meta.note.trim() ? meta.note.trim() : null;
  const paidAmountMinor =
    typeof meta.paidAmountMinor === 'string' && /^\d+$/.test(meta.paidAmountMinor)
      ? meta.paidAmountMinor
      : null;
  const currency = typeof meta.currency === 'string' ? meta.currency : null;
  return {
    note,
    refundDecision: decision,
    paidAmountMinor,
    currency,
    fromRequest: meta.fromRequest === true,
  };
}

async function resolveRescheduleTopUpRedirect(
  transaction: Tx,
  booking: typeof stayBookings.$inferSelect,
  pending: NonNullable<GuestStayBookingProjection['pendingReschedule']>,
): Promise<string | null> {
  if (pending.status !== 'awaiting_guest_payment' && pending.status !== 'awaiting_payment') {
    return null;
  }
  const idempotencyKey = `reschedule_topup:${booking.id}:${pending.checkInOn}:${pending.checkOutOn}:${pending.stayType}`;
  const [intent] = await transaction
    .select({
      providerIntentId: stayPaymentIntents.providerIntentId,
      status: stayPaymentIntents.status,
    })
    .from(stayPaymentIntents)
    .where(
      and(
        eq(stayPaymentIntents.organizationId, booking.organizationId),
        eq(stayPaymentIntents.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!intent || intent.status !== 'pending' || !intent.providerIntentId) return null;
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(intent.providerIntentId)) return null;
  const origin = publicWebOrigin();
  const returnPath = `/ar/guest/stays/${booking.id}?ref=${encodeURIComponent(booking.referenceCode)}`;
  return `${origin}/ar/payments/sandbox/${intent.providerIntentId}?kind=stay&return=${encodeURIComponent(returnPath)}`;
}

async function enrichProjection(
  transaction: Tx,
  booking: typeof stayBookings.$inferSelect,
  guestDisplayName?: string | null,
): Promise<GuestStayBookingProjection> {
  const departed = DEPARTED_STATUSES.has(booking.status);
  const cancelled = booking.status === 'cancelled';
  const arrivalReady = PAID_STATUSES.has(booking.status);
  const base = toProjection({
    ...booking,
    guestDisplayName: guestDisplayName ?? null,
    listingSlug: null,
  });
  const [
    paymentIntentId,
    payments,
    listing,
    stamps,
    deposits,
    refunds,
    claims,
    cancelOutcome,
    rescheduleRejection,
    payUrl,
    depositGate,
  ] = await Promise.all([
    resolvePaymentIntentId(transaction, booking.organizationId, booking.id),
    loadStayBookingPayments(transaction, booking.organizationId, booking.id, {
      succeededOnly: true,
    }),
    resolveListing(transaction, booking.organizationId, booking.stayProfileId),
    STAMPED_STATUSES.has(booking.status)
      ? loadStayStamps(transaction, booking.organizationId, [booking.id])
      : Promise.resolve(null),
    departed || arrivalReady
      ? loadBookingDeposits(transaction, booking.organizationId, [booking.id])
      : Promise.resolve(null),
    departed
      ? loadDepositRefunds(transaction, booking.organizationId, [booking.id])
      : Promise.resolve(null),
    departed
      ? loadDepositClaims(transaction, booking.organizationId, [booking.id], { forGuest: true })
      : Promise.resolve(null),
    cancelled
      ? loadCancelOutcome(transaction, booking.organizationId, booking.id)
      : Promise.resolve(null),
    !cancelled && !base.pendingReschedule
      ? loadRescheduleRejection(transaction, booking.organizationId, booking.id)
      : Promise.resolve(null),
    base.pendingReschedule
      ? resolveRescheduleTopUpRedirect(transaction, booking, base.pendingReschedule)
      : Promise.resolve(null),
    arrivalReady && !departed
      ? loadStayDepositGate(transaction, booking.organizationId, booking.id)
      : Promise.resolve(null),
  ]);
  const stamp = stamps?.get(booking.id);
  const depositMinor = depositGate?.amountMinor ?? deposits?.get(booking.id) ?? null;
  let depositPaymentUrl: string | null = null;
  if (
    depositGate?.required &&
    depositGate.status === 'unpaid' &&
    depositGate.amountMinor &&
    arrivalReady
  ) {
    try {
      const pay = await ensureStayDepositPaymentInTx(
        transaction,
        {
          id: booking.id,
          organizationId: booking.organizationId,
          referenceCode: booking.referenceCode,
          currency: booking.currency,
        },
        depositGate.amountMinor,
        'ar',
      );
      depositPaymentUrl = pay.redirectUrl;
    } catch {
      depositPaymentUrl = null;
    }
  }
  const refund = refunds?.get(booking.id);
  const pendingReschedule = base.pendingReschedule
    ? { ...base.pendingReschedule, paymentRedirectUrl: payUrl }
    : null;
  const [profileTimes] = await transaction
    .select({
      checkInFrom: stayProfiles.checkInFrom,
      dayUseCheckInFrom: stayProfiles.dayUseCheckInFrom,
      dayUseCheckOutUntil: stayProfiles.dayUseCheckOutUntil,
      overnightCheckOutUntil: stayProfiles.overnightCheckOutUntil,
      checkOutUntil: stayProfiles.checkOutUntil,
    })
    .from(stayProfiles)
    .where(
      and(
        eq(stayProfiles.id, booking.stayProfileId),
        eq(stayProfiles.organizationId, booking.organizationId),
      ),
    )
    .limit(1);
  const period = resolveStayPeriodTimes(
    (base.stayType as StayPeriodType | null | undefined) ?? null,
    profileTimes ?? {},
  );
  const [parentContract, latestAmendment] = await Promise.all([
    transaction
      .select({
        id: contracts.id,
        reference: contracts.reference,
        status: contracts.status,
      })
      .from(contracts)
      .where(
        and(
          eq(contracts.organizationId, booking.organizationId),
          sql`${contracts.payloadSnapshot}->'source'->>'stayBookingId' = ${booking.id}`,
          isNull(contracts.parentContractId),
          ne(contracts.status, 'void'),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
    transaction
      .select({
        id: contracts.id,
        reference: contracts.reference,
        status: contracts.status,
      })
      .from(contracts)
      .where(
        and(
          eq(contracts.organizationId, booking.organizationId),
          eq(contracts.kind, 'amendment'),
          ne(contracts.status, 'void'),
          sql`${contracts.payloadSnapshot}->'source'->>'stayBookingId' = ${booking.id}`,
        ),
      )
      .orderBy(desc(contracts.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);
  return {
    depositMinor,
    depositStatus: depositGate?.status ?? null,
    depositPaymentUrl,
    depositRefund: refund ? guestDepositRefund(refund) : null,
    depositClaims: claims?.get(booking.id) ?? [],
    canRequestDepositRefund: Boolean(depositMinor && !refund && booking.status === 'checked_out'),
    ...base,
    checkInTime: period.checkInTime,
    checkOutTime: period.checkOutTime,
    contract: parentContract
      ? {
          id: parentContract.id,
          reference:
            parentContract.reference ?? `CTR-${parentContract.id.slice(0, 8).toUpperCase()}`,
          status: parentContract.status,
        }
      : null,
    amendmentContract: latestAmendment
      ? {
          id: latestAmendment.id,
          reference:
            latestAmendment.reference ?? `CTR-${latestAmendment.id.slice(0, 8).toUpperCase()}`,
          status: latestAmendment.status,
        }
      : null,
    paymentIntentId,
    payments,
    listingSlug: listing?.slug ?? null,
    listingTitleAr: listing?.titleAr ?? null,
    listingTitleEn: listing?.titleEn ?? null,
    checkIn: stamp?.checkIn ? { ...stamp.checkIn, recipient: null, photos: [] } : null,
    checkOut: stamp?.checkOut ? { ...stamp.checkOut, recipient: null, photos: [] } : null,
    cancelOutcome: cancelOutcome ?? null,
    rescheduleRejection: rescheduleRejection ?? null,
    pendingReschedule,
    canPay: Boolean(
      (base.canPay && paymentIntentId) ||
      (pendingReschedule?.paymentRedirectUrl &&
        (pendingReschedule.status === 'awaiting_guest_payment' ||
          pendingReschedule.status === 'awaiting_payment')),
    ),
  };
}

export async function lookupPublicStayBookingOnNeon(referenceCode: string) {
  assertPlatformEnabled();
  const normalized = referenceCode.trim().toUpperCase();
  if (normalized.length < 4) {
    throw new PublicStayBookingError('invalid_body', 'Invalid booking reference', 400);
  }

  return asPublic(async (transaction) => {
    const found = await transaction.query.stayBookings.findFirst({
      where: eq(stayBookings.referenceCode, normalized),
    });
    if (!found) {
      throw new PublicStayBookingError('not_found', 'Stay booking not found', 404);
    }
    assertOrgEnabled(found.organizationId);

    const booking = (await refreshUnpaidBooking(transaction, found.id)) ?? found;

    const primaryGuest = await transaction.query.stayBookingGuests.findFirst({
      where: and(
        eq(stayBookingGuests.bookingId, booking.id),
        eq(stayBookingGuests.isPrimary, true),
      ),
      columns: { displayName: true },
    });

    return enrichProjection(transaction, booking, primaryGuest?.displayName ?? null);
  });
}

/** `guestPartyIds`: the account's own guest records, matched by its verified email. */
export async function listGuestStayBookingsOnNeon(userId: string, guestPartyIds: string[] = []) {
  assertPlatformEnabled();
  return asPublic(async (transaction) => {
    const rows = await transaction
      .select()
      .from(stayBookings)
      .where(
        guestPartyIds.length
          ? or(eq(stayBookings.userId, userId), inArray(stayBookings.guestPartyId, guestPartyIds))
          : eq(stayBookings.userId, userId),
      )
      .orderBy(desc(stayBookings.checkInOn), desc(stayBookings.createdAt))
      .limit(50);

    const items: GuestStayBookingProjection[] = [];
    for (const row of rows) {
      try {
        assertOrgEnabled(row.organizationId);
      } catch {
        continue;
      }
      const fresh = (await refreshUnpaidBooking(transaction, row.id)) ?? row;
      items.push(await enrichProjection(transaction, fresh));
    }
    return { items };
  });
}

export async function claimGuestStayBookingOnNeon(userId: string, referenceCode: string) {
  assertPlatformEnabled();
  const normalized = referenceCode.trim().toUpperCase();

  return asPublic(async (transaction) => {
    const booking = await transaction.query.stayBookings.findFirst({
      where: eq(stayBookings.referenceCode, normalized),
    });
    if (!booking) {
      throw new PublicStayBookingError('not_found', 'Stay booking not found', 404);
    }
    assertOrgEnabled(booking.organizationId);

    if (booking.userId === userId) {
      return { ...(await enrichProjection(transaction, booking)), duplicate: true as const };
    }
    if (booking.userId) {
      throw new PublicStayBookingError(
        'already_claimed',
        'Stay booking is already linked to another account',
        409,
      );
    }

    const [updated] = await transaction
      .update(stayBookings)
      .set({ userId, updatedAt: new Date() })
      .where(
        and(
          eq(stayBookings.id, booking.id),
          eq(stayBookings.organizationId, booking.organizationId),
          sql`${stayBookings.userId} IS NULL`,
        ),
      )
      .returning();
    if (!updated) {
      throw new PublicStayBookingError('claim_failed', 'Stay booking could not be claimed', 409);
    }
    return { ...(await enrichProjection(transaction, updated)), duplicate: false as const };
  });
}

const GUEST_CANCELABLE = new Set([
  'payment_pending',
  'request_pending',
  'payment_failed',
  'confirmed',
  'pre_arrival',
]);

/** Guest cancels by reference — releases hold lock and frees the day. */
export async function cancelGuestStayBookingOnNeon(referenceCode: string) {
  assertPlatformEnabled();
  const normalized = referenceCode.trim().toUpperCase();
  if (normalized.length < 4) {
    throw new PublicStayBookingError('invalid_body', 'Invalid booking reference', 400);
  }

  return asPublic(async (transaction) => {
    const booking = await transaction.query.stayBookings.findFirst({
      where: eq(stayBookings.referenceCode, normalized),
    });
    if (!booking) {
      throw new PublicStayBookingError('not_found', 'Stay booking not found', 404);
    }
    assertOrgEnabled(booking.organizationId);

    if (booking.status === 'cancelled' || booking.status === 'expired') {
      return enrichProjection(transaction, booking);
    }
    if (!GUEST_CANCELABLE.has(booking.status)) {
      throw new PublicStayBookingError(
        'illegal_transition',
        `Cannot cancel booking in status ${booking.status}`,
        409,
      );
    }

    if (booking.status !== 'payment_failed') {
      const transition = assertStayBookingTransition(booking.status, 'cancelled');
      if (!transition.ok) {
        throw new PublicStayBookingError(
          'illegal_transition',
          transition.reason ?? 'Illegal stay booking transition',
          409,
        );
      }
    }

    const now = new Date();
    const [updated] = await transaction
      .update(stayBookings)
      .set({ status: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(stayBookings.id, booking.id),
          eq(stayBookings.organizationId, booking.organizationId),
        ),
      )
      .returning();
    if (!updated) {
      throw new PublicStayBookingError('cancel_failed', 'Could not cancel stay booking', 409);
    }

    if (booking.inventoryLockId) {
      await transaction
        .update(stayInventoryLocks)
        .set({ status: 'released', updatedAt: now })
        .where(
          and(
            eq(stayInventoryLocks.id, booking.inventoryLockId),
            eq(stayInventoryLocks.organizationId, booking.organizationId),
            eq(stayInventoryLocks.status, 'active'),
          ),
        );
    }
    if (booking.holdId) {
      await transaction
        .update(stayHolds)
        .set({ status: 'cancelled', updatedAt: now })
        .where(
          and(
            eq(stayHolds.id, booking.holdId),
            eq(stayHolds.organizationId, booking.organizationId),
          ),
        );
    }

    await transaction.insert(stayBookingStatusHistory).values({
      organizationId: booking.organizationId,
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: 'cancelled',
      reason: 'guest_cancelled',
    });

    return enrichProjection(transaction, updated);
  });
}

const REFUND_ERRORS: Record<string, string> = {
  refund_not_open: 'Deposit refunds open after check-out',
  refund_no_deposit: 'This stay has no security deposit',
  refund_account_invalid: 'Invalid account number or IBAN',
  refund_bank_required: 'Choose the bank',
  refund_phone_invalid: 'Invalid phone number',
  review_required: 'Rate your stay first, then request the deposit',
};

/** Guest asks for the security deposit back after check-out (by booking reference). */
export async function requestGuestDepositRefundOnNeon(input: {
  referenceCode: string;
  note?: string | undefined;
  payout: RefundRequestPayout;
}) {
  assertPlatformEnabled();
  const normalized = input.referenceCode.trim().toUpperCase();
  if (normalized.length < 4) {
    throw new PublicStayBookingError('invalid_body', 'Invalid booking reference', 400);
  }

  return asPublic(async (transaction) => {
    const booking = await transaction.query.stayBookings.findFirst({
      where: eq(stayBookings.referenceCode, normalized),
    });
    if (!booking) {
      throw new PublicStayBookingError('not_found', 'Stay booking not found', 404);
    }
    assertOrgEnabled(booking.organizationId);
    try {
      await insertGuestDepositRefundRequest(transaction, booking, {
        note: input.note,
        payout: input.payout,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const message = REFUND_ERRORS[code];
      if (message) {
        throw new PublicStayBookingError(
          code,
          message,
          code === 'refund_not_open' || code === 'refund_no_deposit' || code === 'review_required'
            ? 409
            : 400,
        );
      }
      throw error;
    }
    return enrichProjection(transaction, booking);
  });
}

type RescheduleStayType = 'overnight_stay' | 'day_use' | 'overnight_only';

function rescheduleStayType(value: string | null): RescheduleStayType {
  return value === 'day_use' || value === 'overnight_only' ? value : 'overnight_stay';
}

function addCalendarDays(isoDate: string, days: number): string {
  const day = isoDate.slice(0, 10);
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type RescheduleMove = {
  at: string;
  fromCheckInOn: string;
  fromCheckOutOn: string;
  fromStayType: RescheduleStayType;
  toCheckInOn: string;
  toCheckOutOn: string;
  toStayType: RescheduleStayType;
  quotedTotalMinor: string;
  chargedTotalMinor: string;
  forfeitedMinor: string;
  originalTotalMinor?: string;
  extraDueMinor?: string;
  hasOffer?: boolean;
};

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

async function ensureStayRescheduleAmendmentTemplate(
  transaction: Tx,
  orgId: string,
): Promise<string> {
  const key = 'stay_reschedule_amendment';
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${orgId}:${key}:ar`}, 11))`,
  );
  const [existing] = await transaction
    .select({ id: contractTemplates.id })
    .from(contractTemplates)
    .where(
      and(
        eq(contractTemplates.organizationId, orgId),
        eq(contractTemplates.key, key),
        eq(contractTemplates.language, 'ar'),
        eq(contractTemplates.active, true),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const html = DEFAULT_CONTRACT_TEMPLATES.stay_reschedule_amendment.ar;
  const [versionRow] = rowsOf<{ version: number }>(
    await transaction.execute(sql`
      select coalesce(max(version), 0)::integer + 1 as version
      from contract_templates
      where organization_id = ${orgId} and key = ${key} and language = 'ar'
    `),
  );
  const [created] = await transaction
    .insert(contractTemplates)
    .values({
      organizationId: orgId,
      key,
      version: Number(versionRow?.version ?? 1),
      language: 'ar',
      html,
      contentHash: createHash('sha256').update(html).digest('hex'),
      active: true,
    })
    .returning({ id: contractTemplates.id });
  return created!.id;
}

function contractSignatureHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Issue a signed amendment addendum linked to the parent stay contract, then keep
 * the parent snapshot + lease aligned with the new booking terms.
 */
async function syncStayContractAfterRescheduleInTx(
  transaction: Tx,
  booking: typeof stayBookings.$inferSelect,
  stayType: RescheduleStayType,
  move: RescheduleMove,
): Promise<{ id: string; reference: string } | null> {
  const [parent] = await transaction
    .select({
      id: contracts.id,
      reference: contracts.reference,
      payloadSnapshot: contracts.payloadSnapshot,
      ownerPartyId: contracts.ownerPartyId,
      tenantPartyId: contracts.tenantPartyId,
      unitId: contracts.unitId,
      status: contracts.status,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.organizationId, booking.organizationId),
        sql`${contracts.payloadSnapshot}->'source'->>'stayBookingId' = ${booking.id}`,
        ne(contracts.status, 'void'),
        isNull(contracts.parentContractId),
      ),
    )
    .limit(1);
  if (!parent) return null;

  const [profileTimes] = booking.stayProfileId
    ? await transaction
        .select({
          checkInFrom: stayProfiles.checkInFrom,
          dayUseCheckInFrom: stayProfiles.dayUseCheckInFrom,
          dayUseCheckOutUntil: stayProfiles.dayUseCheckOutUntil,
          overnightCheckOutUntil: stayProfiles.overnightCheckOutUntil,
          checkOutUntil: stayProfiles.checkOutUntil,
        })
        .from(stayProfiles)
        .where(
          and(
            eq(stayProfiles.id, booking.stayProfileId),
            eq(stayProfiles.organizationId, booking.organizationId),
          ),
        )
        .limit(1)
    : [null];
  const period = resolveStayPeriodTimes(stayType, profileTimes ?? {});
  const previousPeriod = resolveStayPeriodTimes(move.fromStayType, profileTimes ?? {});
  const startsOn = booking.checkInOn.slice(0, 10);
  const endsOn =
    booking.checkOutOn.slice(0, 10) > startsOn
      ? booking.checkOutOn.slice(0, 10)
      : addCalendarDays(startsOn, 1);
  const fromStartsOn = move.fromCheckInOn.slice(0, 10);
  const fromEndsOn =
    move.fromCheckOutOn.slice(0, 10) > fromStartsOn
      ? move.fromCheckOutOn.slice(0, 10)
      : addCalendarDays(fromStartsOn, 1);
  const snapshot =
    parent.payloadSnapshot && typeof parent.payloadSnapshot === 'object'
      ? { ...(parent.payloadSnapshot as Record<string, unknown>) }
      : {};
  const priorAmount =
    snapshot.amount && typeof snapshot.amount === 'object'
      ? (snapshot.amount as Record<string, unknown>)
      : {};
  const currency =
    typeof priorAmount.currency === 'string' ? priorAmount.currency : booking.currency;
  const previousAmountMinor =
    typeof priorAmount.amountMinor === 'string'
      ? priorAmount.amountMinor
      : (move.originalTotalMinor ?? booking.totalMinor.toString());
  const now = new Date();
  const originalTotalMinor = move.originalTotalMinor ?? previousAmountMinor;
  const extraDueMinor =
    move.extraDueMinor ??
    (BigInt(move.chargedTotalMinor) > BigInt(originalTotalMinor)
      ? (BigInt(move.chargedTotalMinor) - BigInt(originalTotalMinor)).toString()
      : '0');

  const templateId = await ensureStayRescheduleAmendmentTemplate(
    transaction,
    booking.organizationId,
  );
  const parentReference = parent.reference ?? `CTR-${parent.id.slice(0, 8).toUpperCase()}`;
  const reference = await allocateChildContractReference(
    transaction,
    booking.organizationId,
    parent.id,
    parentReference,
  );
  const owner = snapshot.owner && typeof snapshot.owner === 'object' ? snapshot.owner : null;
  const tenant =
    (snapshot.tenant && typeof snapshot.tenant === 'object' ? snapshot.tenant : null) ??
    (snapshot.buyer && typeof snapshot.buyer === 'object' ? snapshot.buyer : null);
  const property =
    snapshot.property && typeof snapshot.property === 'object' ? snapshot.property : null;
  const unit = snapshot.unit && typeof snapshot.unit === 'object' ? snapshot.unit : null;

  const [amendment] = await transaction
    .insert(contracts)
    .values({
      organizationId: booking.organizationId,
      reference,
      kind: 'amendment',
      parentContractId: parent.id,
      templateVersionId: templateId,
      unitId: parent.unitId,
      ownerPartyId: parent.ownerPartyId,
      tenantPartyId: parent.tenantPartyId,
      status: 'signed',
      sentAt: now,
      completedAt: now,
      payloadSnapshot: {
        contract: {
          reference,
          type: 'lease',
          kind: 'amendment',
          parentReference,
        },
        source: {
          type: 'stay_booking_reschedule',
          stayBookingId: booking.id,
          referenceCode: booking.referenceCode,
        },
        owner: owner ?? { id: parent.ownerPartyId },
        tenant: tenant ?? { id: parent.tenantPartyId },
        property,
        unit: unit ?? { id: parent.unitId },
        startsOn,
        endsOn,
        stayType,
        checkInTime: period.checkInTime,
        checkOutTime: period.checkOutTime,
        amount: { amountMinor: move.chargedTotalMinor, currency },
        previous: {
          startsOn: fromStartsOn,
          endsOn: fromEndsOn,
          stayType: move.fromStayType,
          checkInTime: previousPeriod.checkInTime,
          checkOutTime: previousPeriod.checkOutTime,
          amount: { amountMinor: originalTotalMinor, currency },
        },
        difference: {
          originalTotalMinor,
          quotedTotalMinor: move.quotedTotalMinor,
          chargedTotalMinor: move.chargedTotalMinor,
          forfeitedMinor: move.forfeitedMinor,
          extraDueMinor,
        },
        approvals: {
          guest: { at: move.at, method: 'reschedule_request' },
          owner: { at: now.toISOString(), method: 'reschedule_approval' },
        },
        approval: {
          mode: 'signed_on_reschedule',
          at: now.toISOString(),
        },
      },
    })
    .returning({ id: contracts.id });

  if (amendment) {
    await transaction
      .insert(contractSignatures)
      .values([
        {
          organizationId: booking.organizationId,
          contractId: amendment.id,
          signerPartyId: parent.tenantPartyId,
          signerRole: 'tenant',
          method: 'reschedule_request',
          evidence: {
            bookingReference: booking.referenceCode,
            kind: 'stay_reschedule',
            fromCheckInOn: fromStartsOn,
            toCheckInOn: startsOn,
            approvedAt: move.at,
          },
          signatureHash: contractSignatureHash([
            amendment.id,
            parent.tenantPartyId,
            'tenant',
            move.at,
          ]),
          signedAt: new Date(move.at),
        },
        {
          organizationId: booking.organizationId,
          contractId: amendment.id,
          signerPartyId: parent.ownerPartyId,
          signerRole: 'owner',
          method: 'reschedule_approval',
          evidence: {
            bookingReference: booking.referenceCode,
            kind: 'stay_reschedule',
            onBehalfOf: 'owner',
            approvedAt: now.toISOString(),
          },
          signatureHash: contractSignatureHash([
            amendment.id,
            parent.ownerPartyId,
            'owner',
            now.toISOString(),
          ]),
          signedAt: now,
        },
      ])
      .onConflictDoNothing();
  }

  await transaction
    .update(contracts)
    .set({
      payloadSnapshot: {
        ...snapshot,
        startsOn,
        endsOn,
        stayType,
        checkInTime: period.checkInTime,
        checkOutTime: period.checkOutTime,
        amount: {
          ...priorAmount,
          amountMinor: move.chargedTotalMinor,
          currency,
        },
        rescheduleSync: {
          at: now.toISOString(),
          fromStartsOn,
          fromEndsOn,
          fromStayType: move.fromStayType,
          amendmentContractId: amendment?.id ?? null,
          amendmentReference: reference,
        },
      },
      updatedAt: now,
    })
    .where(and(eq(contracts.id, parent.id), eq(contracts.organizationId, booking.organizationId)));

  await transaction
    .update(leases)
    .set({
      startsOn,
      endsOn,
      rentMinor: BigInt(move.chargedTotalMinor),
      updatedAt: now,
    })
    .where(
      and(
        eq(leases.organizationId, booking.organizationId),
        eq(leases.contractId, parent.id),
        inArray(leases.status, ['draft', 'active', 'cancel_requested', 'clearance_pending']),
      ),
    );

  return amendment ? { id: amendment.id, reference } : null;
}

function todayInTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export type GuestStayRescheduleQuote = StayRescheduleCharge & {
  referenceCode: string;
  currency: string;
  checkInOn: string;
  checkOutOn: string;
  nights: number;
  hasOffer: boolean;
  paid: boolean;
  stayType: RescheduleStayType;
};

export type GuestStayReschedulePayment = {
  redirectUrl: string;
  paymentIntentId: string;
  amountMinor: string;
  currency: string;
};

type PricedStayRange = Awaited<ReturnType<typeof priceStayRangeForUnitOnNeon>>;

async function applyGuestRescheduleInTx(
  transaction: Tx,
  booking: typeof stayBookings.$inferSelect,
  priced: PricedStayRange,
  stayType: RescheduleStayType,
  charge: StayRescheduleCharge,
): Promise<typeof stayBookings.$inferSelect> {
  const now = new Date();
  let inventoryLockId = booking.inventoryLockId;
  if (booking.inventoryLockId) {
    const [oldLock] = await transaction
      .select()
      .from(stayInventoryLocks)
      .where(
        and(
          eq(stayInventoryLocks.id, booking.inventoryLockId),
          eq(stayInventoryLocks.organizationId, booking.organizationId),
        ),
      )
      .limit(1);
    if (oldLock?.status === 'active') {
      await transaction
        .update(stayInventoryLocks)
        .set({ status: 'released', updatedAt: now })
        .where(eq(stayInventoryLocks.id, oldLock.id));
      const lock = await createLockInTransaction(transaction, {
        organizationId: booking.organizationId,
        unitId: booking.unitId,
        checkInOn: priced.checkInOn,
        checkOutOn: priced.checkOutOn,
        kind: oldLock.kind,
        lockSlot:
          stayType === 'day_use' ? 'morning' : stayType === 'overnight_only' ? 'evening' : 'full',
        ...(oldLock.expiresAt ? { expiresAt: oldLock.expiresAt } : {}),
        ...(oldLock.sourceType ? { sourceType: oldLock.sourceType } : {}),
        ...(oldLock.sourceId ? { sourceId: oldLock.sourceId } : {}),
        note: `Guest rescheduled ${booking.referenceCode}`,
      });
      inventoryLockId = lock.id;
      if (booking.holdId) {
        await transaction
          .update(stayHolds)
          .set({ inventoryLockId: lock.id, updatedAt: now })
          .where(
            and(
              eq(stayHolds.id, booking.holdId),
              eq(stayHolds.organizationId, booking.organizationId),
            ),
          );
      }
    }
  }

  const rawSnapshot: unknown = booking.pricingSnapshotJson;
  const snapshot: Record<string, unknown> =
    rawSnapshot && typeof rawSnapshot === 'object' ? { ...rawSnapshot } : {};
  const previousMoves: unknown[] = Array.isArray(snapshot.reschedules)
    ? (snapshot.reschedules as unknown[])
    : [];
  const fromStayType = rescheduleStayType(readStayTypeFromSnapshot(booking.pricingSnapshotJson));
  const move: RescheduleMove = {
    at: now.toISOString(),
    fromCheckInOn: booking.checkInOn,
    fromCheckOutOn: booking.checkOutOn,
    fromStayType,
    toCheckInOn: priced.checkInOn,
    toCheckOutOn: priced.checkOutOn,
    toStayType: stayType,
    quotedTotalMinor: charge.quotedTotalMinor,
    chargedTotalMinor: charge.chargedTotalMinor,
    forfeitedMinor: charge.forfeitedMinor,
    originalTotalMinor: charge.originalTotalMinor,
    extraDueMinor: charge.extraDueMinor,
    hasOffer: priced.hasOffer,
  };
  const takesNewPrice = !charge.keptOriginalPrice;
  const [updated] = await transaction
    .update(stayBookings)
    .set({
      checkInOn: priced.checkInOn,
      checkOutOn: priced.checkOutOn,
      inventoryLockId,
      ...(takesNewPrice
        ? {
            subtotalMinor: BigInt(priced.subtotalMinor),
            feesMinor: BigInt(priced.feesMinor),
            totalMinor: BigInt(charge.chargedTotalMinor),
          }
        : {}),
      pricingSnapshotJson: {
        ...snapshot,
        stayType,
        lineItems: priced.nightLines,
        pendingReschedule: null,
        reschedules: [...previousMoves, move],
      },
      updatedAt: now,
    })
    .where(
      and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, booking.organizationId)),
    )
    .returning();
  if (!updated) {
    throw new PublicStayBookingError('reschedule_failed', 'Could not change dates', 409);
  }

  const paid = PAID_STATUSES.has(booking.status);
  if (!paid && charge.chargedTotalMinor !== charge.originalTotalMinor) {
    const amount = BigInt(charge.chargedTotalMinor);
    await transaction
      .update(stayPaymentIntents)
      .set({ amountMinor: amount, updatedAt: now })
      .where(
        and(
          eq(stayPaymentIntents.bookingId, booking.id),
          eq(stayPaymentIntents.organizationId, booking.organizationId),
          eq(stayPaymentIntents.status, 'pending'),
        ),
      );
    await transaction
      .update(stayFolios)
      .set({ balanceMinor: amount, updatedAt: now })
      .where(
        and(
          eq(stayFolios.bookingId, booking.id),
          eq(stayFolios.organizationId, booking.organizationId),
          eq(stayFolios.status, 'open'),
        ),
      );
  }

  const amendment = await syncStayContractAfterRescheduleInTx(transaction, updated, stayType, move);
  const [profileTimesForLog] = booking.stayProfileId
    ? await transaction
        .select({
          checkInFrom: stayProfiles.checkInFrom,
          dayUseCheckInFrom: stayProfiles.dayUseCheckInFrom,
          dayUseCheckOutUntil: stayProfiles.dayUseCheckOutUntil,
          overnightCheckOutUntil: stayProfiles.overnightCheckOutUntil,
          checkOutUntil: stayProfiles.checkOutUntil,
        })
        .from(stayProfiles)
        .where(
          and(
            eq(stayProfiles.id, booking.stayProfileId),
            eq(stayProfiles.organizationId, booking.organizationId),
          ),
        )
        .limit(1)
    : [null];
  const fromPeriod = resolveStayPeriodTimes(move.fromStayType, profileTimesForLog ?? {});
  const toPeriod = resolveStayPeriodTimes(stayType, profileTimesForLog ?? {});
  const historyMeta = {
    ...move,
    fromCheckInTime: fromPeriod.checkInTime,
    fromCheckOutTime: fromPeriod.checkOutTime,
    toCheckInTime: toPeriod.checkInTime,
    toCheckOutTime: toPeriod.checkOutTime,
    ...(amendment
      ? {
          amendmentContractId: amendment.id,
          amendmentReference: amendment.reference,
          contractId: amendment.id,
          contractReference: amendment.reference,
        }
      : {}),
  };

  await transaction.insert(stayBookingStatusHistory).values({
    organizationId: booking.organizationId,
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: booking.status,
    reason: 'guest_rescheduled',
    metadataJson: historyMeta,
  });
  await transaction.insert(outboxEvents).values({
    organizationId: booking.organizationId,
    topic: 'stay.booking.rescheduled',
    aggregateType: 'stay_booking',
    aggregateId: booking.id,
    payload: { referenceCode: booking.referenceCode, unitId: booking.unitId, ...historyMeta },
  });

  return updated;
}

/**
 * Guest moves a booking to new free dates and/or period. With `confirm: false` it only prices;
 * with `confirm: true` it applies the move, or returns a top-up payment redirect when more is due.
 */
export type GuestStayRescheduleNotify = {
  bookingId: string;
  organizationId: string;
  referenceCode: string;
  kind: 'reschedule_requested' | 'reschedule_auto';
};

export async function rescheduleGuestStayBookingOnNeon(input: {
  referenceCode: string;
  checkInOn: string;
  checkOutOn: string;
  stayType?: RescheduleStayType | undefined;
  confirm: boolean;
  locale?: 'ar' | 'en' | undefined;
}): Promise<{
  quote: GuestStayRescheduleQuote;
  booking?: GuestStayBookingProjection;
  payment?: GuestStayReschedulePayment;
  awaitingOwnerApproval?: boolean;
  notifyOwner?: GuestStayRescheduleNotify;
}> {
  assertPlatformEnabled();
  const normalized = input.referenceCode.trim().toUpperCase();
  if (normalized.length < 4) {
    throw new PublicStayBookingError('invalid_body', 'Invalid booking reference', 400);
  }

  return asPublic(async (transaction) => {
    const found = await transaction.query.stayBookings.findFirst({
      where: eq(stayBookings.referenceCode, normalized),
    });
    if (!found) {
      throw new PublicStayBookingError('not_found', 'Stay booking not found', 404);
    }
    assertOrgEnabled(found.organizationId);
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${found.unitId}::text))`);

    const booking = (await refreshUnpaidBooking(transaction, found.id)) ?? found;
    if (!GUEST_RESCHEDULABLE.has(booking.status)) {
      throw new PublicStayBookingError(
        'illegal_transition',
        `Cannot change dates in status ${booking.status}`,
        409,
      );
    }
    if (input.checkInOn < todayInTimezone(booking.timezone)) {
      throw new PublicStayBookingError('dates_in_past', 'New dates must not be in the past', 409);
    }

    const listing = await resolveListing(
      transaction,
      booking.organizationId,
      booking.stayProfileId,
    );
    if (!listing) {
      throw new PublicStayBookingError('not_found', 'Stay listing not found', 404);
    }

    const currentType = rescheduleStayType(readStayTypeFromSnapshot(booking.pricingSnapshotJson));
    const stayType = input.stayType ? rescheduleStayType(input.stayType) : currentType;
    const priced = await priceStayRangeForUnitOnNeon({
      slug: listing.slug,
      unitId: booking.unitId,
      stayType,
      checkInOn: input.checkInOn,
      checkOutOn: input.checkOutOn,
    });
    if (
      priced.checkInOn === booking.checkInOn &&
      priced.checkOutOn === booking.checkOutOn &&
      stayType === currentType
    ) {
      throw new PublicStayBookingError('same_dates', 'Selection matches the current booking', 409);
    }
    if (priced.currency !== booking.currency) {
      throw new PublicStayBookingError('currency_changed', 'Listing currency changed', 409);
    }

    const available = await isRangeAvailableInTransaction(
      transaction,
      booking.organizationId,
      booking.unitId,
      priced.checkInOn,
      priced.checkOutOn,
      stayType,
      booking.id,
    );
    if (!available) {
      throw new PublicStayBookingError(
        'dates_unavailable',
        'Selected dates are not available',
        409,
      );
    }

    const paid = PAID_STATUSES.has(booking.status);
    const charge = stayRescheduleCharge({
      originalTotalMinor: booking.totalMinor.toString(),
      quotedTotalMinor: priced.totalMinor,
      paid,
    });
    const quote: GuestStayRescheduleQuote = {
      ...charge,
      referenceCode: booking.referenceCode,
      currency: booking.currency,
      checkInOn: priced.checkInOn,
      checkOutOn: priced.checkOutOn,
      nights: priced.nights,
      hasOffer: priced.hasOffer,
      paid,
      stayType,
    };
    if (!input.confirm) return { quote };

    const existingPending = readPendingReschedule(booking.pricingSnapshotJson);
    if (existingPending) {
      throw new PublicStayBookingError(
        'reschedule_pending',
        'A date change is already awaiting approval or payment',
        409,
      );
    }

    const [profile] = await transaction
      .select({
        autoApproveReschedule: stayProfiles.autoApproveReschedule,
        checkInFrom: stayProfiles.checkInFrom,
        dayUseCheckInFrom: stayProfiles.dayUseCheckInFrom,
        dayUseCheckOutUntil: stayProfiles.dayUseCheckOutUntil,
        overnightCheckOutUntil: stayProfiles.overnightCheckOutUntil,
        checkOutUntil: stayProfiles.checkOutUntil,
      })
      .from(stayProfiles)
      .where(
        and(
          eq(stayProfiles.id, booking.stayProfileId),
          eq(stayProfiles.organizationId, booking.organizationId),
        ),
      )
      .limit(1);
    const autoApprove = profile?.autoApproveReschedule !== false;
    const requestedPeriod = resolveStayPeriodTimes(stayType, profile ?? {});

    const pendingBase = {
      checkInOn: priced.checkInOn,
      checkOutOn: priced.checkOutOn,
      stayType,
      checkInTime: requestedPeriod.checkInTime,
      checkOutTime: requestedPeriod.checkOutTime,
      quotedTotalMinor: charge.quotedTotalMinor,
      chargedTotalMinor: charge.chargedTotalMinor,
      extraDueMinor: charge.extraDueMinor,
      originalTotalMinor: charge.originalTotalMinor,
      subtotalMinor: priced.subtotalMinor,
      feesMinor: priced.feesMinor,
      nightLines: priced.nightLines,
      hasOffer: priced.hasOffer,
      at: new Date().toISOString(),
    };

    if (!autoApprove) {
      const now = new Date();
      const rawSnapshot: unknown = booking.pricingSnapshotJson;
      const snapshot: Record<string, unknown> =
        rawSnapshot && typeof rawSnapshot === 'object' ? { ...rawSnapshot } : {};
      const pending = { ...pendingBase, status: 'awaiting_owner' as const };
      const [updated] = await transaction
        .update(stayBookings)
        .set({
          pricingSnapshotJson: { ...snapshot, pendingReschedule: pending },
          updatedAt: now,
        })
        .where(
          and(
            eq(stayBookings.id, booking.id),
            eq(stayBookings.organizationId, booking.organizationId),
          ),
        )
        .returning();
      if (!updated) {
        throw new PublicStayBookingError('reschedule_failed', 'Could not request date change', 409);
      }
      await transaction.insert(stayBookingStatusHistory).values({
        organizationId: booking.organizationId,
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: booking.status,
        reason: 'guest_reschedule_requested',
        metadataJson: pending,
      });
      await transaction.insert(outboxEvents).values({
        organizationId: booking.organizationId,
        topic: 'stay.booking.reschedule_requested',
        aggregateType: 'stay_booking',
        aggregateId: booking.id,
        payload: {
          referenceCode: booking.referenceCode,
          unitId: booking.unitId,
          ...pending,
        },
      });
      return {
        quote,
        booking: await enrichProjection(transaction, updated),
        awaitingOwnerApproval: true as const,
        notifyOwner: {
          bookingId: booking.id,
          organizationId: booking.organizationId,
          referenceCode: booking.referenceCode,
          kind: 'reschedule_requested' as const,
        },
      };
    }

    if (charge.requiresPayment) {
      const payment = await createRescheduleTopUpPaymentInTx(
        transaction,
        booking,
        {
          ...pendingBase,
          status: 'awaiting_payment' as const,
        },
        input.locale === 'en' ? 'en' : 'ar',
      );
      return { quote, payment };
    }

    const updated = await applyGuestRescheduleInTx(transaction, booking, priced, stayType, charge);
    return {
      quote,
      booking: await enrichProjection(transaction, updated),
      notifyOwner: {
        bookingId: booking.id,
        organizationId: booking.organizationId,
        referenceCode: booking.referenceCode,
        kind: 'reschedule_auto' as const,
      },
    };
  });
}

export async function createRescheduleTopUpPaymentInTx(
  transaction: Tx,
  booking: typeof stayBookings.$inferSelect,
  pending: Record<string, unknown> & {
    checkInOn: string;
    checkOutOn: string;
    stayType: RescheduleStayType;
    extraDueMinor: string;
  },
  locale: 'ar' | 'en' = 'ar',
): Promise<GuestStayReschedulePayment> {
  const now = new Date();
  const rawSnapshot: unknown = booking.pricingSnapshotJson;
  const snapshot: Record<string, unknown> =
    rawSnapshot && typeof rawSnapshot === 'object' ? { ...rawSnapshot } : {};
  await transaction
    .update(stayBookings)
    .set({
      pricingSnapshotJson: { ...snapshot, pendingReschedule: pending },
      updatedAt: now,
    })
    .where(
      and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, booking.organizationId)),
    );

  const idempotencyKey = `reschedule_topup:${booking.id}:${pending.checkInOn}:${pending.checkOutOn}:${pending.stayType}`;
  const [existing] = await transaction
    .select()
    .from(stayPaymentIntents)
    .where(
      and(
        eq(stayPaymentIntents.organizationId, booking.organizationId),
        eq(stayPaymentIntents.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  let intentId = existing?.id;
  let sessionReference = existing?.providerIntentId ?? null;
  if (!existing || existing.status === 'cancelled' || existing.status === 'failed') {
    const [created] = await transaction
      .insert(stayPaymentIntents)
      .values({
        organizationId: booking.organizationId,
        bookingId: booking.id,
        status: 'pending',
        amountMinor: BigInt(pending.extraDueMinor),
        currency: booking.currency,
        idempotencyKey,
        provider: 'sandbox',
      })
      .returning({ id: stayPaymentIntents.id });
    intentId = created?.id;
  } else if (existing.status === 'succeeded') {
    throw new PublicStayBookingError(
      'reschedule_requires_payment',
      'Top-up already paid — refresh and confirm again',
      409,
    );
  } else if (existing.amountMinor.toString() !== pending.extraDueMinor) {
    await transaction
      .update(stayPaymentIntents)
      .set({ amountMinor: BigInt(pending.extraDueMinor), updatedAt: now })
      .where(eq(stayPaymentIntents.id, existing.id));
  }

  if (!intentId) {
    throw new PublicStayBookingError(
      'reschedule_payment_failed',
      'Could not create top-up payment',
      500,
    );
  }

  if (!sessionReference || !/^[A-Za-z0-9_-]{24,80}$/.test(sessionReference)) {
    sessionReference = randomBytes(24).toString('base64url');
    await transaction
      .update(stayPaymentIntents)
      .set({
        provider: 'sandbox',
        providerIntentId: sessionReference,
        status: 'pending',
        updatedAt: now,
      })
      .where(eq(stayPaymentIntents.id, intentId));
  }

  const origin = publicWebOrigin();
  const returnPath = `/${locale}/guest/stays/${booking.id}?ref=${encodeURIComponent(booking.referenceCode)}`;
  return {
    redirectUrl: `${origin}/${locale}/payments/sandbox/${sessionReference}?kind=stay&return=${encodeURIComponent(returnPath)}`,
    paymentIntentId: intentId,
    amountMinor: pending.extraDueMinor,
    currency: booking.currency,
  };
}

/**
 * Apply a stored `pendingReschedule` after top-up payment or owner approval.
 * `mode: 'topup'` forces the new quoted total (difference already paid).
 */
export async function applyStoredPendingRescheduleInTx(
  transaction: Tx,
  booking: typeof stayBookings.$inferSelect,
  mode: 'topup' | 'owner' = 'topup',
): Promise<typeof stayBookings.$inferSelect | null> {
  const snapshot =
    booking.pricingSnapshotJson && typeof booking.pricingSnapshotJson === 'object'
      ? (booking.pricingSnapshotJson)
      : null;
  const pending =
    snapshot?.pendingReschedule && typeof snapshot.pendingReschedule === 'object'
      ? (snapshot.pendingReschedule as Record<string, unknown>)
      : null;
  if (!pending) return null;
  const checkInOn = typeof pending.checkInOn === 'string' ? pending.checkInOn : null;
  const checkOutOn = typeof pending.checkOutOn === 'string' ? pending.checkOutOn : null;
  const stayType = rescheduleStayType(
    typeof pending.stayType === 'string' ? pending.stayType : null,
  );
  if (!checkInOn || !checkOutOn) return null;

  const available = await isRangeAvailableInTransaction(
    transaction,
    booking.organizationId,
    booking.unitId,
    checkInOn,
    checkOutOn,
    stayType,
    booking.id,
  );
  if (!available) {
    throw new PublicStayBookingError(
      'dates_unavailable',
      'Selected dates are no longer available',
      409,
    );
  }

  const quotedTotalMinor =
    typeof pending.quotedTotalMinor === 'string' ? pending.quotedTotalMinor : null;
  const chargedTotalMinor =
    typeof pending.chargedTotalMinor === 'string' ? pending.chargedTotalMinor : null;
  const originalTotalMinor =
    typeof pending.originalTotalMinor === 'string'
      ? pending.originalTotalMinor
      : booking.totalMinor.toString();
  if (!quotedTotalMinor || !chargedTotalMinor) return null;

  const charge = stayRescheduleCharge({
    originalTotalMinor,
    quotedTotalMinor,
    paid: true,
  });
  const priced = {
    checkInOn,
    checkOutOn,
    nights:
      typeof pending.nightLines === 'object' && Array.isArray(pending.nightLines)
        ? pending.nightLines.length || 1
        : 1,
    totalMinor: chargedTotalMinor,
    subtotalMinor:
      typeof pending.subtotalMinor === 'string' ? pending.subtotalMinor : chargedTotalMinor,
    feesMinor: typeof pending.feesMinor === 'string' ? pending.feesMinor : '0',
    nightLines: Array.isArray(pending.nightLines) ? pending.nightLines : [],
    hasOffer: pending.hasOffer === true,
    currency: booking.currency,
  } as PricedStayRange;

  const appliedCharge: StayRescheduleCharge =
    mode === 'topup'
      ? {
          ...charge,
          chargedTotalMinor: quotedTotalMinor,
          keptOriginalPrice: false,
          requiresPayment: false,
          extraDueMinor: '0',
          forfeitedMinor: '0',
        }
      : { ...charge, requiresPayment: false };

  return applyGuestRescheduleInTx(transaction, booking, priced, stayType, appliedCharge);
}

/** @deprecated Prefer applyStoredPendingRescheduleInTx — kept for payment callers. */
export async function applyPendingRescheduleAfterTopUpInTx(
  transaction: Tx,
  booking: typeof stayBookings.$inferSelect,
): Promise<typeof stayBookings.$inferSelect | null> {
  return applyStoredPendingRescheduleInTx(transaction, booking, 'topup');
}

/** Clear a pending guest reschedule (owner reject or guest cancel of the request). */
export async function clearPendingRescheduleInTx(
  transaction: Tx,
  booking: typeof stayBookings.$inferSelect,
  reason: string,
  metadata: Record<string, unknown> = {},
): Promise<typeof stayBookings.$inferSelect> {
  const rawSnapshot: unknown = booking.pricingSnapshotJson;
  const snapshot: Record<string, unknown> =
    rawSnapshot && typeof rawSnapshot === 'object' ? { ...rawSnapshot } : {};
  const pending = snapshot.pendingReschedule;
  const now = new Date();
  const [updated] = await transaction
    .update(stayBookings)
    .set({
      pricingSnapshotJson: { ...snapshot, pendingReschedule: null },
      updatedAt: now,
    })
    .where(
      and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, booking.organizationId)),
    )
    .returning();
  if (!updated) {
    throw new PublicStayBookingError(
      'reschedule_failed',
      'Could not clear pending reschedule',
      409,
    );
  }
  await transaction.insert(stayBookingStatusHistory).values({
    organizationId: booking.organizationId,
    bookingId: booking.id,
    fromStatus: booking.status,
    toStatus: booking.status,
    reason,
    metadataJson: { pending, ...metadata },
  });
  return updated;
}
