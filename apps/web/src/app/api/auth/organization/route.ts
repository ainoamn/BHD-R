import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl, switchOrganizationSession } from '@/lib/bhd/identity-session';
import { setSessionCookies } from '@/lib/bhd/session-cookies';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { listMyOrganizations } from '@/lib/team-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ organizationId: z.string().uuid() });

/** GET organizations this account works in. */
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
    return NextResponse.json(
      { organizations: await listMyOrganizations(claims) },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    const code = clientSafeErrorCode(error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}

/** POST switch this device's session to another organization the account belongs to. */
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
    key: hashRateKey(['organization-switch', claims.sub, clientIp(request)]),
    limit: 10,
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
    const issued = await switchOrganizationSession({
      userId: claims.sub,
      sessionId: claims.sid,
      organizationId: body.organizationId,
    });
    const response = NextResponse.json({ organizationId: issued.claims.organizationId });
    setSessionCookies(response, issued);
    return response;
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
