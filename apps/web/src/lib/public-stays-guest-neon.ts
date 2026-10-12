import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { resolveStaysEnabledFromEnv, readStaysFlagsFromEnv } from '@bhd-r/config';
import {
  createDatabase,
  outboxEvents,
  stayBookingGuests,
  stayBookingStatusHistory,
  stayBookings,
  stayFolios,
  stayHolds,
  stayInventoryLocks,
  stayPaymentIntents,
  type Database,
} from '@bhd-r/db';
import { assertStayBookingTransition, nightsBetween } from '@bhd-r/domain';
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
  type RefundPayout,
} from '@/lib/stay-deposit-refund';
import {
  insertGuestDepositRefundRequest,
  loadBookingDeposits,
  loadDepositRefunds,
} from '@/lib/stay-deposit-refund-neon';
import { stayRescheduleCharge, type StayRescheduleCharge } from '@/lib/stay-reschedule-pricing';

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
  paymentIntentId?: string | null;
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
  checkIn?: StayStamp | null;
  checkOut?: StayStamp | null;
  /** Security deposit held for the stay (not part of the booking total). */
  depositMinor?: string | null;
  depositRefund?: GuestDepositRefund | null;
  canRequestDepositRefund?: boolean;
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
    canPay: flags.canPay && Boolean(booking.paymentIntentId),
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
        h.id IS NULL
        OR h.status <> 'active'
        OR h.expires_at <= now()
        OR (l.expires_at IS NOT NULL AND l.expires_at <= now())
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
      AND (
        b.hold_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM stay_holds h
          WHERE h.id = b.hold_id
            AND h.status = 'active'
            AND h.expires_at > now()
        )
      )
  `);
  return transaction.query.stayBookings.findFirst({
    where: eq(stayBookings.id, bookingId),
  });
}

async function enrichProjection(
  transaction: Tx,
  booking: typeof stayBookings.$inferSelect,
  guestDisplayName?: string | null,
): Promise<GuestStayBookingProjection> {
  const departed = DEPARTED_STATUSES.has(booking.status);
  const [paymentIntentId, listing, stamps, deposits, refunds] = await Promise.all([
    resolvePaymentIntentId(transaction, booking.organizationId, booking.id),
    resolveListing(transaction, booking.organizationId, booking.stayProfileId),
    STAMPED_STATUSES.has(booking.status)
      ? loadStayStamps(transaction, booking.organizationId, [booking.id])
      : Promise.resolve(null),
    departed
      ? loadBookingDeposits(transaction, booking.organizationId, [booking.id])
      : Promise.resolve(null),
    departed
      ? loadDepositRefunds(transaction, booking.organizationId, [booking.id])
      : Promise.resolve(null),
  ]);
  const stamp = stamps?.get(booking.id);
  const depositMinor = deposits?.get(booking.id) ?? null;
  const refund = refunds?.get(booking.id);
  return {
    depositMinor,
    depositRefund: refund ? guestDepositRefund(refund) : null,
    canRequestDepositRefund: Boolean(depositMinor && !refund && booking.status === 'checked_out'),
    ...toProjection({
      ...booking,
      guestDisplayName: guestDisplayName ?? null,
      paymentIntentId,
      listingSlug: listing?.slug ?? null,
    }),
    listingTitleAr: listing?.titleAr ?? null,
    listingTitleEn: listing?.titleEn ?? null,
    checkIn: stamp?.checkIn ? { ...stamp.checkIn, recipient: null } : null,
    checkOut: stamp?.checkOut ? { ...stamp.checkOut, recipient: null } : null,
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

export async function listGuestStayBookingsOnNeon(userId: string) {
  assertPlatformEnabled();
  return asPublic(async (transaction) => {
    const rows = await transaction
      .select()
      .from(stayBookings)
      .where(eq(stayBookings.userId, userId))
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
  refund_account_invalid: 'Invalid receiving account or phone',
};

/** Guest asks for the security deposit back after check-out (by booking reference). */
export async function requestGuestDepositRefundOnNeon(input: {
  referenceCode: string;
  note?: string | undefined;
  payout?: RefundPayout | undefined;
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
          code === 'refund_account_invalid' ? 400 : 409,
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
};

/**
 * Guest moves a booking to new free dates. With `confirm: false` it only prices the move;
 * with `confirm: true` it moves the inventory lock and updates the booking in one transaction.
 * See `stayRescheduleCharge` for the no-refund price rule.
 */
export async function rescheduleGuestStayBookingOnNeon(input: {
  referenceCode: string;
  checkInOn: string;
  checkOutOn: string;
  confirm: boolean;
}): Promise<{ quote: GuestStayRescheduleQuote; booking?: GuestStayBookingProjection }> {
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

    const stayType = rescheduleStayType(readStayTypeFromSnapshot(booking.pricingSnapshotJson));
    const priced = await priceStayRangeForUnitOnNeon({
      slug: listing.slug,
      unitId: booking.unitId,
      stayType,
      checkInOn: input.checkInOn,
      checkOutOn: input.checkOutOn,
    });
    if (priced.checkInOn === booking.checkInOn && priced.checkOutOn === booking.checkOutOn) {
      throw new PublicStayBookingError('same_dates', 'New dates match the current booking', 409);
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
    };
    if (!input.confirm) return { quote };
    if (charge.requiresPayment) {
      throw new PublicStayBookingError(
        'reschedule_requires_payment',
        'New dates cost more than the amount paid',
        409,
      );
    }

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
    const move = {
      at: now.toISOString(),
      fromCheckInOn: booking.checkInOn,
      fromCheckOutOn: booking.checkOutOn,
      toCheckInOn: priced.checkInOn,
      toCheckOutOn: priced.checkOutOn,
      quotedTotalMinor: charge.quotedTotalMinor,
      chargedTotalMinor: charge.chargedTotalMinor,
      forfeitedMinor: charge.forfeitedMinor,
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
              totalMinor: BigInt(priced.totalMinor),
            }
          : {}),
        pricingSnapshotJson: {
          ...snapshot,
          lineItems: priced.nightLines,
          reschedules: [...previousMoves, move],
        },
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
      throw new PublicStayBookingError('reschedule_failed', 'Could not change dates', 409);
    }

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

    await transaction.insert(stayBookingStatusHistory).values({
      organizationId: booking.organizationId,
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: booking.status,
      reason: 'guest_rescheduled',
      metadataJson: move,
    });
    await transaction.insert(outboxEvents).values({
      organizationId: booking.organizationId,
      topic: 'stay.booking.rescheduled',
      aggregateType: 'stay_booking',
      aggregateId: booking.id,
      payload: { referenceCode: booking.referenceCode, unitId: booking.unitId, ...move },
    });

    return { quote, booking: await enrichProjection(transaction, updated) };
  });
}
