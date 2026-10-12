import { z } from 'zod';
import { requestGuestDepositRefundOnNeon } from '@/lib/public-stays-guest-neon';
import {
  stayBookingDbGuard,
  stayBookingErrorResponse,
  stayBookingJson,
} from '@/lib/public-stays-booking-route';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { REFUND_NOTE_MAX, REFUND_PAYOUT_METHODS } from '@/lib/stay-deposit-refund';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

const bodySchema = z
  .object({
    referenceCode: z.string().trim().min(4).max(40),
    note: optionalText(REFUND_NOTE_MAX),
    payout: z
      .object({
        method: z.enum(REFUND_PAYOUT_METHODS),
        account: z.string().trim().min(4).max(64),
        bank: optionalText(120),
        holder: optionalText(120),
      })
      .strict()
      .optional(),
  })
  .strict();

/** POST /api/public/stays/guest/deposit-refund — ask for the security deposit back after check-out. */
export async function POST(request: Request) {
  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-guest-deposit-refund', clientIp(request)]),
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return stayBookingJson(
      { error: { code: 'rate_limited', messageAr: 'محاولات كثيرة — انتظر قليلاً.' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return stayBookingJson({ error: { code: 'invalid_body' } }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return stayBookingJson({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  const { referenceCode, note, payout } = parsed.data;
  try {
    const booking = await requestGuestDepositRefundOnNeon({
      referenceCode,
      note,
      payout: payout
        ? {
            method: payout.method,
            account: payout.account,
            bank: payout.bank ?? null,
            holder: payout.holder ?? null,
          }
        : undefined,
    });
    return stayBookingJson({ booking });
  } catch (error) {
    return stayBookingErrorResponse(error);
  }
}
