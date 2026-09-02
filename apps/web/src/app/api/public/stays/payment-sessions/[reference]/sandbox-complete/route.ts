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
  if (!limited.ok) {
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return stayBookingJson({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const payload = await completeStaySandboxPaymentOnNeon(reference, parsed.data.returnPath ?? null);
    return stayBookingJson(payload);
  } catch (error) {
    return stayBookingErrorResponse(error);
  }
}
