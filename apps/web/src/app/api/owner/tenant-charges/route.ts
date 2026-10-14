import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { createTenantCharge } from '@/lib/tenant-charges-neon';
import { CHARGE_CATEGORIES } from '@/lib/tenant-charges-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    leaseId: z.string().uuid(),
    category: z.enum(CHARGE_CATEGORIES),
    amountMinor: z.string().regex(/^\d{1,12}$/),
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().max(300).optional(),
  })
  .strict();

/**
 * POST /api/owner/tenant-charges
 * Bills the tenant of a lease for electricity, water, maintenance, damage, a service or anything
 * else: an issued invoice that shows in the tenant's statement and arrears.
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
    key: hashRateKey(['owner-tenant-charge', claims.sub, clientIp(request)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'tenant_charge_invalid' } }, { status: 400 });
  }
  try {
    return NextResponse.json(await createTenantCharge(claims, parsed.data), {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'create_failed');
    if (code === 'create_failed') console.error('POST /api/owner/tenant-charges', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
