import { Injectable, Logger } from '@nestjs/common';
import {
  assertStayBookingTransition,
  type StayBookingStatus,
} from '@bhd-r/domain';

/**
 * Phase 5 foundation — quote → hold → pay → confirm.
 * Payment webhook kind `stay_booking` must be wired in finance webhooks without
 * breaking invoice / reservation_deposit handlers (Expand–Contract).
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

  /** Placeholder until payment provider + webhook kind are live. */
  describePaymentHook(): { kind: 'stay_booking'; note: string } {
    return {
      kind: 'stay_booking',
      note: 'Confirm stay_bookings only after signed webhook, amount/currency match, and unique event id.',
    };
  }
}
