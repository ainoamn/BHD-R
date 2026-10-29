import { DEFAULT_IDENTITY_ISSUER } from '@/lib/bhd/identity-public';
import { getCachedCatalogApps } from '@/lib/bhd/catalog';
import { captureWindowToken, windowFetchHeaders } from '@/lib/identity/window-session';

export function pageOrigin() {
  return typeof window === 'undefined' ? '' : window.location.origin.replace(/\/$/, '');
}

export function isIdentityOrigin(origin = pageOrigin()) {
  const here = origin.replace(/\/$/, '');
  return (
    here === DEFAULT_IDENTITY_ISSUER || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(here)
  );
}

export function identityApiUrl(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (isIdentityOrigin()) return normalized;
  return `${DEFAULT_IDENTITY_ISSUER}${normalized}`;
}

/** Always hit the identity host directly; attach this window's Bearer. */
export async function identityFetch(path: string, init?: RequestInit) {
  const headers = windowFetchHeaders(init?.headers);
  const response = await fetch(identityApiUrl(path), {
    cache: 'no-store',
    credentials: 'include',
    ...init,
    headers,
  });
  const clone = response.clone();
  void clone
    .json()
    .then((data: { token?: unknown } | null) => {
      if (data && typeof data.token === 'string') captureWindowToken(data.token);
    })
    .catch(() => undefined);
  return response;
}

export async function identityMe() {
  try {
    const response = await identityFetch('/api/auth/me');
    if (!response.ok) return null;
    return (await response.json()) as {
      authenticated?: boolean;
      user?: { id?: string; email?: string | null; name?: string | null } | null;
      accounts?: Array<{ id?: string; email?: string | null; name?: string | null }>;
    };
  } catch {
    return null;
  }
}

export function currentReturnPath() {
  if (typeof window === 'undefined') return '/ar/portal';
  return `${window.location.pathname}${window.location.search || ''}` || '/ar/portal';
}

export function cacheBustReturnPath(returnTo = '/') {
  const path = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/ar/portal';
  try {
    const url = new URL(path, 'https://bhd.local');
    url.searchParams.delete('_bhd');
    url.searchParams.set('_bhd', String(Date.now()));
    return `${url.pathname}${url.search}`;
  } catch {
    return path.includes('?') ? `${path}&_bhd=${Date.now()}` : `${path}?_bhd=${Date.now()}`;
  }
}

export function productStartPath(returnTo = '/ar/portal') {
  const path = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/ar/portal';
  return `/api/auth/bhd/start?returnTo=${encodeURIComponent(path)}`;
}

export function allowedBhdUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' &&
      !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url.origin)
    )
      return '';
    if (url.origin === DEFAULT_IDENTITY_ISSUER) return url.toString();
    if (getCachedCatalogApps().some((app) => app.origin.replace(/\/$/, '') === url.origin))
      return url.toString();
    if (
      url.hostname === 'bhd-om.com' ||
      url.hostname.endsWith('.bhd-om.com') ||
      url.hostname.endsWith('.vercel.app')
    )
      return url.toString();
  } catch {
    /* ignore */
  }
  return '';
}

export function addAccountUrl(returnPath?: string) {
  const path =
    returnPath ||
    (typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '/ar/portal');
  const safe = path.startsWith('/') && !path.startsWith('//') ? path : '/ar/portal';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://r.bhd-om.com';
  const start = new URL('/api/auth/bhd/start', origin);
  start.searchParams.set('returnTo', safe);
  const login = new URL(`${DEFAULT_IDENTITY_ISSUER}/login`);
  login.searchParams.set('add', '1');
  login.searchParams.set('return_to', start.toString());
  login.searchParams.set('next', `/auth/continue?to=${encodeURIComponent(start.toString())}`);
  return login.toString();
}

const REBIND_LOCK = 'bhd_rebind_lock';

export function isAccountRebindPending() {
  if (typeof sessionStorage === 'undefined') return false;
  const raw = sessionStorage.getItem(REBIND_LOCK);
  if (!raw) return false;
  const at = Number(raw);
  return Number.isFinite(at) && Date.now() - at < 15_000;
}

function markIsolationPending() {
  sessionStorage.setItem(REBIND_LOCK, String(Date.now()));
  try {
    document.documentElement.dataset.bhdSwitching = '1';
  } catch {
    /* ignore */
  }
}

function rebindWithWindowToken(token: string, returnTo: string) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/auth/bhd/rebind';
  form.style.display = 'none';
  const tokenInput = document.createElement('input');
  tokenInput.name = 'token';
  tokenInput.value = token;
  const returnInput = document.createElement('input');
  returnInput.name = 'returnTo';
  returnInput.value = cacheBustReturnPath(returnTo);
  form.append(tokenInput, returnInput);
  document.body.appendChild(form);
  form.submit();
}

export async function switchWindowAccount(
  sub: string,
): Promise<{ ok: boolean; token?: string; userId?: string }> {
  if (!sub) return { ok: false };
  const response = await identityFetch('/api/auth/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sub }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    token?: string;
    user?: { id?: string } | null;
  };
  if (typeof body.token === 'string') captureWindowToken(body.token);
  return {
    ok: response.ok,
    ...(typeof body.token === 'string' ? { token: body.token } : {}),
    ...(body.user?.id ? { userId: body.user.id } : {}),
  };
}

/** Bind this product tab to THIS window's identity account (POST rebind with Bearer). */
export async function applyAccountIsolation(token?: string | null, options?: { force?: boolean }) {
  if (typeof window === 'undefined') return;
  if (!options?.force && isAccountRebindPending()) return;
  const here = currentReturnPath();
  if (isIdentityOrigin()) {
    window.location.reload();
    return;
  }
  markIsolationPending();
  const windowToken = token || sessionStorage.getItem('bhd_window_token') || '';

  if (windowToken) {
    rebindWithWindowToken(windowToken, here);
    return;
  }

  try {
    const response = await identityFetch('/api/auth/window-handoff', { method: 'POST' });
    const data = (await response.json().catch(() => ({}))) as { ticket?: string };
    const start = new URL(
      productStartPath(cacheBustReturnPath(here)),
      window.location.origin,
    ).toString();
    if (response.ok && data.ticket) {
      const handoff = new URL('/auth/handoff', DEFAULT_IDENTITY_ISSUER);
      handoff.searchParams.set('ticket', data.ticket);
      handoff.searchParams.set('next', start);
      window.location.assign(handoff.toString());
      return;
    }
  } catch {
    /* fall through */
  }

  window.location.assign(
    `/api/auth/bhd/logout?continue=${encodeURIComponent(productStartPath(cacheBustReturnPath(here)))}`,
  );
}

export function clearAccountRebindLock() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(REBIND_LOCK);
  try {
    delete document.documentElement.dataset.bhdSwitching;
  } catch {
    /* ignore */
  }
}
