import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { CLAIM_ERRORS, CLAIM_MESSAGE_MAX, claimErrorBody } from '@/lib/stay-deposit-claims';
import { respondToDepositClaimOnNeon } from '@/lib/stay-deposit-claims-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    decision: z.enum(['accept', 'reject']),
    note: z.string().max(CLAIM_MESSAGE_MAX * 2),
    amount: z.string().max(24).optional(),
  })
  .strict();

/** POST /api/owner/accounting/deposit-claims/:claimId — the host answers a guest's deposit claim. */
export async function POST(request: Request, context: { params: Promise<{ claimId: string }> }) {
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
    key: hashRateKey(['deposit-claim-respond', claims.sub, clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    const failed = claimErrorBody('rate_limited');
    return NextResponse.json(failed.body, {
      status: 429,
      headers: { 'retry-after': String(limited.retryAfterSec) },
    });
  }

  const { claimId } = await context.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    const failed = claimErrorBody('invalid_body');
    return NextResponse.json(failed.body, { status: failed.status });
  }

  try {
    const result = await respondToDepositClaimOnNeon(claims, claimId, body);
    return NextResponse.json(result);
  } catch (error) {
    const raw = error instanceof Error ? error.message : '';
    const failed = claimErrorBody(
      Object.hasOwn(CLAIM_ERRORS, raw) ? raw : clientSafeErrorCode(error),
    );
    if (failed.status === 500) console.error('POST /api/owner/accounting/deposit-claims', error);
    return NextResponse.json(failed.body, { status: failed.status });
  }
}
