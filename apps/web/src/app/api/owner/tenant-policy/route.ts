import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { saveTenantPolicy } from '@/lib/tenant-policy-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rule = z.enum(['allow', 'block']);

const bodySchema = z
  .object({
    maintenanceWithArrears: rule.optional(),
    properties: z.record(z.string().uuid(), rule.nullable()).optional(),
  })
  .strict();

/**
 * POST /api/owner/tenant-policy
 * The organization's managers (or an owner, for their own buildings) set whether tenants who owe
 * rent or bills may still send ordinary maintenance requests.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-tenant-policy', claims.sub, clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data.properties ?? {}).length > 200) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }
  try {
    return NextResponse.json(await saveTenantPolicy(claims, parsed.data), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('POST /api/owner/tenant-policy', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
