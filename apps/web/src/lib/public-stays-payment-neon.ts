import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  isPaymentSandboxPilotEnabled,
  readStaysFlagsFromEnv,
  resolveStaysEnabledFromEnv,
} from '@bhd-r/config';
import type { CreateStayPaymentSessionInput } from '@bhd-r/contracts';
import {
  createDatabase,
  outboxEvents,
  stayBookingStatusHistory,
  stayBookings,
  stayHolds,
  stayInventoryLocks,
  stayPaymentIntents,
  workflowEvents,
  type Database,
} from '@bhd-r/db';
import { assertStayBookingTransition } from '@bhd-r/domain';
import { PublicStayBookingError } from '@/lib/public-stays-booking-neon';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPublicStaysPaymentDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPublicStaysPaymentDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPublicStaysPaymentDb = { db };
  }
  return globalForDb.__bhdRPublicStaysPaymentDb;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function asSystem<T>(work: (transaction: Tx) => Promise<T>): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);
    return work(transaction);
  });
}

function assertSandboxEnabled(): void {
  if (!isPaymentSandboxPilotEnabled()) {
    throw new PublicStayBookingError(
      'payment_gateway_inactive',
      'No supported online payment adapter is active',
      409,
    );
  }
  if (!readStaysFlagsFromEnv().platformEnabled) {
    throw new PublicStayBookingError('not_found', 'Stays booking is not enabled', 404);
  }
}

function publicWebOrigin(): string {
  return (
    process.env.PUBLIC_WEB_ORIGIN ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.WEB_ORIGIN ??
    'https://r.bhd-om.com'
  ).replace(/\/$/, '');
}

export async function createStayPaymentSessionOnNeon(
  input: CreateStayPaymentSessionInput,
  _idempotencyKey: string,
) {
  assertSandboxEnabled();

  return asSystem(async (transaction) => {
    const intent = await transaction.query.stayPaymentIntents.findFirst({
      where: eq(stayPaymentIntents.id, input.paymentIntentId),
    });
    if (!intent) {
      throw new PublicStayBookingError('intent_not_found', 'Stay payment intent not found', 404);
    }

    const staysGate = resolveStaysEnabledFromEnv({
      organizationId: intent.organizationId,
      propertyEnabled: true,
      unitEnabled: true,
    });
    if (!staysGate.enabled) {
      throw new PublicStayBookingError('not_found', 'Stay listing not found', 404);
    }

    const booking = await transaction.query.stayBookings.findFirst({
      where: and(
        eq(stayBookings.id, intent.bookingId),
        eq(stayBookings.organizationId, intent.organizationId),
      ),
    });
    if (!booking) {
      throw new PublicStayBookingError('booking_missing', 'Stay booking not found', 404);
    }
    if (booking.status !== 'payment_pending') {
      throw new PublicStayBookingError(
        'booking_not_payable',
        `Stay booking cannot start payment in status ${booking.status}`,
        409,
      );
    }
    if (intent.status === 'succeeded') {
      throw new PublicStayBookingError('already_paid', 'Stay payment intent is already paid', 409);
    }
    if (intent.status !== 'pending') {
      throw new PublicStayBookingError(
        'intent_not_payable',
        `Stay payment intent status ${intent.status} is not payable`,
        409,
      );
    }

    const locale = input.locale === 'en' ? 'en' : 'ar';
    const origin = publicWebOrigin();
    let sessionReference = intent.providerIntentId;
    if (
      intent.provider === 'sandbox' &&
      sessionReference &&
      /^[A-Za-z0-9_-]{24,80}$/.test(sessionReference)
    ) {
      const redirectUrl = `${origin}/${locale}/payments/sandbox/${sessionReference}?kind=stay&return=${encodeURIComponent(input.returnPath)}`;
      return {
        sessionReference,
        redirectUrl,
        paymentIntentId: intent.id,
        amountMinor: intent.amountMinor.toString(),
        currency: intent.currency,
        duplicate: true as const,
      };
    }

    sessionReference = randomBytes(24).toString('base64url');
    await transaction
      .update(stayPaymentIntents)
      .set({
        provider: 'sandbox',
        providerIntentId: sessionReference,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stayPaymentIntents.id, intent.id),
          eq(stayPaymentIntents.organizationId, intent.organizationId),
          eq(stayPaymentIntents.status, 'pending'),
        ),
      );

    const redirectUrl = `${origin}/${locale}/payments/sandbox/${sessionReference}?kind=stay&return=${encodeURIComponent(input.returnPath)}`;
    return {
      sessionReference,
      redirectUrl,
      paymentIntentId: intent.id,
      amountMinor: intent.amountMinor.toString(),
      currency: intent.currency,
      duplicate: false as const,
    };
  });
}

