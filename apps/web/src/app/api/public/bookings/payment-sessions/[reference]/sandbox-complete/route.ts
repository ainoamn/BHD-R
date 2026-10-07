import { isPaymentSandboxPilotEnabled } from '@bhd-r/config';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { leaseBookingErrorResponse, leaseBookingJson } from '@/lib/lease-booking-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { completeLeaseSandboxPayment } from '@/lib/public-lease-booking-neon';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    /** Safe display fields only — never accept full PAN / CVC. */
    cardLast4: z.string().regex(/^\d{4}$/).optional(),
    cardBrand: z.enum(['visa', 'mastercard', 'amex', 'other']).optional(),
    cardholderName: z.string().trim().min(2).max(80).optional(),
  })
  .strict();

const FORBIDDEN_CARD_KEYS = ['cardnumber', 'pan', 'number', 'cvc', 'cvv', 'expiry', 'exp', 'fullpan'];

export async function POST(
  request: Request,
  context: { params: Promise<{ reference: string }> },
) {
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
    key: hashRateKey(['lease-pay-complete', claims.sub, clientIp(request)]),
    limit: 15,
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

  const body: unknown = await request.json().catch(() => ({}));
  if (body && typeof body === 'object') {
    const keys = Object.keys(body as Record<string, unknown>).map((key) => key.toLowerCase());
    if (keys.some((key) => FORBIDDEN_CARD_KEYS.includes(key))) {
      return leaseBookingJson(
        {
          error: {
            code: 'card_data_forbidden',
            message: 'Full card data must never be submitted to the server',
            messageAr: 'يُمنع إرسال رقم البطاقة الكامل أو رمز الأمان إلى الخادم.',
          },
        },
        { status: 400 },
      );
    }
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return leaseBookingJson({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const result = await completeLeaseSandboxPayment(claims, reference, {
      ...(parsed.data.cardLast4 ? { cardLast4: parsed.data.cardLast4 } : {}),
      ...(parsed.data.cardBrand ? { cardBrand: parsed.data.cardBrand } : {}),
    });
    return leaseBookingJson(result);
  } catch (error) {
    return leaseBookingErrorResponse(error, 'complete_failed');
  }
}
