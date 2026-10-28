import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ROSTER_COOKIE,
  readRosterCookie,
  setRosterCookie,
  upsertRoster,
  type RosterAccount,
} from '@/lib/bhd/account-roster';
import { hasDatabaseUrl, switchIdentityAccountSession } from '@/lib/bhd/identity-session';
import { identitySettings, safeReturnTo } from '@/lib/bhd/oauth';
import {
  ORGANIZATION_COOKIE,
  rememberedOrganization,
  setSessionCookies,
} from '@/lib/bhd/session-cookies';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ sub: z.string().min(8).max(200) });

/**
 * POST /api/auth/switch — product session rebind helper.
 * Preferred client flow (BHD-ACCOUNT-SWITCHER §2): identity POST /switch then
 * `location.assign(/api/auth/bhd/start?returnTo=…)` so the page reloads with the
 * new account only. This JSON endpoint remains for clients that set cookies
 * before navigating to start.
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['account-switch', claims.sub, clientIp(request)]),
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

  const cookieStore = await cookies();
  const roster = readRosterCookie(cookieStore.get(ROSTER_COOKIE)?.value);
  const target = roster.find((item) => item.sub === body.sub);
  if (!target) {
    return NextResponse.json({ error: { code: 'account_not_in_roster' } }, { status: 404 });
  }

  try {
    const preferredOrganizationId = rememberedOrganization(
      cookieStore.get(ORGANIZATION_COOKIE)?.value,
    );
    const issued = await switchIdentityAccountSession({
      identitySubject: body.sub,
      previousSessionId: claims.sid,
      previousUserId: claims.sub,
      ...(preferredOrganizationId ? { preferredOrganizationId } : {}),
    });

    const account: RosterAccount = issued.rosterAccount || {
      ...target,
      sub: body.sub,
    };
    const accounts = upsertRoster(roster, account);

    const response = NextResponse.json({
      ok: true,
      authenticated: true,
      currentSub: account.sub,
      accounts,
      id: issued.claims.sub,
      displayName: account.name,
      email: account.email,
      username: account.username,
      picture: account.picture,
      providers: account.providers,
      organizationId: issued.claims.organizationId,
      roles: issued.claims.roles,
      permissions: issued.claims.permissions,
    });
    setSessionCookies(response, issued);
    setRosterCookie(response, accounts);
    return response;
  } catch (error) {
    const code = clientSafeErrorCode(error, 'switch_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}

/**
 * GET kept as a top-level bridge when fetch/CORS is unavailable.
 * Prefer POST + JSON for no-flash header updates.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sub = (url.searchParams.get('sub') || '').trim();
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ar';
  const returnPath = safeReturnTo(url.searchParams.get('returnTo'), `/${locale}/portal`);

  if (!sub || sub.length < 8) {
    return NextResponse.redirect(new URL(`/${locale}/portal`, url.origin), 303);
  }

  const { issuer } = identitySettings(url.origin);
  const productWorkspace = new URL(returnPath, url.origin);

  const identitySwitch = new URL(`${issuer}/api/auth/switch`);
  identitySwitch.searchParams.set('sub', sub);
  identitySwitch.searchParams.set('return_to', productWorkspace.toString());

  return NextResponse.redirect(identitySwitch.toString(), 303);
}
