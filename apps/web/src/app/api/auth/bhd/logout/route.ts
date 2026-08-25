import { NextResponse } from 'next/server';
import { identitySettings, secureCookies } from '@/lib/bhd/oauth';

export const runtime = 'nodejs';

/** GET /api/auth/bhd/logout — clear product session then identity end-session */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { issuer, clientId } = identitySettings(url.origin);
  const postLogout = process.env.BHD_OAUTH_POST_LOGOUT_REDIRECT_URI ?? `${url.origin}/`;

  const endSession = new URL(`${issuer}/oauth/end-session`);
  endSession.search = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: postLogout,
  }).toString();

  const response = NextResponse.redirect(endSession.toString(), 302);
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

export async function POST(request: Request) {
  return GET(request);
}
