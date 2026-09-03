import { isPaymentSandboxPilotEnabled } from '@bhd-r/config';
import { z } from 'zod';
import { completeStaySandboxPaymentOnNeon } from '@/lib/public-stays-payment-neon';
import {
  stayBookingDbGuard,
  stayBookingErrorResponse,
  stayBookingJson,
} from '@/lib/public-stays-booking-route';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    returnPath: z
      .string()
      .regex(/^\/(ar|en)(\/[A-Za-z0-9._~-]{1,64}){0,6}(\?[A-Za-z0-9._~=&%-]{0,200})?$/)
      .optional(),
    /** Safe display fields only — never accept full PAN / CVC. */
    cardLast4: z.string().regex(/^\d{4}$/).optional(),
    cardBrand: z.enum(['visa', 'mastercard', 'amex', 'other']).optional(),
    cardholderName: z.string().trim().min(2).max(80).optional(),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ reference: string }> },
) {
  if (!isPaymentSandboxPilotEnabled()) {
    return stayBookingJson(
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

  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-pay-complete', clientIp(request)]),
    limit: 15,
    windowMs: 60_000,
  });
  if (limited.ok === false) {
    return stayBookingJson(
      { error: { code: 'rate_limited', messageAr: 'محاولات كثيرة — انتظر قليلاً.' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const { reference } = await context.params;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // Reject any attempt to send full card data (PAN / CVC / expiry).
  if (body && typeof body === 'object') {
    const keys = Object.keys(body as Record<string, unknown>).map((k) => k.toLowerCase());
    const forbidden = ['cardnumber', 'pan', 'number', 'cvc', 'cvv', 'expiry', 'exp', 'fullpan'];
    if (keys.some((k) => forbidden.includes(k))) {
      return stayBookingJson(
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
    return stayBookingJson({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const payload = await completeStaySandboxPaymentOnNeon(reference, parsed.data.returnPath ?? null, {
      ...(parsed.data.cardLast4 ? { cardLast4: parsed.data.cardLast4 } : {}),
      ...(parsed.data.cardBrand ? { cardBrand: parsed.data.cardBrand } : {}),
      ...(parsed.data.cardholderName ? { cardholderName: parsed.data.cardholderName } : {}),
    });
    return stayBookingJson(payload);
  } catch (error) {
    return stayBookingErrorResponse(error);
  }
}
