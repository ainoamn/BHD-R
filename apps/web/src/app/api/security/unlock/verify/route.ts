import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { verifySecurityUnlock } from '@/lib/security-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  challengeId: z.string().uuid(),
  emailOtp: z.string().regex(/^\d{6}$/),
  whatsappOtp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

/** POST /api/security/unlock/verify — confirm OTPs and unlock. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['security-unlock-verify', clientIp(request)]),
    limit: 12,
    windowMs: 15 * 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const result = await verifySecurityUnlock({
      challengeId: body.challengeId,
      emailOtp: body.emailOtp,
      ...(body.whatsappOtp ? { whatsappOtp: body.whatsappOtp } : {}),
    });
    return NextResponse.json(result);
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error
        ? String((error as { code: string }).code)
        : 'verify_failed';
    return NextResponse.json({ error: { code } }, { status: 400 });
  }
}
