import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import {
  clientSecurityContext,
  recordAuthAttempt,
} from '@/lib/security-protection';
import { startSecurityUnlock } from '@/lib/security-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().email().max(320),
  civilId: z.string().min(4).max(40),
  dateOfBirth: z.string().min(8).max(32),
  idExpiry: z.string().min(8).max(32),
  whatsapp: z.string().min(8).max(40),
  lastTransaction: z.string().min(2).max(80),
  locale: z.enum(['ar', 'en']).optional(),
});

/** POST /api/security/unlock/start — begin locked-account recovery. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['security-unlock-start', clientIp(request)]),
    limit: 8,
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

  const ctx = clientSecurityContext(request);
  try {
    const result = await startSecurityUnlock({
      ...body,
      locale: body.locale ?? 'ar',
    });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String((error as { code: string }).code) : 'unlock_failed';
    await recordAuthAttempt({
      outcome: 'failure',
      source: 'security_unlock',
      ctx,
      email: body.email,
      reason: code.slice(0, 80),
    }).catch(() => undefined);
    const status =
      code === 'not_locked' ? 404 : code === 'rate_limited' ? 429 : code === 'invalid_email' ? 400 : 400;
    return NextResponse.json({ error: { code } }, { status });
  }
}
