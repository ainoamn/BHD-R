import { isPaymentSandboxPilotEnabled } from '@bhd-r/config';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { leaseBookingErrorResponse, leaseBookingJson } from '@/lib/lease-booking-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { createLeaseBookingCheckout } from '@/lib/public-lease-booking-neon';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { isValidGuestPhone } from '@/lib/stay-booking-dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    unitId: z.string().uuid(),
    mode: z.enum(['rent', 'sale']),
    locale: z.enum(['ar', 'en']).default('ar'),
    fullName: z.string().trim().min(2).max(160),
    phone: z.string().trim().max(32).refine(isValidGuestPhone),
    email: z.union([z.string().trim().email().max(320), z.literal('')]).optional(),
    termsAccepted: z.literal(true),
    termsVersion: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();

/** POST /api/public/bookings/deposit-checkout — terms accepted → reservation + BHD Pay session. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return leaseBookingJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  if (!isPaymentSandboxPilotEnabled()) {
    return leaseBookingJson(
      {
        error: {
          code: 'sandbox_disabled',
          message: 'Online deposit payment is not enabled yet',
          messageAr: 'دفع مبلغ الضمان إلكترونياً غير مفعّل حالياً.',
        },
      },
      { status: 409 },
    );
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    return leaseBookingErrorResponse(error);
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['lease-deposit-checkout', claims.sub, clientIp(request)]),
    limit: 8,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return leaseBookingJson(
      { error: { code: 'rate_limited', messageAr: 'محاولات كثيرة — انتظر قليلاً.' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return leaseBookingJson(
      { error: { code: 'invalid_body', messageAr: 'تحقق من البيانات المدخلة.' } },
      { status: 400 },
    );
  }

  try {
    const result = await createLeaseBookingCheckout(claims, {
      unitId: parsed.data.unitId,
      mode: parsed.data.mode,
      locale: parsed.data.locale,
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      email: parsed.data.email || null,
      termsVersion: parsed.data.termsVersion,
    });
    return leaseBookingJson(result);
  } catch (error) {
    return leaseBookingErrorResponse(error);
  }
}
