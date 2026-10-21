import { and, asc, eq } from 'drizzle-orm';
import { stayPaymentIntents, type Database } from '@bhd-r/db';
import type { StayBookingPaymentKind } from '@/lib/stay-booking-payment-labels';

export type { StayBookingPaymentKind } from '@/lib/stay-booking-payment-labels';
export {
  stayPaymentKindLabel,
  stayPaymentMethodLabel,
} from '@/lib/stay-booking-payment-labels';

export type StayBookingPaymentLine = {
  id: string;
  amountMinor: string;
  currency: string;
  status: string;
  provider: string;
  providerIntentId: string | null;
  idempotencyKey: string;
  paidAt: string | null;
  kind: StayBookingPaymentKind;
  /** 1-based among succeeded payments on this booking. */
  sequence: number;
};

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function paymentKind(idempotencyKey: string): StayBookingPaymentKind {
  if (idempotencyKey.startsWith('reschedule_topup:')) return 'reschedule_topup';
  if (idempotencyKey.startsWith('stay_deposit:')) return 'deposit';
  if (
    idempotencyKey.startsWith('stay_booking:') ||
    idempotencyKey.startsWith('stay-book-') ||
    idempotencyKey.startsWith('booking:') ||
    idempotencyKey.includes('instant') ||
    idempotencyKey.includes('request')
  ) {
    return 'booking';
  }
  return 'other';
}

/** Succeeded (and optionally all) payment intents for a stay booking, oldest first. */
export async function loadStayBookingPayments(
  tx: Tx,
  organizationId: string,
  bookingId: string,
  options?: { succeededOnly?: boolean },
): Promise<StayBookingPaymentLine[]> {
  const succeededOnly = options?.succeededOnly !== false;
  const rows = await tx
    .select({
      id: stayPaymentIntents.id,
      status: stayPaymentIntents.status,
      provider: stayPaymentIntents.provider,
      providerIntentId: stayPaymentIntents.providerIntentId,
      amountMinor: stayPaymentIntents.amountMinor,
      currency: stayPaymentIntents.currency,
      idempotencyKey: stayPaymentIntents.idempotencyKey,
      updatedAt: stayPaymentIntents.updatedAt,
    })
    .from(stayPaymentIntents)
    .where(
      and(
        eq(stayPaymentIntents.organizationId, organizationId),
        eq(stayPaymentIntents.bookingId, bookingId),
        ...(succeededOnly ? [eq(stayPaymentIntents.status, 'succeeded')] : []),
      ),
    )
    .orderBy(asc(stayPaymentIntents.updatedAt));

  let sequence = 0;
  return rows.map((row) => {
    const succeeded = row.status === 'succeeded';
    if (succeeded) sequence += 1;
    return {
      id: row.id,
      amountMinor: String(row.amountMinor),
      currency: row.currency,
      status: row.status,
      provider: row.provider ?? 'unknown',
      providerIntentId: row.providerIntentId ?? null,
      idempotencyKey: row.idempotencyKey,
      paidAt:
        row.updatedAt instanceof Date
          ? row.updatedAt.toISOString()
          : row.updatedAt
            ? String(row.updatedAt)
            : null,
      kind: paymentKind(row.idempotencyKey),
      sequence: succeeded ? sequence : 0,
    };
  });
}
