import { Injectable, Logger } from '@nestjs/common';
import {
  assertStayBookingTransition,
  type StayBookingStatus,
} from '@bhd-r/domain';

/**
 * Phase 5 — quote → hold → pay → confirm.
 * Payment webhook kind `stay_booking` is handled in FinanceService.ingestWebhook
 * (Expand–Contract alongside invoice / reservation_deposit).
 */
@Injectable()
export class StaysBookingService {
  private readonly logger = new Logger(StaysBookingService.name);

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
}
