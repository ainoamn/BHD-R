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
import {
  createPkce,
  identitySettings,
  safeReturnTo,
  sealOidcState,
  secureCookies,
} from '@/lib/bhd/oauth';
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
 * One-shot invite login: revoke the current product session (if any), then start
 * OIDC with login_hint for the invitee. Does not cycle other roster accounts.
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

  const { issuer, clientId, redirectUri } = identitySettings(url.origin);
  const { state, nonce, verifier, challenge } = createPkce();
  const authorization = new URL(`${issuer}/oauth/authorize`);
  authorization.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    login_hint: email,
    prompt: 'login',
  }).toString();

  const response = NextResponse.redirect(authorization.toString(), 303);
  clearProductSessionCookies(response);
  if (remaining.length > 0) setRosterCookie(response, remaining);
  else clearRosterCookie(response);
  response.cookies.set({
    name: 'bhd_oauth_state',
    value: sealOidcState({ state, nonce, verifier, returnTo, redirectUri }),
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: 300,
  });
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
