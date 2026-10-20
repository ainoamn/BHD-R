import {
  createRemoteJWKSet,
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

function assertNonceAndSub(
  payload: JWTPayload,
  expectedNonce: string,
): asserts payload is JWTPayload & { sub: string; nonce: string } {
  if (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonce) {
    throw new Error('OIDC nonce validation failed');
  }
  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new Error('missing_sub');
  }
}

/**
 * Product-local identity verify (Nasab/WAZEN / bhd-identity.v1).
 * RS256/ES256 use discovery JWKS; HS256 uses shared secret or access_token/userinfo.
 */
export async function verifyBhdIdToken(input: {
  token: string;
  issuer: string;
  clientId: string;
  expectedNonce: string;
  sharedSecret?: string;
  accessToken?: string;
  jwksUri?: string;
}): Promise<{
  subject: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  username?: string;
  phone?: string;
  providers?: Array<'password' | 'google' | 'facebook' | 'whatsapp'>;
}> {
  const issuer = input.issuer.replace(/\/$/, '');
  const header = decodeProtectedHeader(input.token);
  const alg = header.alg;
  if (alg && alg !== 'HS256' && alg !== 'RS256' && alg !== 'ES256') {
    throw new Error(`unsupported_id_token_alg:${alg}`);
  }

  const sharedSecret = cleanSecret(input.sharedSecret);
  const key = sharedSecret ? new TextEncoder().encode(sharedSecret) : undefined;
  const errors: string[] = [];
  const verifyOptions = { issuer, audience: input.clientId, clockTolerance: 60 } as const;

  // 0) Asymmetric id_token via JWKS (P1-03).
  if (alg === 'RS256' || alg === 'ES256') {
    try {
      const jwks = createRemoteJWKSet(new URL(input.jwksUri ?? `${issuer}/oauth/jwks.json`));
      const { payload } = await jwtVerify(input.token, jwks, {
        ...verifyOptions,
        algorithms: ['RS256', 'ES256'],
      });
      assertNonceAndSub(payload, input.expectedNonce);
      return toIdentity(payload);
    } catch (error) {
      errors.push(`jwks:${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`identity_verify_failed:${errors.join('|')}`);
    }
  }

  // 1) Prove possession via access_token signature (same IDENTITY_TOKEN_SECRET as Identity).
  if (input.accessToken && key) {
    try {
      const { payload: access } = await jwtVerify(input.accessToken, key, {
        issuer,
        algorithms: ['HS256'],
        clockTolerance: 60,
      });
      if (access.token_use !== 'access') throw new Error('not_access_token');
      const idClaims = decodeJwt(input.token);
      if (idClaims.sub !== access.sub) throw new Error('access_id_sub_mismatch');
      assertNonceAndSub(idClaims, input.expectedNonce);
      return toIdentity(idClaims);
    } catch (error) {
      errors.push(`access:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 2) /oauth/userinfo — Identity validates the bearer with its own secret.
  if (input.accessToken) {
    try {
      const payload = await claimsFromUserinfo(issuer, input.accessToken, input.token);
      assertNonceAndSub(payload, input.expectedNonce);
      return toIdentity(payload);
    } catch (error) {
      errors.push(`userinfo:${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    errors.push('userinfo:missing_access_token');
  }

  // 3) Direct id_token HS256 (requires product secret == Identity secret).
  if (key && (alg === 'HS256' || !alg)) {
    try {
      const { payload } = await jwtVerify(input.token, key, {
        ...verifyOptions,
        algorithms: ['HS256'],
      });
      assertNonceAndSub(payload, input.expectedNonce);
      return toIdentity(payload);
    } catch (error) {
      errors.push(`id_token:${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (!key) {
    errors.push('id_token:missing_hs256_secret');
  }

  throw new Error(`identity_verify_failed:${errors.join('|')}`);
}

const AUTH_PROVIDERS = ['password', 'google', 'facebook', 'whatsapp'] as const;

function toIdentity(payload: JWTPayload): {
  subject: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  username?: string;
  phone?: string;
  providers?: Array<'password' | 'google' | 'facebook' | 'whatsapp'>;
} {
  const providers = Array.isArray(payload.providers)
    ? payload.providers.filter(
        (item): item is (typeof AUTH_PROVIDERS)[number] =>
          typeof item === 'string' &&
          (AUTH_PROVIDERS as readonly string[]).includes(item),
      )
    : undefined;
  return {
    subject: String(payload.sub),
    ...(typeof payload.email === 'string' && payload.email.includes('@')
      ? { email: payload.email }
      : {}),
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    ...(typeof payload.picture === 'string' && payload.picture.startsWith('http')
      ? { picture: payload.picture }
      : {}),
    ...(typeof payload.preferred_username === 'string'
      ? { username: payload.preferred_username }
      : typeof payload.username === 'string'
        ? { username: payload.username }
        : {}),
    ...(typeof payload.phone_number === 'string'
      ? { phone: payload.phone_number }
      : typeof payload.phone === 'string'
        ? { phone: payload.phone }
        : {}),
    ...(providers?.length ? { providers } : {}),
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
      picture: z.union([z.string(), z.null()]).optional(),
      username: z.union([z.string(), z.null()]).optional(),
      preferred_username: z.union([z.string(), z.null()]).optional(),
      phone: z.union([z.string(), z.null()]).optional(),
      phone_number: z.union([z.string(), z.null()]).optional(),
      providers: z.array(z.string()).optional(),
    })
    .parse(await response.json());
  if (info.sub !== decoded.sub) throw new Error('userinfo_sub_mismatch');
  return {
    ...decoded,
    sub: info.sub,
    ...(typeof info.email === 'string' && info.email.includes('@') ? { email: info.email } : {}),
    email_verified: info.email_verified === true,
    ...(typeof info.name === 'string' ? { name: info.name } : {}),
    ...(typeof info.picture === 'string' ? { picture: info.picture } : {}),
    ...(typeof info.preferred_username === 'string'
      ? { preferred_username: info.preferred_username }
      : typeof info.username === 'string'
        ? { username: info.username }
        : {}),
    ...(typeof info.phone_number === 'string'
      ? { phone_number: info.phone_number }
      : typeof info.phone === 'string'
        ? { phone: info.phone }
        : {}),
    ...(info.providers ? { providers: info.providers } : {}),
  };
}
