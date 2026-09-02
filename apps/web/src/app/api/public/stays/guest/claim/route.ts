import { NextResponse } from 'next/server';
import { stayGuestBookingClaimSchema } from '@bhd-r/contracts';
import { claimGuestStayBookingOnNeon } from '@/lib/public-stays-guest-neon';
import {
  stayBookingDbGuard,
  stayBookingErrorResponse,
  stayBookingJson,
} from '@/lib/public-stays-booking-route';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/public/stays/guest/claim — link booking to signed-in user via Neon. */
export async function POST(request: Request) {
  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-claim', claims.sub, clientIp(request)]),
    limit: 20,
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

  const parsed = stayGuestBookingClaimSchema.safeParse(body);
  if (!parsed.success) {
    return stayBookingJson({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const payload = await claimGuestStayBookingOnNeon(claims.sub, parsed.data.referenceCode);
    return stayBookingJson(payload);
  } catch (error) {
    return stayBookingErrorResponse(error);
  }
}
