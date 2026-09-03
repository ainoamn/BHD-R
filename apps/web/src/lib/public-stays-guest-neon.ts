import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { resolveStaysEnabledFromEnv, readStaysFlagsFromEnv } from '@bhd-r/config';
import {
  createDatabase,
  stayBookingGuests,
  stayBookingStatusHistory,
  stayBookings,
  stayHolds,
  stayInventoryLocks,
  type Database,
} from '@bhd-r/db';
import { assertStayBookingTransition, nightsBetween } from '@bhd-r/domain';
import { PublicStayBookingError } from '@/lib/public-stays-booking-neon';

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
  esignCompleted?: boolean;
  canPay?: boolean;
  canCancel?: boolean;
  canRebook?: boolean;
};

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

function actionFlags(status: string): { canPay: boolean; canCancel: boolean; canRebook: boolean } {
  return {
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
    ...flags,
    canPay: flags.canPay && Boolean(booking.paymentIntentId),
  };
}

async function resolveListingSlug(
  transaction: Tx,
  organizationId: string,
  stayProfileId: string,
): Promise<string | null> {
  const listingRows = await transaction.execute(sql`
    SELECT spl.slug
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
  const rows = Array.isArray(listingRows)
    ? listingRows
    : ((listingRows as { rows?: Array<{ slug: string }> }).rows ?? []);
  const slug = rows[0]?.slug;
  return typeof slug === 'string' && slug.trim() ? slug.trim() : null;
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
  const [paymentIntentId, listingSlug] = await Promise.all([
    resolvePaymentIntentId(transaction, booking.organizationId, booking.id),
    resolveListingSlug(transaction, booking.organizationId, booking.stayProfileId),
  ]);
  return toProjection({
    ...booking,
    guestDisplayName: guestDisplayName ?? null,
    paymentIntentId,
    listingSlug,
  });
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
