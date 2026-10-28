import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { leaseBookingErrorResponse, leaseBookingJson } from '@/lib/lease-booking-route';
import { runReservationAutomation } from '@/lib/lease-reservation-lifecycle-neon';
import { requireLiveSession } from '@/lib/next-route-guard';
import { completeLeaseEsign } from '@/lib/public-lease-booking-neon';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const optionalCapture = z.string().startsWith('data:image/').max(900_000).optional();
const bodySchema = z
  .object({
    signaturePng: optionalCapture,
    idFrontPng: optionalCapture,
    idBackPng: optionalCapture,
    selfiePng: optionalCapture,
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ reference: string }> }) {
  if (!hasDatabaseUrl()) {
    return leaseBookingJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    return leaseBookingErrorResponse(error);
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['lease-esign', claims.sub, clientIp(request)]),
    limit: 8,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return leaseBookingJson(
      { error: { code: 'rate_limited', messageAr: 'محاولات كثيرة.' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return leaseBookingJson(
      { error: { code: 'invalid_body', messageAr: 'أكمل التوقيع وصور الهوية والسيلفي.' } },
      { status: 400 },
    );
  }

  const { reference } = await context.params;
  try {
    const { reservationId, ...result } = await completeLeaseEsign(claims, reference, parsed.data);
    await runReservationAutomation(reservationId, claims.sub);
    return leaseBookingJson(result);
  } catch (error) {
    return leaseBookingErrorResponse(error, 'request_failed');
  }
}
