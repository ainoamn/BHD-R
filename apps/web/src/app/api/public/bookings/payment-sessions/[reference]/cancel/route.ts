import { isPaymentSandboxPilotEnabled } from '@bhd-r/config';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { leaseBookingErrorResponse, leaseBookingJson } from '@/lib/lease-booking-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { cancelLeaseSandboxCheckout } from '@/lib/public-lease-booking-neon';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST — guest cancels an unpaid lease deposit checkout. */
export async function POST(request: Request, context: { params: Promise<{ reference: string }> }) {
  if (!isPaymentSandboxPilotEnabled()) {
    return leaseBookingJson(
      {
        error: {
          code: 'sandbox_disabled',
          message: 'Sandbox payments are disabled',
          messageAr: 'بوابة الدفع التجريبية غير مفعّلة.',
        },
      },
      { status: 404 },
    );
  }
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
    key: hashRateKey(['lease-pay-cancel', claims.sub, clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return leaseBookingJson(
      { error: { code: 'rate_limited', messageAr: 'محاولات كثيرة — انتظر قليلاً.' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const { reference } = await context.params;
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(reference)) {
    return leaseBookingJson({ error: { code: 'not_found' } }, { status: 404 });
  }

  try {
    const result = await cancelLeaseSandboxCheckout(claims, reference);
    return leaseBookingJson(result);
  } catch (error) {
    return leaseBookingErrorResponse(error, 'cancel_failed');
  }
}
