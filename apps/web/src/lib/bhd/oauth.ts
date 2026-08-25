import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type OidcState = {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  /** Captured at /start so callback uses the same redirect_uri (Nasab/WAZEN pattern). */
  redirectUri?: string;
};

function cleanEnv(value: string | undefined): string {
  return (
    value
      ?.replace(/^\uFEFF/, '')
      .replace(/\\r\\n$/gi, '')
      .replace(/\\n$/gi, '')
      .replace(/\r\n$/g, '')
      .replace(/\n$/g, '')
      .trim() || ''
  );
}

export function identitySettings(origin: string) {
  const issuer = (cleanEnv(process.env.BHD_IDENTITY_ISSUER) || 'https://id.bhd-om.com').replace(
    /\/$/,
    '',
  );
  const clientId =
    cleanEnv(process.env.BHD_OAUTH_CLIENT_ID) ||
    cleanEnv(process.env.BHD_IDENTITY_CLIENT_ID) ||
    'bhd-r';
  const clientSecret =
    cleanEnv(process.env.BHD_OAUTH_CLIENT_SECRET) ||
    cleanEnv(process.env.BHD_IDENTITY_CLIENT_SECRET) ||
    '';
  // Always bind redirect_uri to the request host so Host-only OAuth cookies stay aligned.
  const redirectUri = `${origin.replace(/\/$/, '')}/api/auth/bhd/callback`;
  return { issuer, clientId, clientSecret, redirectUri };
}

function cookieSecret(): string {
  return (
    cleanEnv(process.env.BHD_R_SESSION_SECRET) ||
    'development-session-secret-at-least-32-characters'
  );
}

export function sealOidcState(value: OidcState): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', cookieSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function openOidcState(value: string): OidcState {
  const [payload, supplied, extra] = value.split('.');
  if (!payload || !supplied || extra) throw new Error('Malformed OIDC state');
  const expected = createHmac('sha256', cookieSecret()).update(payload).digest('base64url');
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error('OIDC state signature mismatch');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OidcState;
}

export function createPkce(): {
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
} {
  const state = randomBytes(24).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { state, nonce, verifier, challenge };
}

export function safeReturnTo(raw: string | null | undefined, fallback = '/ar/portal'): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://') || raw.includes('\\')) {
    return fallback;
  }
  return raw;
}

export function secureCookies(): boolean {
  return (
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production')
  );
}
