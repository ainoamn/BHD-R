import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { loadOwnerApprovalPolicy, saveApprovalPolicy } from '@/lib/approval-policy-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { ownerPartyScope } from '@/lib/portal-ops-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const mode = z.enum(['manual', 'auto']);

const bodySchema = z
  .object({
    propertyId: z.string().uuid().nullable(),
    policy: z
      .object({
        booking: mode,
        contract: mode,
        payment: mode,
        reschedule: mode.default('auto'),
        deferUntilHandover: z
          .array(z.enum(['meters', 'handoverOn']))
          .max(2)
          .default([]),
        requireTenantAttestation: z.boolean().default(true),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** GET /api/owner/approval-policy?propertyId= — effective policy for org or one property. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  if (!claims.organizationId || !claims.permissions.includes('reservation.read')) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  const url = new URL(request.url);
  const raw = url.searchParams.get('propertyId');
  const propertyId = raw && z.string().uuid().safeParse(raw).success ? raw : null;
  try {
    const view = await loadOwnerApprovalPolicy(
      {
        organizationId: claims.organizationId,
        userId: claims.sub,
        partyId: ownerPartyScope(claims),
        roles: claims.roles,
      },
      propertyId,
    );
    return NextResponse.json(view, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'load_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}

/**
 * PUT /api/owner/approval-policy
 * Whether website bookings of the organization (`propertyId` null) or one property are approved
 * by hand or by the system on the owner's behalf. `policy` null falls back to the wider policy.
 */
export async function PUT(request: Request) {
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
  if (!claims.organizationId || !claims.permissions.includes('reservation.manage')) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-approval-policy', claims.sub, clientIp(request)]),
    limit: 20,
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
    return NextResponse.json(await saveApprovalPolicy(claims, body.propertyId, body.policy), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('PUT /api/owner/approval-policy', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
