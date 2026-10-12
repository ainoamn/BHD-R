import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { addTeamMember, loadTeam } from '@/lib/team-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().trim().min(3).max(320),
  displayName: z.string().trim().max(160).optional(),
  role: z.string().min(2).max(80),
  capabilities: z.array(z.string().max(40)).max(20).default([]),
});

/** GET the organization team. */
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
  try {
    return NextResponse.json(await loadTeam(claims));
  } catch (error) {
    const code = clientSafeErrorCode(error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}

/** POST add a team member by email; they join on their first BHD sign-in with that email. */
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
  if (!claims.organizationId || !claims.permissions.includes('organization.members.write')) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-team', claims.sub, clientIp(request)]),
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
    const result = await addTeamMember(claims, {
      email: body.email,
      role: body.role,
      capabilities: body.capabilities,
      ...(body.displayName ? { displayName: body.displayName } : {}),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'create_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
