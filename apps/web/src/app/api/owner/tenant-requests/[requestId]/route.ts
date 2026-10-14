import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { decideTenantRequest } from '@/lib/tenant-requests-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    action: z.enum(['approve', 'reject', 'in_progress', 'on_hold', 'complete', 'reply']),
    note: z.string().max(1000).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

/**
 * POST /api/owner/tenant-requests/:requestId
 * The landlord's team answers a tenant request: approve (applying a cheque postponement or stop),
 * reject with a reason, mark in progress, on hold or completed, or reply.
 */
export async function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
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
    key: hashRateKey(['owner-tenant-request', claims.sub, clientIp(request)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const { requestId } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(requestId).success) {
    return NextResponse.json({ error: { code: 'tenant_request_invalid' } }, { status: 400 });
  }
  try {
    return NextResponse.json(await decideTenantRequest(claims, requestId, parsed.data), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('POST /api/owner/tenant-requests/:id', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
