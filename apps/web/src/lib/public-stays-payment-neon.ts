import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
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
  stayBookingGuests,
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
  paymentMask?: {
    cardLast4?: string;
    cardBrand?: string;
    cardholderName?: string;
  },
) {
  assertSandboxEnabled();
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(sessionReference)) {
    throw new PublicStayBookingError('invalid_reference', 'Invalid payment session reference', 400);
  }

  const safeMask = {
    ...(paymentMask?.cardLast4 && /^\d{4}$/.test(paymentMask.cardLast4)
      ? { cardLast4: paymentMask.cardLast4 }
      : {}),
    ...(paymentMask?.cardBrand &&
    ['visa', 'mastercard', 'amex', 'other'].includes(paymentMask.cardBrand)
      ? { cardBrand: paymentMask.cardBrand }
      : {}),
    ...(paymentMask?.cardholderName &&
    paymentMask.cardholderName.trim().length >= 2 &&
    paymentMask.cardholderName.trim().length <= 80
      ? { cardholderName: paymentMask.cardholderName.trim().slice(0, 80) }
      : {}),
  };

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
      metadataJson: {
        paymentIntentId: intent.id,
        provider: 'sandbox',
        ...safeMask,
      },
    });

    await transaction.insert(workflowEvents).values({
      organizationId: intent.organizationId,
      actorUserId: null,
      resourceType: 'stay_booking',
      resourceId: booking.id,
      eventType: 'stay_booking.payment_confirmed',
      fromStatus: 'payment_pending',
      toStatus: 'confirmed',
      metadata: {
        paymentIntentId: intent.id,
        provider: 'sandbox',
        ...safeMask,
      },
    });

    await transaction.insert(outboxEvents).values({
      organizationId: intent.organizationId,
      topic: 'stay_booking.payment_confirmed',
      aggregateType: 'stay_booking',
      aggregateId: booking.id,
      payload: {
        paymentIntentId: intent.id,
        referenceCode: booking.referenceCode,
        unitId: booking.unitId,
        provider: 'sandbox',
        ...safeMask,
      },
    });

    // Mark booked nights immediately so public/owner calendars update without waiting on the worker.
    await transaction.execute(sql`
      WITH days AS (
        SELECT generate_series(
          ${booking.checkInOn}::date,
          (${booking.checkOutOn}::date - 1),
          '1 day'::interval
        )::date AS stay_date
      )
      INSERT INTO stay_inventory_days (
        organization_id, unit_id, stay_date, availability_status,
        effective_rate_minor, currency, min_nights, public_note, manual_rate
      )
      SELECT
        ${intent.organizationId}::uuid,
        ${booking.unitId}::uuid,
        d.stay_date,
        'booked',
        NULL,
        ${booking.currency},
        NULL,
        NULL,
        false
      FROM days d
      ON CONFLICT (unit_id, stay_date) DO UPDATE SET
        availability_status = 'booked',
        updated_at = now()
    `);

    await transaction.execute(sql`
      WITH profile AS (
        SELECT sp.currency,
               sp.min_nights,
               LEAST(GREATEST(COALESCE(sp.advance_booking_days, 365), 1), 730) AS advance,
               (
                 SELECT srp.base_nightly_minor::text
                 FROM stay_rate_plans srp
                 WHERE srp.stay_profile_id = sp.id
                   AND srp.enabled = true
                 ORDER BY srp.priority ASC, srp.created_at ASC
                 LIMIT 1
               ) AS base_nightly_minor
        FROM stay_profiles sp
        WHERE sp.organization_id = ${intent.organizationId}::uuid
          AND sp.unit_id = ${booking.unitId}::uuid
        LIMIT 1
      ),
      days AS (
        SELECT generate_series(
          CURRENT_DATE,
          CURRENT_DATE + ((SELECT advance FROM profile) - 1),
          '1 day'::interval
        )::date AS stay_date
      ),
      day_status AS (
        SELECT
          d.stay_date,
          CASE
            WHEN bool_or(l.kind = 'booking') THEN 'booked'
            WHEN bool_or(l.kind = 'hold') THEN 'hold'
            WHEN bool_or(l.kind = 'maintenance') THEN 'maintenance'
            WHEN bool_or(l.kind = 'lease') THEN 'lease'
            WHEN bool_or(l.kind IN ('owner_block', 'channel')) THEN 'blocked'
            ELSE 'available'
          END AS availability_status
        FROM days d
        LEFT JOIN stay_inventory_locks l
          ON l.unit_id = ${booking.unitId}::uuid
         AND l.organization_id = ${intent.organizationId}::uuid
         AND l.status = 'active'
         AND d.stay_date >= lower(l.stay_range)
         AND d.stay_date < upper(l.stay_range)
        GROUP BY d.stay_date
      )
      INSERT INTO stay_inventory_days (
        organization_id, unit_id, stay_date, availability_status,
        effective_rate_minor, currency, min_nights, public_note, manual_rate
      )
      SELECT
        ${intent.organizationId}::uuid,
        ${booking.unitId}::uuid,
        ds.stay_date,
        ds.availability_status,
        CASE
          WHEN (SELECT base_nightly_minor FROM profile) IS NULL THEN NULL
          ELSE ((SELECT base_nightly_minor FROM profile)::bigint)
        END,
        (SELECT currency FROM profile),
        (SELECT min_nights FROM profile),
        NULL,
        false
      FROM day_status ds
      ON CONFLICT (unit_id, stay_date) DO UPDATE SET
        availability_status = EXCLUDED.availability_status,
        effective_rate_minor = CASE
          WHEN stay_inventory_days.manual_rate THEN stay_inventory_days.effective_rate_minor
          ELSE EXCLUDED.effective_rate_minor
        END,
        currency = COALESCE(stay_inventory_days.currency, EXCLUDED.currency),
        min_nights = EXCLUDED.min_nights,
        updated_at = now()
    `);

    const snapshot =
      booking.pricingSnapshotJson && typeof booking.pricingSnapshotJson === 'object'
        ? (booking.pricingSnapshotJson as Record<string, unknown>)
        : {};
    const guestContact =
      snapshot.guestContact && typeof snapshot.guestContact === 'object'
        ? (snapshot.guestContact as Record<string, unknown>)
        : {};
    const guestEmail =
      typeof guestContact.email === 'string' && guestContact.email.includes('@')
        ? guestContact.email.trim().toLowerCase()
        : null;
    const guestName =
      typeof guestContact.displayName === 'string' && guestContact.displayName.trim()
        ? guestContact.displayName.trim()
        : ((
            await transaction.query.stayBookingGuests.findFirst({
              where: and(
                eq(stayBookingGuests.bookingId, booking.id),
                eq(stayBookingGuests.isPrimary, true),
              ),
              columns: { displayName: true },
            })
          )?.displayName ?? null);

    if (guestEmail) {
      const origin = publicWebOrigin();
      const receiptPath = `/ar/stays/booking/receipt?ref=${encodeURIComponent(booking.referenceCode)}`;
      const receiptUrl = `${origin}${receiptPath}`;
      const confirmedPath = `/ar/stays/booking/confirmed?ref=${encodeURIComponent(booking.referenceCode)}`;
      const amountLabel = `${booking.totalMinor.toString()} ${booking.currency}`;
      const subject = `تأكيد حجز BHD — ${booking.referenceCode}`;
      const text = [
        guestName ? `مرحباً ${guestName},` : 'مرحباً،',
        '',
        `تم تأكيد حجزك ${booking.referenceCode}.`,
        `الوصول: ${booking.checkInOn}`,
        `المغادرة: ${booking.checkOutOn}`,
        `المبلغ: ${amountLabel}`,
        '',
        `إيصال الدفع (PDF / طباعة): ${receiptUrl}`,
        `صفحة التأكيد: ${origin}${confirmedPath}`,
        '',
        'BHD R — A BHD Product',
      ].join('\n');
      const html = `
        <p>${guestName ? `مرحباً <strong>${guestName}</strong>,` : 'مرحباً،'}</p>
        <p>تم تأكيد حجزك <strong dir="ltr">${booking.referenceCode}</strong>.</p>
        <ul>
          <li>الوصول: <span dir="ltr">${booking.checkInOn}</span></li>
          <li>المغادرة: <span dir="ltr">${booking.checkOutOn}</span></li>
          <li>المبلغ: <span dir="ltr">${amountLabel}</span></li>
        </ul>
        <p><a href="${receiptUrl}">فتح إيصال الدفع (حفظ كـ PDF)</a></p>
        <p><a href="${origin}${confirmedPath}">صفحة تأكيد الحجز</a></p>
        <p>BHD R — A BHD Product</p>
      `;
      await transaction.insert(outboxEvents).values({
        organizationId: intent.organizationId,
        topic: 'notification.delivery.requested',
        aggregateType: 'stay_booking',
        aggregateId: booking.id,
        payload: {
          correlationId: randomUUID(),
          organizationId: intent.organizationId,
          notificationId: randomUUID(),
          channel: 'email',
          recipient: guestEmail,
          subject,
          text,
          html,
        },
      });
    }

    return {
      completed: true,
      duplicate: false,
      kind: 'stay_booking' as const,
      paymentIntentId: intent.id,
      returnPath: returnPath ?? null,
      referenceCode: booking.referenceCode,
      receiptPath: `/stays/booking/receipt?ref=${encodeURIComponent(booking.referenceCode)}`,
      emailQueued: Boolean(guestEmail),
    };
  });
}

