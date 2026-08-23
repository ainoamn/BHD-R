import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  identitySettings,
  openOidcState,
  secureCookies,
} from '@/lib/bhd/oauth';
import { hasDatabaseUrl, issueIdentitySession } from '@/lib/bhd/identity-session';

export const runtime = 'nodejs';

/** GET /api/auth/bhd/callback — required by BHD-PRODUCT-SSO-ADMIN §3.1 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  const cookieStore = await cookies();
  const cookie = cookieStore.get('bhd_oauth_state')?.value;

  const clearAndRedirect = (path: string, status = 302) => {
    const response = NextResponse.redirect(new URL(path, url.origin), status);
    response.cookies.set({
      name: 'bhd_oauth_state',
      value: '',
      httpOnly: true,
      secure: secureCookies(),
      sameSite: 'lax',
      path: '/api/auth/bhd',
      maxAge: 0,
    });
    return response;
  };

  if (oauthError) return clearAndRedirect(`/ar/login?bhd=${encodeURIComponent(oauthError)}`);
  if (!cookie || !code || !state) return clearAndRedirect('/ar/login?bhd=state');

  let saved: ReturnType<typeof openOidcState>;
  try {
    saved = openOidcState(cookie);
  } catch {
    return clearAndRedirect('/ar/login?bhd=state');
  }
  if (saved.state !== state) return clearAndRedirect('/ar/login?bhd=state');

  const { issuer, clientId, clientSecret, redirectUri } = identitySettings(url.origin);
  const discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(5_000),
    redirect: 'error',
  });
  if (!discoveryResponse.ok) return clearAndRedirect('/ar/login?bhd=discovery');
  const discovery = z
    .object({ token_endpoint: z.string().url() })
    .parse(await discoveryResponse.json());
  const tokenEndpoint = new URL(discovery.token_endpoint);
  if (tokenEndpoint.origin !== new URL(issuer).origin || tokenEndpoint.protocol !== 'https:') {
    return clearAndRedirect('/ar/login?bhd=unsafe');
  }

  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
    redirect: 'error',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenResponse.ok) return clearAndRedirect('/ar/login?bhd=token');
  const tokens = z.object({ id_token: z.string().min(20) }).parse(await tokenResponse.json());

  let issued: { token: string; csrf: string };
  try {
    if (hasDatabaseUrl()) {
      issued = await issueIdentitySession({
        idToken: tokens.id_token,
        nonce: saved.nonce,
      });
    } else {
      const apiOrigin = (process.env.API_INTERNAL_ORIGIN ?? process.env.API_ORIGIN ?? '').replace(
        /\/$/,
        '',
      );
      const apiPublic =
        /^https:\/\//i.test(apiOrigin) &&
        !/localhost|127\.0\.0\.1|\.local|\.internal/i.test(apiOrigin);

      if (!apiPublic && process.env.VERCEL) {
        return clearAndRedirect('/ar/login?bhd=api');
      }

      const sessionApi = apiPublic
        ? `${apiOrigin}/v1/auth/identity/session`
        : `${process.env.API_INTERNAL_ORIGIN ?? 'http://127.0.0.1:4000'}/v1/auth/identity/session`;

      const sessionResponse = await fetch(sessionApi, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: tokens.id_token, nonce: saved.nonce }),
      }).catch(() => null);

      if (!sessionResponse?.ok) {
        const codeHint = sessionResponse?.status === 401 ? 'account' : 'session';
        return clearAndRedirect(`/ar/login?bhd=${codeHint}`);
      }

      issued = z
        .object({ token: z.string().min(20), csrf: z.string().min(8) })
        .parse(await sessionResponse.json());
    }
  } catch {
    return clearAndRedirect('/ar/login?bhd=session');
  }

  const response = clearAndRedirect(saved.returnTo);
  response.cookies.set({
    name: 'bhd_r_session',
    value: issued.token,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  response.cookies.set({
    name: 'bhd_r_csrf',
    value: issued.csrf,
    httpOnly: false,
    secure: secureCookies(),
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  return response;
}
