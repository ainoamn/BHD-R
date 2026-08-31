import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { outboxEvents, stayBookingStatusHistory, stayBookings, workflowEvents } from '@bhd-r/db';
import {
  assertStayBookingTransition,
  type StayBookingStatus,
} from '@bhd-r/domain';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService } from '../database/database.service.js';

/**
 * Phase 5+ — quote → hold → pay → confirm → stay → checkout.
 * Payment webhook kind `stay_booking` is handled in FinanceService.ingestWebhook.
 */
@Injectable()
export class StaysBookingService {
  private readonly logger = new Logger(StaysBookingService.name);

  constructor(private readonly database: DatabaseService) {}

  assertTransition(from: StayBookingStatus, to: StayBookingStatus): void {
    const result = assertStayBookingTransition(from, to);
    if (!result.ok) {
      throw new Error(result.reason ?? 'illegal_stay_transition');
    }
  }

  describePaymentHook(): { kind: 'stay_booking'; note: string } {
    return {
      kind: 'stay_booking',
      note: 'POST /v1/webhooks/payments/:provider with kind stay_booking + paymentIntentId; amount/currency match; unique x-event-id.',
    };
  }

  /**
   * Ops checkout: checked_in → checked_out, emits stay.checked_out for housekeeping projector.
   */
  async checkOut(claims: SessionClaims, bookingId: string) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const booking = await transaction.query.stayBookings.findFirst({
        where: and(
          eq(stayBookings.id, bookingId),
          eq(stayBookings.organizationId, organizationId),
        ),
      });
      if (!booking) throw new NotFoundException('Stay booking not found');

      if (booking.status === 'checked_out') {
        return { id: booking.id, status: booking.status, duplicate: true };
      }

      const transition = assertStayBookingTransition(booking.status, 'checked_out');
      if (!transition.ok) {
        throw new ConflictException(transition.reason ?? 'Illegal stay checkout transition');
      }

      await transaction
        .update(stayBookings)
        .set({ status: 'checked_out', updatedAt: new Date() })
        .where(
          and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, organizationId)),
        );

      await transaction.insert(stayBookingStatusHistory).values({
        organizationId,
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: 'checked_out',
        actorUserId: claims.sub,
        reason: 'ops_checkout',
      });

      await transaction.insert(workflowEvents).values({
        organizationId,
        actorUserId: claims.sub,
        resourceType: 'stay_booking',
        resourceId: booking.id,
        eventType: 'stay.checked_out',
        fromStatus: booking.status,
        toStatus: 'checked_out',
      });

      await transaction.insert(outboxEvents).values({
        organizationId,
        topic: 'stay.checked_out',
        aggregateType: 'stay_booking',
        aggregateId: booking.id,
        payload: {
          unitId: booking.unitId,
          checkOutOn: booking.checkOutOn,
        },
      });

      this.logger.log(`Stay booking ${booking.id} checked out`);
      return { id: booking.id, status: 'checked_out' as const, duplicate: false };
    });
  }
}
