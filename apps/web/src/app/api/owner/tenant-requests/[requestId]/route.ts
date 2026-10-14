import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { PAYMENT_METHODS } from '@/lib/tenant-charges-neon';
import { decideTenantRequest } from '@/lib/tenant-requests-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const bodySchema = z
  .object({
    action: z.enum([
      'approve',
      'reject',
      'in_progress',
      'on_hold',
      'complete',
      'reply',
      'emergency_confirm',
      'emergency_deny',
      'charge_paid',
    ]),
    note: z.string().max(1000).optional(),
    date: isoDate.optional(),
    charge: z
      .object({
        amountMinor: z.string().regex(/^\d{1,12}$/),
        payment: z.enum(['before_work', 'deferred']),
        dueOn: isoDate.optional(),
      })
      .strict()
      .optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
  })
  .strict();

/**
 * POST /api/owner/tenant-requests/:requestId
 * The landlord's team answers a tenant request: approve (applying a cheque postponement or stop,
 * or billing maintenance to the tenant before the work or later), reject with a reason, mark in
 * progress, on hold or completed, reply, confirm or deny an urgent request, or record that the
 * tenant paid the maintenance charge.
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
