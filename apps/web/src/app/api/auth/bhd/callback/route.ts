import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { identitySettings, openOidcState, secureCookies } from '@/lib/bhd/oauth';
import {
  hasDatabaseUrl,
  issueIdentitySession,
  type IssuedSession,
} from '@/lib/bhd/identity-session';
import {
  ORGANIZATION_COOKIE,
  rememberedOrganization,
  setSessionCookies,
} from '@/lib/bhd/session-cookies';
import {
  ROSTER_COOKIE,
  readRosterCookie,
  setRosterCookie,
  upsertRoster,
} from '@/lib/bhd/account-roster';

export const runtime = 'nodejs';

function classifySessionError(error: unknown): { code: string } {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[bhd callback] session detail', message.slice(0, 200));
  if (/identity_email_unverified/.test(message)) return { code: 'email_unverified' };
  if (/identity_email_taken/.test(message)) return { code: 'email_taken' };
  if (/Identity account cannot sign in|identity_account_missing|disabled/i.test(message)) {
    return { code: 'account' };
  }
  if (
    /identity_verify_failed|userinfo|access:|id_token:|jwks:|missing_access_token|missing_hs256/i.test(
      message,
    )
  ) {
    return { code: 'verify' };
  }
  if (/nonce/i.test(message)) return { code: 'verify_nonce' };
  if (/missing_sub|access_id_sub|authorized party/i.test(message)) {
    return { code: 'verify_claims' };
  }
  if (/identity_provision|membership|organization|insert|unique|constraint/i.test(message)) {
    return { code: 'upsert' };
  }
  if (
    /DATABASE|connect|ECONN|timeout|ssl|Neon|quota|402|exceeded the quota|compute.*suspend/i.test(
      message,
    )
  ) {
    return { code: 'db' };
  }
  if (/identity_session_issue|session_secret|BHD_R_SESSION_SECRET|CSRF_SECRET/i.test(message)) {
    return { code: 'session' };
  }
  return { code: 'session' };
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

  const {
    issuer,
    clientId,
    clientSecret,
    redirectUri: originRedirect,
  } = identitySettings(url.origin);
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
    .object({
      token_endpoint: z.string().url(),
      jwks_uri: z.string().url().optional(),
    })
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
    // Never log raw token-endpoint bodies (P1-03).
    console.error('[bhd callback] token exchange failed', tokenResponse.status);
    return clearAndRedirect('/ar/login?bhd=token');
  }
  const tokens = z
    .object({
      id_token: z.string().min(20),
      access_token: z.string().min(8).optional(),
    })
    .parse(await tokenResponse.json());

  if (!tokens.access_token) {
    return clearAndRedirect('/ar/login?bhd=verify');
  }

  let issued: IssuedSession;
  try {
    if (!hasDatabaseUrl()) {
      return clearAndRedirect('/ar/login?bhd=api');
    }
    const preferredOrganizationId = rememberedOrganization(
      cookieStore.get(ORGANIZATION_COOKIE)?.value,
    );
    issued = await issueIdentitySession({
      idToken: tokens.id_token,
      nonce: saved.nonce,
      accessToken: tokens.access_token,
      ...(discovery.jwks_uri ? { jwksUri: discovery.jwks_uri } : {}),
      ...(preferredOrganizationId ? { preferredOrganizationId } : {}),
    });
  } catch (error) {
    const classified = classifySessionError(error);
    console.error('[bhd callback] session', classified.code);
    // Correlation code only — no exception detail in the URL (P1-03).
    return clearAndRedirect(`/ar/login?bhd=${classified.code}`);
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
  setSessionCookies(response, issued);
  if (issued.rosterAccount) {
    const prior = readRosterCookie(cookieStore.get(ROSTER_COOKIE)?.value);
    setRosterCookie(response, upsertRoster(prior, issued.rosterAccount));
  }
  return response;
}
