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
export const dynamic = 'force-dynamic';

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
 * One-shot invite login: revoke the current product session (if any), then open
 * Identity's login page (add-account) so the invitee can sign in. Continues to
 * /api/auth/bhd/start with returnTo = the payment page.
 *
 * Going through /login?add=1 avoids silently reusing the wrong SSO session
 * (authorize+prompt=login alone can bounce back without a visible login form).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ar';
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'), `/${locale}`);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase().slice(0, 320);
  if (!email.includes('@') || /[\s<>]/.test(email)) {
    return NextResponse.redirect(new URL(`/${locale}`, url.origin), 303);
  }

  // Revoke current product session only — leave other roster entries intact.
  const cookieStore = await cookies();
  const token = cookieStore.get('bhd_r_session')?.value;
  let currentIdentitySub: string | null = null;
  if (token && hasDatabaseUrl()) {
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
        currentIdentitySub = row?.identitySubject?.trim() || null;
      } finally {
        await client.end();
      }
    } catch {
      /* ignore — still clear cookies and continue to login */
    }
  }

  const roster = readRosterCookie(cookieStore.get(ROSTER_COOKIE)?.value);
  const remaining = currentIdentitySub
    ? roster.filter((item) => item.sub !== currentIdentitySub)
    : roster;

  const { issuer } = identitySettings(url.origin);

  // After Identity login, continue into product OIDC start → callback → payment page.
  const start = new URL('/api/auth/bhd/start', url.origin);
  start.searchParams.set('returnTo', returnTo);
  start.searchParams.set('login_hint', email);
  start.searchParams.set('prompt', 'login');

  const login = new URL(`${issuer}/login`);
  login.searchParams.set('add', '1');
  login.searchParams.set('login_hint', email);
  login.searchParams.set('hint', email);
  login.searchParams.set('return_to', start.toString());
  login.searchParams.set('next', `/auth/continue?to=${encodeURIComponent(start.toString())}`);

  const response = NextResponse.redirect(login.toString(), 303);
  clearProductSessionCookies(response);
  if (remaining.length > 0) setRosterCookie(response, remaining);
  else clearRosterCookie(response);
  // Mark this payment return so a wrong account does not auto-loop.
  response.cookies.set({
    name: 'bhd_invite_login',
    value: email,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return response;
}