export async function completeStaySandboxPaymentOnNeon(
  sessionReference: string,
  returnPath?: string | null,
) {
  assertSandboxEnabled();
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(sessionReference)) {
    throw new PublicStayBookingError('invalid_reference', 'Invalid payment session reference', 400);
  }

  return asSystem(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${sessionReference}, 23))`,
    );

    const intent = await transaction.query.stayPaymentIntents.findFirst({
      where: and(
        eq(stayPaymentIntents.providerIntentId, sessionReference),
        eq(stayPaymentIntents.provider, 'sandbox'),
      ),
    });
    if (!intent) {
      throw new PublicStayBookingError('session_not_found', 'Payment session not found', 404);
    }

    if (intent.status === 'succeeded') {
      return {
        completed: true,
        duplicate: true,
        kind: 'stay_booking' as const,
        paymentIntentId: intent.id,
        returnPath: returnPath ?? null,
      };
    }

    const booking = await transaction.query.stayBookings.findFirst({
      where: and(
        eq(stayBookings.id, intent.bookingId),
        eq(stayBookings.organizationId, intent.organizationId),
      ),
    });
    if (!booking) {
      throw new PublicStayBookingError('booking_missing', 'Stay booking not found', 404);
    }
    if (booking.status !== 'payment_pending') {
      throw new PublicStayBookingError(
        'booking_not_payable',
        `Stay booking cannot accept payment in status ${booking.status}`,
        409,
      );
    }

    const transition = assertStayBookingTransition(booking.status, 'confirmed');
    if (!transition.ok) {
      throw new PublicStayBookingError(
        'illegal_transition',
        transition.reason ?? 'Illegal stay booking transition',
        409,
      );
    }

    const now = new Date();
    const providerReference = `sandbox:${sessionReference}`;

    await transaction
      .update(stayPaymentIntents)
      .set({
        status: 'succeeded',
        provider: 'sandbox',
        providerIntentId: sessionReference,
        providerEventId: `sandbox-stay:${sessionReference}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(stayPaymentIntents.id, intent.id),
          eq(stayPaymentIntents.organizationId, intent.organizationId),
        ),
      );

    await transaction
      .update(stayInventoryLocks)
      .set({
        kind: 'booking',
        expiresAt: null,
        sourceType: 'stay_booking',
        sourceId: booking.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(stayInventoryLocks.id, booking.inventoryLockId),
          eq(stayInventoryLocks.organizationId, intent.organizationId),
          eq(stayInventoryLocks.status, 'active'),
        ),
      );

    if (booking.holdId) {
      await transaction
        .update(stayHolds)
        .set({ status: 'converted', updatedAt: now })
        .where(
          and(
            eq(stayHolds.id, booking.holdId),
            eq(stayHolds.organizationId, intent.organizationId),
          ),
        );
    }

    await transaction
      .update(stayBookings)
      .set({ status: 'confirmed', updatedAt: now })
      .where(
        and(
          eq(stayBookings.id, booking.id),
          eq(stayBookings.organizationId, intent.organizationId),
        ),
      );

    await transaction.insert(stayBookingStatusHistory).values({
      organizationId: intent.organizationId,
      bookingId: booking.id,
      fromStatus: 'payment_pending',
      toStatus: 'confirmed',
      reason: `Sandbox payment ${providerReference}`,
      metadataJson: { paymentIntentId: intent.id },
    });

    await transaction.insert(workflowEvents).values({
      organizationId: intent.organizationId,
      actorUserId: null,
      resourceType: 'stay_booking',
      resourceId: booking.id,
      eventType: 'stay_booking.payment_confirmed',
      fromStatus: 'payment_pending',
      toStatus: 'confirmed',
    });

    await transaction.insert(outboxEvents).values({
      organizationId: intent.organizationId,
      topic: 'stay.booking.confirmed',
      aggregateType: 'stay_booking',
      aggregateId: booking.id,
      payload: {
        paymentIntentId: intent.id,
        referenceCode: booking.referenceCode,
        provider: 'sandbox',
      },
    });

    return {
      completed: true,
      duplicate: false,
      kind: 'stay_booking' as const,
      paymentIntentId: intent.id,
      returnPath: returnPath ?? null,
    };
  });
}
