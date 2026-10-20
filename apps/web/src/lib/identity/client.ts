/**
 * BHD identity browser helpers — BHD-ACCOUNT-SWITCHER.
 * Call the identity host directly (CORS + credentials). Do not proxy through
 * the product `/api/auth/me` when listing or switching accounts.
 */

export const IDENTITY_ORIGIN = 'https://id.bhd-om.com';

export type IdentityUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  username?: string | null;
  phone?: string | null;
  picture?: string | null;
  providers?: string[];
};

export type IdentityMe = {
  authenticated?: boolean;
  user?: IdentityUser | null;
  accounts?: IdentityUser[];
};

/** `fetch` against id.bhd-om.com with cookies (bhd_id / roster). */
export async function identityFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${IDENTITY_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return fetch(url, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers,
  });
}

export async function identityMe(): Promise<IdentityMe | null> {
  try {
    const response = await identityFetch('/api/auth/me');
    if (!response.ok) return null;
    return (await response.json()) as IdentityMe;
  } catch {
    return null;
  }
}

/**
 * After identity switch (or silent SSO mismatch): rebind the product session to
 * the active identity account via SSO start. Clears prior product cookies/data.
 */
export function applyAccountIsolation(returnPath?: string): void {
  if (typeof window === 'undefined') return;
  const path =
    returnPath ||
    `${window.location.pathname}${window.location.search}${window.location.hash}` ||
    '/';
  const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/';
  const start = new URL('/api/auth/bhd/start', window.location.origin);
  start.searchParams.set('returnTo', safe);
  window.location.assign(start.toString());
}

/**
 * Only path that may open `/login?add=1`. Never use this for account switch.
 * Product return goes through SSO start so the new account binds here.
 */
export function addAccountUrl(returnPath?: string): string {
  const path =
    returnPath ||
    (typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '/');
  const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://r.bhd-om.com';
  const start = new URL('/api/auth/bhd/start', origin);
  start.searchParams.set('returnTo', safe);

  const login = new URL(`${IDENTITY_ORIGIN}/login`);
  login.searchParams.set('add', '1');
  login.searchParams.set('return_to', start.toString());
  // Identity portals that prefer `next` + continue (BHD-ACCOUNT-SWITCHER §4).
  login.searchParams.set('next', `/auth/continue?to=${encodeURIComponent(start.toString())}`);
  return login.toString();
}
