import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { sendEmailOtp, verifyEmailOtp } from '@/lib/email-otp-neon';
import { assertRouteRateLimitAsync, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sendSchema = z
  .object({
    action: z.literal('send'),
    email: z.string().trim().email().max(320),
    locale: z.enum(['ar', 'en']).default('ar'),
    organizationId: z.string().uuid().optional().nullable(),
  })
  .strict();

const verifySchema = z
  .object({
    action: z.literal('verify'),
    email: z.string().trim().email().max(320),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  })
  .strict();

/** POST /api/public/email-otp — send or verify a booking email OTP. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  const action =
    body && typeof body === 'object' && 'action' in body
      ? String((body as { action?: unknown }).action)
      : '';

  const limited = await assertRouteRateLimitAsync({
    key: hashRateKey(['email-otp', action, clientIp(request)]),
    limit: action === 'send' ? 5 : 12,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  try {
    if (action === 'send') {
      const parsed = sendSchema.parse(body);
      return NextResponse.json(
        await sendEmailOtp({
          email: parsed.email,
          locale: parsed.locale,
          organizationId: parsed.organizationId ?? null,
        }),
      );
    }
    if (action === 'verify') {
      const parsed = verifySchema.parse(body);
      return NextResponse.json(await verifyEmailOtp(parsed));
    }
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: string }).code)
        : clientSafeErrorCode(error, 'request_failed');
    const status =
      code === 'invalid_email' || code === 'invalid_otp' || code === 'otp_invalid'
        ? 400
        : code === 'otp_expired' || code === 'otp_used' || code === 'otp_not_found'
          ? 410
          : code === 'otp_locked'
            ? 429
            : statusForSafeCode(code);
    return NextResponse.json({ error: { code } }, { status });
  }
}
