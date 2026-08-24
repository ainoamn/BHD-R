import { NextResponse } from 'next/server';
import {
  createPkce,
  identitySettings,
  safeReturnTo,
  sealOidcState,
  secureCookies,
} from '@/lib/bhd/oauth';

export const runtime = 'nodejs';

/** GET /api/auth/bhd/start — required by BHD-PRODUCT-SSO-ADMIN §3.1 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { issuer, clientId, redirectUri } = identitySettings(url.origin);
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
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
  }).toString();

  if (!authorization.hostname.endsWith('bhd-om.com') && authorization.hostname !== 'localhost') {
    return NextResponse.json({ error: 'Unsafe identity host' }, { status: 500 });
  }

  const response = NextResponse.redirect(authorization.toString(), 302);
  response.cookies.set({
    name: 'bhd_oauth_state',
    value: sealOidcState({ state, nonce, verifier, returnTo }),
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/api/auth/bhd',
    maxAge: 300,
  });
  return response;
}
