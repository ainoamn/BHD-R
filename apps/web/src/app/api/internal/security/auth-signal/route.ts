import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { assertCronAuthorized, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { assertRouteRateLimit } from '@/lib/route-rate-limit';
import {
  clientSecurityContext,
  hashIpAddress,
  hashUserAgent,
  recordAuthAttempt,
} from '@/lib/security-protection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  outcome: z.enum(['success', 'failure', 'blocked', 'quarantined', 'locked']),
  email: z.string().email().optional(),
  userId: z.string().uuid().optional(),
  identitySubject: z.string().min(8).max(200).optional(),
  reason: z.string().max(80).optional(),
  source: z.string().max(40).optional(),
  /** When Identity forwards the original client IP. */
  ipAddress: z.string().min(3).max(64).optional(),
  countryCode: z.string().length(2).optional(),
  userAgent: z.string().max(512).optional(),
});

/**
 * POST /api/internal/security/auth-signal
 * Bearer CRON_SECRET (or INTERNAL_SECURITY_SECRET). Used by BHD Identity to forward
 * failed/successful password attempts so product quarantine + account lock can fire.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  const secret = process.env.INTERNAL_SECURITY_SECRET?.trim();
  const auth = request.headers.get('authorization') ?? '';
  if (secret && secret.length >= 16) {
    const expected = `Bearer ${secret}`;
    if (auth !== expected) {
      return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
    }
  } else {
    const cron = assertCronAuthorized(request);
    if (!cron.ok) {
      return NextResponse.json({ error: { code: cron.error } }, { status: cron.status });
    }
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['security-auth-signal', clientIp(request)]),
    limit: 120,
    windowMs: 60_000,
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

  const fallback = clientSecurityContext(request);
  const ipAddress = body.ipAddress?.trim() || fallback.ipAddress;
  const ctx = {
    ipAddress,
    ipHash: hashIpAddress(ipAddress),
    userAgentHash: hashUserAgent(body.userAgent) ?? fallback.userAgentHash,
    countryCode: body.countryCode?.toUpperCase() ?? fallback.countryCode,
  };

  const result = await recordAuthAttempt({
    outcome: body.outcome,
    source: body.source ?? 'identity',
    ctx,
    ...(body.email ? { email: body.email } : {}),
    ...(body.userId ? { userId: body.userId } : {}),
    ...(body.identitySubject ? { identitySubject: body.identitySubject } : {}),
    ...(body.reason ? { reason: body.reason } : {}),
  });

  return NextResponse.json({ ok: true, ...result });
}
