import { z } from 'zod';
import { rescheduleGuestStayBookingOnNeon } from '@/lib/public-stays-guest-neon';
import {
  stayBookingDbGuard,
  stayBookingErrorResponse,
  stayBookingJson,
} from '@/lib/public-stays-booking-route';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const bodySchema = z
  .object({
    referenceCode: z.string().trim().min(4).max(40),
    checkInOn: isoDate,
    checkOutOn: isoDate,
    confirm: z.boolean().default(false),
  })
  .strict();

/**
 * POST /api/public/stays/guest/reschedule — price (`confirm: false`) or apply
 * (`confirm: true`) a move of a stay booking to new free dates, by booking reference.
 */
export async function POST(request: Request) {
  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-guest-reschedule', clientIp(request)]),
    limit: 30,
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

  try {
    const payload = await rescheduleGuestStayBookingOnNeon(parsed.data);
    return stayBookingJson(payload);
  } catch (error) {
    return stayBookingErrorResponse(error);
  }
}
