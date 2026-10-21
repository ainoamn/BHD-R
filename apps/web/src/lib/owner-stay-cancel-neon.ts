import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  outboxEvents,
  properties,
  stayBookingStatusHistory,
  stayBookings,
  stayHolds,
  stayInventoryLocks,
  stayPaymentIntents,
  stayRefunds,
  workflowEvents,
  type Database,
} from '@bhd-r/db';
import { assertStayBookingTransition } from '@bhd-r/domain';
import { appLink, notifyInTx } from '@/lib/email-notify';
import { formatMoney } from '@/lib/format';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';
import { REFUND_NOTE_MAX } from '@/lib/stay-deposit-refund';
import {
  bookingCancelRefundKey,
  lockBooking,
  recordDepositEvent,
} from '@/lib/stay-deposit-refund-neon';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const CANCELABLE = new Set([
  'request_pending',
  'payment_pending',
  'payment_failed',
  'confirmed',
  'pre_arrival',
]);

export type OwnerStayCancelInput = {
  note: string;
  /** Required when a succeeded payment exists. */
  refundDecision?: 'refund' | 'keep' | null | undefined;
  /** When set, the booking must belong to this property (property hub reject). */
  propertyId?: string | null | undefined;
  /** When set, cancel only if the booking is currently in one of these statuses. */
  onlyStatuses?: readonly string[] | undefined;
};

function fail(code: string): never {
  throw new Error(code);
}

function cleanNote(value: string): string {
  const note = value.trim().slice(0, REFUND_NOTE_MAX);
  if (note.length < 3) fail('cancel_note_required');
  return note;
}

function snapshotObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arDate(value: string): string {
  try {
    return new Intl.DateTimeFormat('ar-OM', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${value.slice(0, 10)}T12:00:00+04:00`));
  } catch {
    return value.slice(0, 10);
  }
}

/**
 * Owner/ops cancel or reject a stay booking: reason note required; when the guest already
 * paid, choose refund vs keep. Refund creates an approved `booking_cancel:` stay_refund for
 * the accountant. Inventory lock and hold are released immediately.
 */
export async function cancelOwnerStayBookingOnNeon(
  claims: SessionClaims,
  bookingId: string,
  input: OwnerStayCancelInput,
): Promise<{ id: string; status: string; refundCreated: boolean }> {
  if (!hasPermission(claims, 'stay.booking.manage')) fail('forbidden');
  const note = cleanNote(input.note);

  return withinViewerTenant(claims, async (tx) => {
    const orgId = claims.organizationId ?? fail('organization_required');
    await lockBooking(tx, bookingId);
    const ownerPartyId = ownerPartyScope(claims);

    const [booking] = await tx
      .select({
        id: stayBookings.id,
        organizationId: stayBookings.organizationId,
        status: stayBookings.status,
        referenceCode: stayBookings.referenceCode,
        currency: stayBookings.currency,
        totalMinor: stayBookings.totalMinor,
        propertyId: stayBookings.propertyId,
        unitId: stayBookings.unitId,
        guestPartyId: stayBookings.guestPartyId,
        inventoryLockId: stayBookings.inventoryLockId,
        holdId: stayBookings.holdId,
        stayProfileId: stayBookings.stayProfileId,
        checkInOn: stayBookings.checkInOn,
        checkOutOn: stayBookings.checkOutOn,
        snapshot: stayBookings.pricingSnapshotJson,
        propertyNameAr: properties.nameAr,
        ownerPartyId: properties.ownerPartyId,
      })
      .from(stayBookings)
      .innerJoin(properties, eq(properties.id, stayBookings.propertyId))
      .where(
        and(
          eq(stayBookings.id, bookingId),
          eq(stayBookings.organizationId, orgId),
          ...(input.propertyId ? [eq(stayBookings.propertyId, input.propertyId)] : []),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(1);
    if (!booking) fail('booking_not_found');
    if (booking.status === 'cancelled') {
      return { id: booking.id, status: 'cancelled', refundCreated: false };
    }
    if (input.onlyStatuses && !input.onlyStatuses.includes(booking.status)) {
      fail('booking_not_approvable');
    }
    if (!CANCELABLE.has(booking.status)) fail('booking_not_cancelable');

    const transition = assertStayBookingTransition(booking.status, 'cancelled');
    if (!transition.ok) fail('illegal_transition');

    const [paidIntent] = await tx
      .select({
        id: stayPaymentIntents.id,
        amountMinor: stayPaymentIntents.amountMinor,
        currency: stayPaymentIntents.currency,
      })
      .from(stayPaymentIntents)
      .where(
        and(
          eq(stayPaymentIntents.bookingId, booking.id),
          eq(stayPaymentIntents.organizationId, orgId),
          eq(stayPaymentIntents.status, 'succeeded'),
        ),
      )
      .orderBy(sql`${stayPaymentIntents.updatedAt} desc`)
      .limit(1);

    const intentPaid =
      paidIntent?.amountMinor && paidIntent.amountMinor > 0n ? paidIntent.amountMinor : 0n;
    // Confirmed stays without a card intent (offline / desk) still have a booking total to decide on.
    const paidAmount =
      intentPaid > 0n
        ? intentPaid
        : (booking.status === 'confirmed' || booking.status === 'pre_arrival') &&
            booking.totalMinor > 0n
          ? booking.totalMinor
          : 0n;
    const paid = paidAmount > 0n;
    const refundDecision = paid
      ? input.refundDecision === 'refund' || input.refundDecision === 'keep'
        ? input.refundDecision
        : fail('refund_decision_required')
      : null;

    const now = new Date();
    const fromRequest = booking.status === 'request_pending';
    const reason = fromRequest ? 'owner_rejected' : 'ops_cancel';

    await tx
      .update(stayBookings)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, orgId)));

    if (booking.inventoryLockId) {
      await tx
        .update(stayInventoryLocks)
        .set({ status: 'released', updatedAt: now, note: reason })
        .where(
          and(
            eq(stayInventoryLocks.id, booking.inventoryLockId),
            eq(stayInventoryLocks.organizationId, orgId),
            eq(stayInventoryLocks.status, 'active'),
          ),
        );
    }

    // Clear projected booked days so the public calendar and catalogue reopen immediately.
    await tx.execute(sql`
      UPDATE stay_inventory_days d
      SET availability_status = 'available', updated_at = ${now.toISOString()}
      WHERE d.organization_id = ${orgId}::uuid
        AND d.unit_id = ${booking.unitId}::uuid
        AND d.availability_status IN ('booked', 'hold')
        AND d.stay_date >= ${booking.checkInOn}::date
        AND d.stay_date < GREATEST(${booking.checkOutOn}::date, ${booking.checkInOn}::date + 1)
        AND NOT EXISTS (
          SELECT 1 FROM stay_inventory_locks l
          WHERE l.organization_id = d.organization_id
            AND l.unit_id = d.unit_id
            AND l.status = 'active'
            AND (l.expires_at IS NULL OR l.expires_at > now())
            AND l.stay_range @> d.stay_date
        )
        AND NOT EXISTS (
          SELECT 1 FROM stay_bookings b
          WHERE b.organization_id = d.organization_id
            AND b.unit_id = d.unit_id
            AND b.id <> ${booking.id}::uuid
            AND b.status IN (
              'request_pending', 'payment_pending', 'confirmed', 'paid',
              'pre_arrival', 'checked_in'
            )
            AND daterange(
              b.check_in_on,
              GREATEST(b.check_out_on, b.check_in_on + 1),
              '[)'
            ) @> d.stay_date
        )
    `);

    if (booking.holdId) {
      await tx
        .update(stayHolds)
        .set({ status: 'cancelled', updatedAt: now })
        .where(
          and(
            eq(stayHolds.id, booking.holdId),
            eq(stayHolds.organizationId, orgId),
            eq(stayHolds.status, 'active'),
          ),
        );
    }

    await tx
      .update(stayPaymentIntents)
      .set({ status: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(stayPaymentIntents.bookingId, booking.id),
          eq(stayPaymentIntents.organizationId, orgId),
          eq(stayPaymentIntents.status, 'pending'),
        ),
      );

    let refundId: string | null = null;
    if (paid && refundDecision === 'refund' && paidIntent) {
      const [created] = await tx
        .insert(stayRefunds)
        .values({
          organizationId: orgId,
          bookingId: booking.id,
          paymentIntentId: paidIntent.id,
          status: 'approved',
          amountMinor: paidAmount,
          currency: paidIntent.currency || booking.currency,
          reason: note,
          requestedByUserId: claims.sub,
          approvedByUserId: claims.sub,
          approvedAt: now,
          idempotencyKey: bookingCancelRefundKey(booking.id),
        })
        .returning({ id: stayRefunds.id });
      refundId = created?.id ?? null;
      if (refundId) {
        await recordDepositEvent(
          tx,
          {
            id: booking.id,
            organizationId: orgId,
            status: 'cancelled',
            referenceCode: booking.referenceCode,
            currency: booking.currency,
            stayProfileId: booking.stayProfileId,
            propertyId: booking.propertyId,
            unitId: booking.unitId,
            guestPartyId: booking.guestPartyId,
          },
          {
            event: 'approved',
            actorUserId: claims.sub,
            metadata: {
              refundId,
              note,
              amountMinor: paidAmount.toString(),
              depositMinor: paidAmount.toString(),
              kind: 'booking_cancel',
              decidedBy: 'host',
            },
            audit: {
              amountMinor: paidAmount.toString(),
              kind: 'booking_cancel',
            },
          },
        );
      }
    }

    await tx.insert(stayBookingStatusHistory).values({
      organizationId: orgId,
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: 'cancelled',
      actorUserId: claims.sub,
      reason,
      metadataJson: {
        note,
        refundDecision,
        paidAmountMinor: paid ? paidAmount.toString() : null,
        currency: booking.currency,
        refundId,
        ownerCancel: true,
        fromRequest,
      },
    });

    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'stay_booking',
      resourceId: booking.id,
      eventType: 'stay.cancelled',
      fromStatus: booking.status,
      toStatus: 'cancelled',
      metadata: {
        referenceCode: booking.referenceCode,
        reason,
        refundDecision,
        note,
      },
    });

    await tx.insert(outboxEvents).values({
      organizationId: orgId,
      topic: 'stay.cancelled',
      aggregateType: 'stay_booking',
      aggregateId: booking.id,
      payload: {
        unitId: booking.unitId,
        checkInOn: booking.checkInOn,
        checkOutOn: booking.checkOutOn,
        reason,
        refundDecision,
      },
    });

    const contact = snapshotObject(snapshotObject(booking.snapshot).guestContact);
    const money =
      paid && paidAmount > 0n
        ? formatMoney(paidAmount.toString(), paidIntent?.currency || booking.currency, 'ar')
        : null;
    const refundLine =
      !paid || !money
        ? null
        : refundDecision === 'refund'
          ? `سيُعاد مبلغ الحجز (${money}) بعد معالجة المحاسب.`
          : `لن يُسترد مبلغ الحجز (${money}). السبب: ${note}`;

    await notifyInTx(tx, {
      orgId,
      aggregateType: 'stay_booking',
      aggregateId: booking.id,
      audience: booking.guestPartyId
        ? { parties: [booking.guestPartyId] }
        : {
            addresses: [
              {
                email: typeof contact.email === 'string' ? contact.email : null,
                name: typeof contact.displayName === 'string' ? contact.displayName : null,
              },
            ],
          },
      content: () => ({
        tone: 'booking',
        subject: fromRequest
          ? `عن طلب حجزك ${booking.referenceCode} في ${booking.propertyNameAr}`
          : `إلغاء حجزك ${booking.referenceCode} في ${booking.propertyNameAr}`,
        title: fromRequest
          ? 'للأسف، التواريخ لم تناسب المضيف هذه المرة'
          : 'تم إلغاء حجزك',
        intro: fromRequest
          ? `اعتذر المضيف عن قبول طلب حجزك في ${booking.propertyNameAr}.`
          : `أُلغي حجزك في ${booking.propertyNameAr}.`,
        details: [
          { label: 'رقم الحجز', value: booking.referenceCode },
          { label: 'تاريخ الوصول', value: arDate(booking.checkInOn) },
          { label: 'تاريخ المغادرة', value: arDate(booking.checkOutOn) },
          { label: 'ملاحظة المضيف', value: note },
          ...(refundLine ? [{ label: 'المبلغ', value: refundLine }] : []),
        ],
        lines: [
          fromRequest
            ? 'لا تحزن، فالمكان المثالي ما زال ينتظرك؛ لدينا خيارات كثيرة أخرى تستحق نظرة.'
            : 'يسعدنا أن نستضيفك في وقت يناسبك — تصفّح الإقامات المتاحة.',
        ],
        cta: { label: 'تصفّح أماكن أخرى', url: appLink('/ar/stays') },
      }),
    });

    if (refundId) {
      await notifyInTx(tx, {
        orgId,
        aggregateType: 'stay_booking',
        aggregateId: booking.id,
        audience: {
          managersOf: { orgId, propertyId: booking.propertyId },
          rolesOf: { orgId, roles: ['finance_manager'] },
        },
        content: () => ({
          tone: 'booking',
          subject: `طلب إرجاع مبلغ حجز ${booking.referenceCode}`,
          title: 'طلب إرجاع مبلغ حجز ملغى',
          intro: `أُلغي الحجز ${booking.referenceCode} ويحتاج المحاسب إلى إرجاع المبلغ المدفوع للضيف.`,
          details: [
            { label: 'العقار', value: booking.propertyNameAr },
            { label: 'المبلغ', value: money ?? paidAmount.toString() },
            { label: 'سبب الإلغاء', value: note },
          ],
          lines: ['افتح صفحة الحسابات ← أمانات التأمين لتسجيل التحويل.'],
          cta: {
            label: 'فتح الحسابات',
            url: appLink(
              `/ar/owner/accounting?focus=${encodeURIComponent(booking.id)}#deposits`,
            ),
          },
        }),
      });
    }

    return {
      id: booking.id,
      status: 'cancelled',
      refundCreated: Boolean(refundId),
    };
  });
}
