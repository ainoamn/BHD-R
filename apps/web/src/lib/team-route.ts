import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Permission, SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const TEAM_WRITE: readonly Permission[] = ['organization.members.write'];

/**
 * Database, organization and rate-limit checks around the route's own live-session check
 * (`requireLiveSession` with CSRF and `TEAM_WRITE`).
 */
export async function teamWriteGuard(
  request: Request,
  session: () => Promise<SessionClaims>,
  limit = 30,
): Promise<SessionClaims | NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims: SessionClaims;
  try {
    claims = await session();
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  if (!claims.organizationId) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-team', claims.sub, clientIp(request)]),
    limit,
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

export async function readTeamBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T> | NextResponse> {
  try {
    return schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }
}

export async function uuidParam(params: Promise<Record<string, string>>, key: string) {
  const value = (await params)[key];
  return z.string().uuid().safeParse(value).success ? value! : null;
}

export function teamErrorResponse(code: string): NextResponse {
  return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
}

export const roleListSchema = z.array(z.string().min(2).max(80)).min(1).max(6);
export const capabilityListSchema = z.array(z.string().max(40)).max(60);

export const savedRoleSchema = z.object({
  nameAr: z.string().trim().min(2).max(80),
  nameEn: z.string().trim().max(80).optional(),
  description: z.string().trim().max(300).optional(),
  capabilities: capabilityListSchema.min(1),
});
