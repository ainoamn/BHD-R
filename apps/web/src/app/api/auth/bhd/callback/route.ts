import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { identitySettings, openOidcState, secureCookies } from '@/lib/bhd/oauth';
import { hasDatabaseUrl, issueIdentitySession } from '@/lib/bhd/identity-session';

export const runtime = 'nodejs';

function classifySessionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[bhd callback] session detail', message);
  if (/userinfo/i.test(message)) return 'verify_userinfo';
  if (/nonce/i.test(message)) return 'verify_nonce';
  if (/audience|issuer|azp|authorized party|missing_sub/i.test(message)) return 'verify_claims';
  if (/missing_hs256|JWKS|jwt|jws|signature|alg|secret|ERR_JOSE|ERR_JWS|ERR_JWT/i.test(message)) {
    return 'verify';
  }
  if (/DATABASE|connect|ECONN|timeout|ssl|Neon/i.test(message)) return 'db';
  if (/membership|organization|insert|unique|constraint/i.test(message)) return 'upsert';
  return 'session';
}

function clearOauthCookie(response: NextResponse) {
  for (const path of ['/', '/api/auth/bhd'] as const) {
    response.cookies.set({
      name: 'bhd_oauth_state',
      value: '',
      httpOnly: true,
      secure: secureCookies(),
      sameSite: 'lax',
      path,
      maxAge: 0,
    });
  }
  return response;
}

/** GET /api/auth/bhd/callback — same product flow as Nasab / WAZEN / bhd-om */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  const cookieStore = await cookies();
  const cookie = cookieStore.get('bhd_oauth_state')?.value;

  const clearAndRedirect = (path: string, status = 302) => {
    const response = NextResponse.redirect(new URL(path, url.origin), status);
    return clearOauthCookie(response);
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

  const { issuer, clientId, clientSecret, redirectUri: originRedirect } = identitySettings(
    url.origin,
  );
  // Prefer redirect_uri sealed at /start (Nasab pattern); fall back to this host.
  const redirectUri =
    typeof saved.redirectUri === 'string' && saved.redirectUri.startsWith('https://')
      ? saved.redirectUri
      : originRedirect;
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

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: saved.verifier,
  });
  if (clientSecret) tokenBody.set('client_secret', clientSecret);

  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
    redirect: 'error',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });
  if (!tokenResponse.ok) {
    console.error('[bhd callback] token', tokenResponse.status, await tokenResponse.text());
    return clearAndRedirect('/ar/login?bhd=token');
  }
  const tokens = z
    .object({
      id_token: z.string().min(20),
      access_token: z.string().min(8).optional(),
    })
    .parse(await tokenResponse.json());

  let issued: { token: string; csrf: string };
  try {
    if (!hasDatabaseUrl()) {
      return clearAndRedirect('/ar/login?bhd=api');
    }
    issued = await issueIdentitySession({
      idToken: tokens.id_token,
      nonce: saved.nonce,
      ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
    });
  } catch (error) {
    console.error('[bhd callback] session', error);
    return clearAndRedirect(`/ar/login?bhd=${classifySessionError(error)}`);
  }

  const response = clearAndRedirect(saved.returnTo);
  response.cookies.set({
    name: 'bhd_r_session',
    value: '',
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set({
    name: 'bhd_r_csrf',
    value: '',
    httpOnly: false,
    secure: secureCookies(),
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
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
