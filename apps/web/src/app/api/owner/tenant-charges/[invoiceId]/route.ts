import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { PAYMENT_METHODS, payTenantCharge } from '@/lib/tenant-charges-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    amountMinor: z
      .string()
      .regex(/^\d{1,12}$/)
      .optional(),
    method: z.enum(PAYMENT_METHODS),
  })
  .strict();

/**
 * POST /api/owner/tenant-charges/:invoiceId
 * Records that the tenant paid a charge (in full unless an amount is given). A maintenance request
 * that waited for this payment goes back to approved.
 */
export async function POST(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
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
    key: hashRateKey(['owner-tenant-charge-pay', claims.sub, clientIp(request)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const { invoiceId } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(invoiceId).success) {
    return NextResponse.json({ error: { code: 'tenant_charge_invalid' } }, { status: 400 });
  }
  try {
    return NextResponse.json(await payTenantCharge(claims, invoiceId, parsed.data), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('POST /api/owner/tenant-charges/:id', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
