import { isPaymentSandboxPilotEnabled } from '@bhd-r/config';
import { z } from 'zod';
import { completeStayEsignOnNeon } from '@/lib/public-stays-esign-neon';
import {
  stayBookingDbGuard,
  stayBookingErrorResponse,
  stayBookingJson,
} from '@/lib/public-stays-booking-route';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { isStayEsignRequiredServer } from '@/lib/stay-esign-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    signaturePng: z.string().startsWith('data:image/').max(900_000),
    idFrontPng: z.string().startsWith('data:image/').max(900_000),
    idBackPng: z.string().startsWith('data:image/').max(900_000),
    selfiePng: z.string().startsWith('data:image/').max(900_000),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ reference: string }> },
) {
  if (!isStayEsignRequiredServer()) {
    return stayBookingJson({ error: { code: 'esign_disabled' } }, { status: 404 });
  }
  if (!isPaymentSandboxPilotEnabled() && process.env.STAYS_PLATFORM_ENABLED !== 'true') {
    return stayBookingJson({ error: { code: 'not_found' } }, { status: 404 });
  }

  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-esign', clientIp(request)]),
    limit: 8,
    windowMs: 60_000,
  });
  if (limited.ok === false) {
    return stayBookingJson(
      { error: { code: 'rate_limited', messageAr: 'محاولات كثيرة.' } },
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
    const payload = await completeStayEsignOnNeon(reference, parsed.data);
    return stayBookingJson(payload);
  } catch (error) {
    return stayBookingErrorResponse(error);
  }
}
