import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { resolveStaysEnabledFromEnv, readStaysFlagsFromEnv } from '@bhd-r/config';
import { createDatabase, stayBookings, type Database } from '@bhd-r/db';
import { nightsBetween } from '@bhd-r/domain';
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
};

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
}): GuestStayBookingProjection {
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
  };
}

export async function lookupPublicStayBookingOnNeon(referenceCode: string) {
  assertPlatformEnabled();
  const normalized = referenceCode.trim().toUpperCase();
  if (normalized.length < 4) {
    throw new PublicStayBookingError('invalid_body', 'Invalid booking reference', 400);
  }

  const booking = await asPublic(async (transaction) =>
    transaction.query.stayBookings.findFirst({
      where: eq(stayBookings.referenceCode, normalized),
    }),
  );
  if (!booking) {
    throw new PublicStayBookingError('not_found', 'Stay booking not found', 404);
  }
  assertOrgEnabled(booking.organizationId);
  return toProjection(booking);
}

export async function listGuestStayBookingsOnNeon(userId: string) {
  assertPlatformEnabled();
  const rows = await asPublic(async (transaction) =>
    transaction
      .select()
      .from(stayBookings)
      .where(eq(stayBookings.userId, userId))
      .orderBy(desc(stayBookings.checkInOn), desc(stayBookings.createdAt))
      .limit(50),
  );

  return {
    items: rows
      .filter((row) => {
        try {
          assertOrgEnabled(row.organizationId);
          return true;
        } catch {
          return false;
        }
      })
      .map((row) => toProjection(row)),
  };
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
      return { ...toProjection(booking), duplicate: true as const };
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
    return { ...toProjection(updated), duplicate: false as const };
  });
}
