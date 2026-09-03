import 'server-only';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  createDatabase,
  outboxEvents,
  stayBookingStatusHistory,
  stayBookings,
  workflowEvents,
  type Database,
} from '@bhd-r/db';
import { PublicStayBookingError } from '@/lib/public-stays-booking-neon';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRStayEsignDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRStayEsignDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRStayEsignDb = { db };
  }
  return globalForDb.__bhdRStayEsignDb;
}

export async function completeStayEsignOnNeon(
  referenceCode: string,
  input: {
    signaturePng: string;
    idFrontPng: string;
    idBackPng: string;
    selfiePng: string;
  },
) {
  const normalized = referenceCode.trim().toUpperCase();
  if (normalized.length < 4) {
    throw new PublicStayBookingError('invalid_body', 'Invalid booking reference', 400);
  }

  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.public', 'true', true)`);
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${normalized}, 41))`,
    );

    const booking = await transaction.query.stayBookings.findFirst({
      where: eq(stayBookings.referenceCode, normalized),
    });
    if (!booking) {
      throw new PublicStayBookingError('not_found', 'Stay booking not found', 404);
    }
    if (booking.status !== 'confirmed' && booking.status !== 'paid') {
      throw new PublicStayBookingError(
        'booking_not_payable',
        'Booking must be paid before e-sign',
        409,
      );
    }

    const evidence = {
      signedAt: new Date().toISOString(),
      signaturePng: input.signaturePng,
      idFrontPng: input.idFrontPng,
      idBackPng: input.idBackPng,
      selfiePng: input.selfiePng,
    };

    await transaction.insert(stayBookingStatusHistory).values({
      organizationId: booking.organizationId,
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: booking.status,
      reason: 'Electronic signature completed',
      metadataJson: { esign: evidence },
    });

    await transaction.insert(workflowEvents).values({
      organizationId: booking.organizationId,
      actorUserId: null,
      resourceType: 'stay_booking',
      resourceId: booking.id,
      eventType: 'stay_booking.esign_completed',
      fromStatus: booking.status,
      toStatus: booking.status,
      metadata: {
        referenceCode: booking.referenceCode,
        signedAt: evidence.signedAt,
        hasSignature: true,
        hasIdFront: true,
        hasIdBack: true,
        hasSelfie: true,
      },
    });

    await transaction.insert(outboxEvents).values({
      organizationId: booking.organizationId,
      topic: 'stay_booking.esign_completed',
      aggregateType: 'stay_booking',
      aggregateId: booking.id,
      payload: {
        referenceCode: booking.referenceCode,
        signedAt: evidence.signedAt,
      },
    });

    // Attach compact pointers on pricing snapshot (full images live in status history).
    const snapshot =
      booking.pricingSnapshotJson && typeof booking.pricingSnapshotJson === 'object'
        ? { ...(booking.pricingSnapshotJson as Record<string, unknown>) }
        : {};
    snapshot.esign = {
      signedAt: evidence.signedAt,
      completed: true,
    };
    await transaction
      .update(stayBookings)
      .set({ pricingSnapshotJson: snapshot, updatedAt: new Date() })
      .where(and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, booking.organizationId)));

    return {
      completed: true as const,
      referenceCode: booking.referenceCode,
      signedAt: evidence.signedAt,
    };
  });
}
