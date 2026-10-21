import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { confirmStayGate, previewStayGate } from '@/lib/stay-checkin-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const keySchema = z.union([
  z.object({ token: z.string().min(40).max(120) }).strict(),
  z
    .object({
      reference: z.string().trim().min(4).max(40),
      code: z
        .string()
        .trim()
        .regex(/^\d{6}$/),
    })
    .strict(),
]);

const bodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('preview'),
      key: keySchema,
      propertyId: z.string().uuid().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('checkin'),
      key: keySchema,
      note: z.string().trim().max(500).optional(),
      propertyId: z.string().uuid().optional(),
      depositWaived: z.boolean().optional(),
    })
    .strict(),
]);

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, init);
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : 'request_failed';
  const messages: Record<string, { ar: string; en: string }> = {
    stay_checkin_too_early: {
      ar: 'لا يمكن تسجيل الدخول قبل موعد الوصول بأكثر من 4 ساعات.',
      en: 'Check-in opens at most 4 hours before the arrival time.',
    },
    stay_checkin_window_closed: {
      ar: 'انتهت مدة الحجز دون تسجيل وصول — أُلغي الحجز تلقائياً.',
      en: 'The stay ended without check-in — the booking was cancelled automatically.',
    },
    wrong_property: {
      ar: 'هذا الحجز لا يخص هذا العقار.',
      en: 'This booking does not belong to this property.',
    },
    deposit_unpaid: {
      ar: 'الضيف لم يدفع مبلغ التأمين المسترد بعد. ادفع أولاً أو استثنِ التأمين للمتابعة.',
      en: 'The guest has not paid the refundable deposit yet. Collect payment first, or waive the deposit to continue.',
    },
  };
  const status =
    code === 'forbidden'
      ? 403
      : code === 'booking_not_found'
        ? 404
        : code === 'pass_invalid' ||
            code === 'stay_not_ready' ||
            code === 'stay_status_invalid' ||
            code === 'stay_checkin_too_early' ||
            code === 'stay_checkin_window_closed' ||
            code === 'wrong_property' ||
            code === 'deposit_unpaid'
          ? 409
          : 400;
  const message = messages[code];
  return json(
    {
      error: {
        code,
        ...(message ? { messageAr: message.ar, message: message.en } : {}),
      },
    },
    { status },
  );
}

/** POST /api/stay-gate — staff preview or confirm stay arrival from QR / code. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    return errorResponse(error);
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-gate', claims.sub, clientIp(request)]),
    limit: 40,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: { code: 'invalid_body' } }, { status: 400 });
  }
  try {
    const body = parsed.data;
    if (body.action === 'preview') {
      return json(await previewStayGate(claims, body.key, body.propertyId));
    }
    return json(
      await confirmStayGate(
        claims,
        body.key,
        body.note,
        body.propertyId,
        body.depositWaived === true,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
