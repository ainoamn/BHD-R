import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { translateName } from '@/lib/name-translate-ai';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z
  .object({
    text: z.string().trim().min(2).max(200),
    target: z.enum(['ar', 'en']),
    kind: z.enum(['person', 'company']).default('person'),
  })
  .strict();

/** POST AI transliteration of a tenant, buyer or company name while booking. */
export async function POST(request: Request) {
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['name-translate', claims.sub, clientIp(request)]),
    limit: 30,
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

  try {
    const result = await translateName(
      { oidcToken: request.headers.get('x-vercel-oidc-token') },
      body,
    );
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'ai_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
