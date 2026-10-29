import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  properties,
  stayBookings,
  stayBookingStatusHistory,
  stayPaymentIntents,
  stayProfiles,
  users,
  workflowEvents,
  type Database,
} from '@bhd-r/db';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import { publicWebOrigin } from '@/lib/seo';
import {
  readDepositWaived,
  stayDepositIdempotencyKey,
  type StayDepositGate,
} from '@/lib/stay-deposit-gate';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function fail(code: string): never {
  throw new Error(code);
}

export async function loadStayDepositGate(
  tx: Pick<Tx, 'select'>,
  organizationId: string,
  bookingId: string,
): Promise<StayDepositGate> {
  const [row] = await tx
    .select({
      currency: stayBookings.currency,
      pricingSnapshotJson: stayBookings.pricingSnapshotJson,
      depositMinor: stayProfiles.depositMinor,
    })
    .from(stayBookings)
    .leftJoin(stayProfiles, eq(stayProfiles.id, stayBookings.stayProfileId))
    .where(and(eq(stayBookings.organizationId, organizationId), eq(stayBookings.id, bookingId)))
    .limit(1);
  if (!row) {
    return { required: false, status: 'none', amountMinor: null, currency: 'OMR' };
  }
  const amount = row.depositMinor && row.depositMinor > 0n ? row.depositMinor.toString() : null;
  if (!amount) {
    return { required: false, status: 'none', amountMinor: null, currency: row.currency };
  }
  if (readDepositWaived(row.pricingSnapshotJson)) {
    return { required: true, status: 'waived', amountMinor: amount, currency: row.currency };
  }
  const key = stayDepositIdempotencyKey(bookingId);
  const [intent] = await tx
    .select({ status: stayPaymentIntents.status })
    .from(stayPaymentIntents)
    .where(
      and(
        eq(stayPaymentIntents.organizationId, organizationId),
        eq(stayPaymentIntents.idempotencyKey, key),
      ),
    )
    .limit(1);
  if (intent?.status === 'succeeded') {
    return { required: true, status: 'paid', amountMinor: amount, currency: row.currency };
  }
  return { required: true, status: 'unpaid', amountMinor: amount, currency: row.currency };
}

/** Create or reuse a sandbox session for the stay security deposit. */
export async function ensureStayDepositPaymentInTx(
  transaction: Tx,
  booking: {
    id: string;
    organizationId: string;
    referenceCode: string;
    currency: string;
  },
  amountMinor: string,
  locale: 'ar' | 'en' = 'ar',
): Promise<{ redirectUrl: string; paymentIntentId: string }> {
  const now = new Date();
  const idempotencyKey = stayDepositIdempotencyKey(booking.id);
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
        amountMinor: BigInt(amountMinor),
        currency: booking.currency,
        idempotencyKey,
        provider: 'sandbox',
      })
      .returning({ id: stayPaymentIntents.id });
    intentId = created?.id;
  } else if (existing.status === 'succeeded') {
    fail('deposit_already_paid');
  } else if (existing.amountMinor.toString() !== amountMinor) {
    await transaction
      .update(stayPaymentIntents)
      .set({ amountMinor: BigInt(amountMinor), updatedAt: now })
      .where(eq(stayPaymentIntents.id, existing.id));
  }

  if (!intentId) fail('deposit_payment_failed');

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
  };
}

/** Owner waives the security deposit so the guest barcode can open without payment. */
export async function waiveStayDepositOnNeon(
  claims: SessionClaims,
  bookingId: string,
  propertyId?: string | null,
): Promise<StayDepositGate> {
  if (!hasPermission(claims, 'stay.booking.manage')) fail('forbidden');
  const orgId = claims.organizationId ?? fail('organization_required');
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) fail('invalid_body');
  const ownerPartyId = ownerPartyScope(claims);

  return withinViewerTenant(claims, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${bookingId}, 37))`);
    const [booking] = await tx
      .select({
        id: stayBookings.id,
        status: stayBookings.status,
        referenceCode: stayBookings.referenceCode,
        propertyId: stayBookings.propertyId,
        currency: stayBookings.currency,
        pricingSnapshotJson: stayBookings.pricingSnapshotJson,
        depositMinor: stayProfiles.depositMinor,
      })
      .from(stayBookings)
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .leftJoin(stayProfiles, eq(stayProfiles.id, stayBookings.stayProfileId))
      .where(
        and(
          eq(stayBookings.id, bookingId),
          eq(stayBookings.organizationId, orgId),
          ...(propertyId ? [eq(stayBookings.propertyId, propertyId)] : []),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(1);
    if (!booking) fail('booking_not_found');

    const gate = await loadStayDepositGate(tx, orgId, bookingId);
    if (!gate.required || gate.status === 'paid' || gate.status === 'waived') return gate;

    const now = new Date();
    const [actor] = await tx
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    const snapshot =
      booking.pricingSnapshotJson && typeof booking.pricingSnapshotJson === 'object'
        ? { ...(booking.pricingSnapshotJson) }
        : {};
    const waive = {
      at: now.toISOString(),
      byUserId: claims.sub,
      byName: actor?.displayName ?? null,
    };
    await tx
      .update(stayBookings)
      .set({
        pricingSnapshotJson: { ...snapshot, depositWaived: waive },
        updatedAt: now,
      })
      .where(and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, orgId)));
    await tx.insert(stayBookingStatusHistory).values({
      organizationId: orgId,
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: booking.status,
      actorUserId: claims.sub,
      reason: 'deposit_waived',
      metadataJson: {
        ...waive,
        depositMinor: gate.amountMinor,
        currency: booking.currency,
      },
    });
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'stay_booking',
      resourceId: booking.id,
      eventType: 'stay.deposit_waived',
      fromStatus: booking.status,
      toStatus: booking.status,
      metadata: {
        referenceCode: booking.referenceCode,
        depositMinor: gate.amountMinor,
        currency: booking.currency,
      },
    });
    return {
      required: true,
      status: 'waived' as const,
      amountMinor: gate.amountMinor,
      currency: booking.currency,
    };
  });
}
