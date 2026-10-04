import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { verifySessionToken } from '@bhd-r/authz';
import { createDatabase, sessions } from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { identitySettings, secureCookies } from '@/lib/bhd/oauth';
import { requireSessionSecret } from '@/lib/runtime-env';

export const runtime = 'nodejs';

async function revokeCurrentSession(): Promise<void> {
  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token || !hasDatabaseUrl()) return;
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
    } finally {
      await client.end();
    }
  } catch (error) {
    console.error('[bhd logout] revoke failed', error instanceof Error ? error.message : error);
  }
}

/** Explicit logout only (BHD-SESSION-POLICY): revoke product session, clear cookies, end Identity session. */
async function logout(request: Request) {
  const url = new URL(request.url);
  const { issuer, clientId } = identitySettings(url.origin);
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ar';
  // Land on locale home directly — `/` only flashes then redirects via next-intl.
  const postLogout =
    process.env.BHD_OAUTH_POST_LOGOUT_REDIRECT_URI?.trim() || `${url.origin}/${locale}`;

  await revokeCurrentSession();

  const endSession = new URL(`${issuer}/oauth/end-session`);
  endSession.search = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: postLogout,
  }).toString();

  const response = NextResponse.redirect(endSession.toString(), 303);
  for (const name of ['bhd_r_session', 'bhd_r_csrf', 'bhd_oauth_state']) {
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
