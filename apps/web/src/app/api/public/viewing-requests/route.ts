import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { createViewingRequestNestOrNeon } from '@/lib/nest-or-neon-write';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import {
  assertRouteRateLimit,
  clientIp,
  hashRateKey,
} from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  unitId: z.string().uuid(),
  locale: z.enum(['ar', 'en']).default('ar'),
});

/** POST /api/public/viewing-requests — Nest-first with Neon fallback. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['viewing', claims.sub, clientIp(request)]),
    limit: 5,
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

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null;

  try {
    const result = await createViewingRequestNestOrNeon(claims, body.unitId, body.locale, {
      idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    const code = clientSafeErrorCode(error, 'request_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
