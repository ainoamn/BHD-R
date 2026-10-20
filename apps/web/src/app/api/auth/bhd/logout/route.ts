import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { verifySessionToken } from '@bhd-r/authz';
import { createDatabase, sessions, users } from '@bhd-r/db';
import {
  ROSTER_COOKIE,
  clearRosterCookie,
  readRosterCookie,
  setRosterCookie,
} from '@/lib/bhd/account-roster';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { identitySettings, safeReturnTo, secureCookies } from '@/lib/bhd/oauth';
import { requireSessionSecret } from '@/lib/runtime-env';

export const runtime = 'nodejs';

async function revokeCurrentSession(): Promise<{ identitySub: string | null }> {
  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token || !hasDatabaseUrl()) return { identitySub: null };
  try {
    const claims = await verifySessionToken(token, requireSessionSecret());
    const { client, db } = createDatabase(process.env.DATABASE_URL!.trim(), { max: 1 });
    try {
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.id, claims.sid),
            eq(sessions.userId, claims.sub),
            isNull(sessions.revokedAt),
          ),
        );
      const row = await db.query.users.findFirst({
        where: eq(users.id, claims.sub),
        columns: { identitySubject: true },
      });
      return { identitySub: row?.identitySubject?.trim() || null };
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error('[bhd logout] revoke failed', error instanceof Error ? error.message : error);
    return { identitySub: null };
  }
}

function clearProductSessionCookies(response: NextResponse) {
  for (const name of ['bhd_r_session', 'bhd_r_csrf', 'bhd_oauth_state'] as const) {
    const paths = name === 'bhd_oauth_state' ? (['/', '/api/auth/bhd'] as const) : (['/'] as const);
    for (const path of paths) {
      response.cookies.set({
        name,
        value: '',
        httpOnly: name !== 'bhd_r_csrf',
        secure: secureCookies(),
        sameSite: name === 'bhd_r_csrf' ? 'strict' : 'lax',
        path,
        maxAge: 0,
      });
    }
  }
}

/**
 * Explicit logout only (BHD-SESSION-POLICY):
 * - this account + others remain → prune roster, identity switch to next, silent product start
 * - this account alone → end-session (registered post_logout home)
 * - all=1 → clear roster + end-session?all=1
 */
async function logout(request: Request) {
  const url = new URL(request.url);
  const { issuer, clientId } = identitySettings(url.origin);
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ar';
  const all = url.searchParams.get('all') === '1';
  const cookieStore = await cookies();
  const roster = readRosterCookie(cookieStore.get(ROSTER_COOKIE)?.value);

  const { identitySub } = await revokeCurrentSession();

  const home =
    process.env.BHD_OAUTH_POST_LOGOUT_REDIRECT_URI?.trim() || `${url.origin}/${locale}`;
  const portalReturn = safeReturnTo(null, `/${locale}/portal`);

  const remaining = identitySub
    ? roster.filter((item) => item.sub !== identitySub)
    : roster.slice(1);

  if (all) {
    const endSession = new URL(`${issuer}/oauth/end-session`);
    endSession.search = new URLSearchParams({
      client_id: clientId,
      post_logout_redirect_uri: home,
      all: '1',
    }).toString();
    const response = NextResponse.redirect(endSession.toString(), 303);
    clearProductSessionCookies(response);
    clearRosterCookie(response);
    return response;
  }

  if (remaining.length > 0) {
    const next = remaining[0]!;
    const switchUrl = new URL('/api/auth/switch', url.origin);
    switchUrl.searchParams.set('sub', next.sub);
    switchUrl.searchParams.set('locale', locale);
    switchUrl.searchParams.set('returnTo', portalReturn);
    const response = NextResponse.redirect(switchUrl.toString(), 303);
    clearProductSessionCookies(response);
    setRosterCookie(response, remaining);
    return response;
  }

  const endSession = new URL(`${issuer}/oauth/end-session`);
  endSession.search = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: home,
  }).toString();
  const response = NextResponse.redirect(endSession.toString(), 303);
  clearProductSessionCookies(response);
  clearRosterCookie(response);
  return response;
}

function isCrossSite(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  return site === 'cross-site' || site === 'same-site';
}

/** Legacy GET kept for user-initiated navigation only; cross-site requests never log out silently. */
export async function GET(request: Request) {
  if (isCrossSite(request)) {
    return NextResponse.redirect(new URL('/', request.url), 303);
  }
  return logout(request);
}

export async function POST(request: Request) {
  if (isCrossSite(request)) {
    return NextResponse.json({ error: { code: 'csrf_rejected' } }, { status: 403 });
  }
  return logout(request);
}
