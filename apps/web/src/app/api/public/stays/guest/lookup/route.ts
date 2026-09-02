import { stayGuestBookingLookupSchema } from '@bhd-r/contracts';
import { lookupPublicStayBookingOnNeon } from '@/lib/public-stays-guest-neon';
import {
  stayBookingDbGuard,
  stayBookingErrorResponse,
  stayBookingJson,
} from '@/lib/public-stays-booking-route';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/public/stays/guest/lookup?referenceCode=ST-… — Neon, no Nest BFF. */
export async function GET(request: Request) {
  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-lookup', clientIp(request)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return stayBookingJson(
      { error: { code: 'rate_limited', messageAr: 'محاولات كثيرة — انتظر قليلاً.' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const referenceCode = new URL(request.url).searchParams.get('referenceCode') ?? '';
  const parsed = stayGuestBookingLookupSchema.safeParse({ referenceCode });
  if (!parsed.success) {
    return stayBookingJson({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const payload = await lookupPublicStayBookingOnNeon(parsed.data.referenceCode);
    return stayBookingJson(payload);
  } catch (error) {
    return stayBookingErrorResponse(error);
  }
}
