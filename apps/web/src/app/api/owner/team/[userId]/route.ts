import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { removeTeamMember, updateTeamMember } from '@/lib/team-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    role: z.string().min(2).max(80).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    capabilities: z.array(z.string().max(40)).max(20).optional(),
  })
  .refine((body) => body.role || body.status || body.capabilities, 'empty');

type Context = { params: Promise<{ userId: string }> };

async function guard(request: Request): Promise<SessionClaims | NextResponse> {
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
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  return claims;
}

async function memberId(context: Context): Promise<string | null> {
  const { userId } = await context.params;
  return z.string().uuid().safeParse(userId).success ? userId : null;
}

/** PATCH a member's role, status or extra capabilities. */
export async function PATCH(request: Request, context: Context) {
  const claims = await guard(request);
  if (claims instanceof NextResponse) return claims;
  const userId = await memberId(context);
  if (!userId) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    await updateTeamMember(claims, userId, {
      ...(body.role ? { role: body.role } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.capabilities ? { capabilities: body.capabilities } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}

/** DELETE removes the member from this organization (their account stays). */
export async function DELETE(request: Request, context: Context) {
  const claims = await guard(request);
  if (claims instanceof NextResponse) return claims;
  const userId = await memberId(context);
  if (!userId) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  try {
    await removeTeamMember(claims, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'delete_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
