import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { recordRentPayment } from '@/lib/rent-collection-neon';
import { isRentDocKey } from '@/lib/rent-documents';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { PAYMENT_METHODS } from '@/lib/tenant-charges-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    leaseId: z.string().uuid(),
    key: z.string().max(48).refine(isRentDocKey),
    amountMinor: z
      .string()
      .regex(/^\d{1,12}$/)
      .optional(),
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().max(80).optional(),
    receivedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

/**
 * POST /api/owner/rent-receipts
 * Records that the tenant paid a rent installment or a bill on the lease; the tenant is emailed the
 * signed receipt.
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
    key: hashRateKey(['owner-rent-receipt', claims.sub, clientIp(request)]),
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
    return NextResponse.json(await recordRentPayment(claims, parsed.data), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('POST /api/owner/rent-receipts', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
