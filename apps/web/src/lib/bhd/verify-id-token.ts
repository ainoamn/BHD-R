import {
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import { z } from 'zod';

function cleanSecret(value: string | undefined): string | undefined {
  return (
    value
      ?.replace(/^\uFEFF/, '')
      .replace(/\\r\\n$/gi, '')
      .replace(/\\n$/gi, '')
      .replace(/\r\n$/g, '')
      .replace(/\n$/g, '')
      .trim() || undefined
  );
}

/**
 * Product-local identity verify (Nasab/WAZEN pattern).
 * Kept inside apps/web so Vercel Root Directory deploys cannot ship a stale @bhd-r/authz dist.
 */
export async function verifyBhdIdToken(input: {
  token: string;
  issuer: string;
  clientId: string;
  expectedNonce: string;
  sharedSecret?: string;
  accessToken?: string;
}): Promise<{ subject: string; email?: string; emailVerified: boolean; name?: string }> {
  const issuer = input.issuer.replace(/\/$/, '');
  const header = decodeProtectedHeader(input.token);
  const alg = header.alg;
  const verifyOptions = { issuer, audience: input.clientId, clockTolerance: 30 } as const;

  let payload: JWTPayload;

  if (alg === 'RS256' || alg === 'ES256') {
    throw new Error('jwks_empty_use_hs256_or_userinfo');
  }

  if (alg !== 'HS256') {
    throw new Error(`unsupported_id_token_alg:${alg ?? 'unknown'}`);
  }

  // After PKCE code exchange, userinfo is the durable path while Identity JWKS is empty.
  if (input.accessToken) {
    try {
      payload = await claimsFromUserinfo(issuer, input.accessToken, input.token);
    } catch (userinfoError) {
      const sharedSecret = cleanSecret(input.sharedSecret);
      if (!sharedSecret) throw userinfoError;
      try {
        ({ payload } = await jwtVerify(input.token, new TextEncoder().encode(sharedSecret), {
          ...verifyOptions,
          algorithms: ['HS256'],
        }));
      } catch {
        throw userinfoError;
      }
    }
  } else {
    const sharedSecret = cleanSecret(input.sharedSecret);
    if (!sharedSecret) throw new Error('missing_hs256_secret');
    ({ payload } = await jwtVerify(input.token, new TextEncoder().encode(sharedSecret), {
      ...verifyOptions,
      algorithms: ['HS256'],
    }));
  }

  if (typeof payload.nonce !== 'string' || payload.nonce !== input.expectedNonce) {
    throw new Error('OIDC nonce validation failed');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('missing_sub');
  }

  return {
    subject: payload.sub,
    ...(typeof payload.email === 'string' && payload.email.includes('@')
      ? { email: payload.email }
      : {}),
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
  };
}

async function claimsFromUserinfo(
  issuer: string,
  accessToken: string,
  idToken: string,
): Promise<JWTPayload> {
  const decoded = decodeJwt(idToken);
  const response = await fetch(`${issuer}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`userinfo_failed:${response.status}`);
  }
  const info = z
    .object({
      sub: z.string().min(1),
      email: z.union([z.string(), z.null()]).optional(),
      email_verified: z.union([z.boolean(), z.null()]).optional(),
      name: z.union([z.string(), z.null()]).optional(),
    })
    .parse(await response.json());
  if (info.sub !== decoded.sub) throw new Error('userinfo_sub_mismatch');
  return {
    ...decoded,
    sub: info.sub,
    ...(typeof info.email === 'string' && info.email.includes('@') ? { email: info.email } : {}),
    email_verified: info.email_verified === true,
    ...(typeof info.name === 'string' ? { name: info.name } : {}),
  };
}
