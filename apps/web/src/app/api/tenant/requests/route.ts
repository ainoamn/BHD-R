import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { createTenantRequest } from '@/lib/tenant-requests-neon';
import { TENANT_REQUEST_TYPES } from '@/lib/tenant-requests-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    leaseId: z.string().uuid(),
    type: z.enum(TENANT_REQUEST_TYPES),
    subject: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    chequeId: z.string().uuid().optional(),
    proposedDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

/**
 * POST /api/tenant/requests
 * The signed-in tenant sends their landlord a request about one of their leases: maintenance,
 * postponing or stopping a cheque, cancelling, renewing or amending the lease, and the like.
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
    key: hashRateKey(['tenant-request-create', claims.sub, clientIp(request)]),
    limit: 10,
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
    return NextResponse.json({ error: { code: 'tenant_request_invalid' } }, { status: 400 });
  }
  try {
    return NextResponse.json(await createTenantRequest(claims, parsed.data), {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'create_failed');
    if (code === 'create_failed') console.error('POST /api/tenant/requests', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