export type StaySandboxSessionSummary = {
  sessionReference: string;
  paymentIntentId: string;
  amountMinor: string;
  currency: string;
  status: string;
  referenceCode: string;
  checkInOn: string;
  checkOutOn: string;
  guestDisplayName: string | null;
};

/** Public-safe summary for the sandbox checkout UI (no PAN/secrets). */
export async function lookupStaySandboxSessionOnNeon(
  sessionReference: string,
): Promise<StaySandboxSessionSummary | null> {
  if (!isPaymentSandboxPilotEnabled()) return null;
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(sessionReference)) return null;

  return asSystem(async (transaction) => {
    const intent = await transaction.query.stayPaymentIntents.findFirst({
      where: and(
        eq(stayPaymentIntents.providerIntentId, sessionReference),
        eq(stayPaymentIntents.provider, 'sandbox'),
      ),
    });
    if (!intent) return null;

    const booking = await transaction.query.stayBookings.findFirst({
      where: and(
        eq(stayBookings.id, intent.bookingId),
        eq(stayBookings.organizationId, intent.organizationId),
      ),
      columns: {
        referenceCode: true,
        checkInOn: true,
        checkOutOn: true,
        pricingSnapshotJson: true,
      },
    });
    if (!booking) return null;

    const primaryGuest = await transaction.query.stayBookingGuests.findFirst({
      where: and(
        eq(stayBookingGuests.bookingId, intent.bookingId),
        eq(stayBookingGuests.isPrimary, true),
      ),
      columns: { displayName: true },
    });
    const snapshot =
      booking.pricingSnapshotJson && typeof booking.pricingSnapshotJson === 'object'
        ? (booking.pricingSnapshotJson as Record<string, unknown>)
        : {};
    const contact =
      snapshot.guestContact && typeof snapshot.guestContact === 'object'
        ? (snapshot.guestContact as Record<string, unknown>)
        : {};
    const guestDisplayName =
      primaryGuest?.displayName?.trim() ||
      (typeof contact.displayName === 'string' ? contact.displayName.trim() : '') ||
      null;

    return {
      sessionReference,
      paymentIntentId: intent.id,
      amountMinor: intent.amountMinor.toString(),
      currency: intent.currency,
      status: intent.status,
      referenceCode: booking.referenceCode,
      checkInOn: booking.checkInOn,
      checkOutOn: booking.checkOutOn,
      guestDisplayName,
    };
  });
}
