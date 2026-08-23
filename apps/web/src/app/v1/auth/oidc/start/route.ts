import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Fallback OIDC start when API rewrite is unavailable (e.g. Vercel web without public API).
 * Full session creation still requires Nest API + DB after Identity returns the code.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const issuer = (process.env.BHD_IDENTITY_ISSUER ?? 'https://id.bhd-om.com').replace(/\/$/, '');
  const clientId =
    process.env.BHD_OAUTH_CLIENT_ID ?? process.env.BHD_IDENTITY_CLIENT_ID ?? 'bhd-r';
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.PUBLIC_SITE_URL ??
    url.origin
  ).replace(/\/$/, '');
  const redirectUri =
    process.env.BHD_OAUTH_REDIRECT_URI ??
    process.env.BHD_IDENTITY_REDIRECT_URI ??
    `${siteUrl}/v1/auth/oidc/callback`;

  const requestedReturnTo = url.searchParams.get('returnTo') ?? '/ar/portal';
  const returnTo =
    requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//')
      ? requestedReturnTo
      : '/ar/portal';

  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const authorization = new URL(`${issuer}/oauth/authorize`);
  authorization.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  const response = NextResponse.redirect(authorization.toString());
  response.cookies.set({
    name: 'bhd_r_oidc',
    value: Buffer.from(JSON.stringify({ state, nonce, verifier, returnTo }), 'utf8').toString(
      'base64url',
    ),
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== 'false',
    sameSite: 'lax',
    path: '/v1/auth/oidc',
    maxAge: 600,
  });
  return response;
}
