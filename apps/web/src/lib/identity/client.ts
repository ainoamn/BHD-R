import { DEFAULT_IDENTITY_ISSUER } from '@/lib/bhd/identity-public';
import { getCachedCatalogApps } from '@/lib/bhd/catalog';
import {
  boundWindowToken,
  captureAccountToken,
  captureWindowToken,
  readActiveAu,
  setActiveAu,
  tokenForAccount,
  windowFetchHeaders,
} from '@/lib/identity/window-session';

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
    .then((data: { token?: unknown; user?: { id?: string } | null } | null) => {
      if (!data || typeof data.token !== 'string') return;
      const sub = typeof data.user?.id === 'string' ? data.user.id : readActiveAu();
      if (sub) captureAccountToken(sub, data.token);
      else captureWindowToken(data.token);
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

export function accountBoundPath(returnTo = '/ar/portal', sub?: string | null) {
  const path = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/ar/portal';
  const au = (sub || readActiveAu() || '').trim();
  try {
    const url = new URL(path, 'https://bhd.local');
    url.searchParams.delete('_bhd');
    if (au) url.searchParams.set('au', au);
    else url.searchParams.delete('au');
    return `${url.pathname}${url.search}`;
  } catch {
    return path;
  }
}

export function accountBoundReturnPath(returnTo = '/ar/portal', sub?: string | null) {
  const path = accountBoundPath(returnTo, sub);
  try {
    const url = new URL(path, 'https://bhd.local');
    url.searchParams.set('_bhd', String(Date.now()));
    return `${url.pathname}${url.search}`;
  } catch {
    return path.includes('?') ? `${path}&_bhd=${Date.now()}` : `${path}?_bhd=${Date.now()}`;
  }
}

export function scrubCacheBustFromUrl() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('_bhd')) return;
    url.searchParams.delete('_bhd');
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', next || '/ar/portal');
  } catch {
    /* ignore */
  }
}

export function cacheBustReturnPath(returnTo = '/ar/portal', sub?: string | null) {
  return accountBoundReturnPath(returnTo, sub);
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
  return Number.isFinite(at) && Date.now() - at < 12_000;
}

export function paintPrivacyVeil(_message?: string) {
  if (typeof document === 'undefined') return;
  try {
    document.documentElement.dataset.bhdSwitching = '1';
    let veil = document.getElementById('bhd-privacy-veil');
    if (!veil) {
      veil = document.createElement('div');
      veil.id = 'bhd-privacy-veil';
      veil.setAttribute('aria-hidden', 'true');
      veil.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:var(--ink-900,#092d24);pointer-events:none';
      document.body.appendChild(veil);
    }
  } catch {
    /* ignore */
  }
}

function markIsolationPending() {
  sessionStorage.setItem(REBIND_LOCK, String(Date.now()));
  paintPrivacyVeil();
}

function rebindWithWindowToken(token: string, returnTo: string, sub?: string | null) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/auth/bhd/rebind';
  form.style.display = 'none';
  const tokenInput = document.createElement('input');
  tokenInput.name = 'token';
  tokenInput.value = token;
  const returnInput = document.createElement('input');
  returnInput.name = 'returnTo';
  returnInput.value = accountBoundReturnPath(returnTo, sub);
  form.append(tokenInput, returnInput);
  document.body.appendChild(form);
  form.submit();
}

export async function silentRebind(
  token?: string | null,
  sub?: string | null,
): Promise<{ ok: boolean; unchanged?: boolean; userId?: string }> {
  if (typeof window === 'undefined') return { ok: false };
  const boundSub = (sub || readActiveAu() || '').trim();
  if (boundSub) setActiveAu(boundSub);
  const windowToken =
    token || (boundSub ? tokenForAccount(boundSub) : '') || boundWindowToken() || '';
  if (!windowToken) return { ok: false };

  try {
    const response = await fetch('/api/auth/bhd/rebind', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: windowToken,
        returnTo: accountBoundPath(currentReturnPath(), boundSub),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      unchanged?: boolean;
      user?: { id?: string } | null;
    };
    if (!response.ok || !body.ok) return { ok: false };
    if (body.user?.id) setActiveAu(body.user.id);
    return {
      ok: true,
      unchanged: Boolean(body.unchanged),
      ...(body.user?.id ? { userId: body.user.id } : {}),
    };
  } catch {
    return { ok: false };
  }
}

export async function switchWindowAccount(
  sub: string,
): Promise<{ ok: boolean; token?: string; userId?: string }> {
  if (!sub) return { ok: false };
  paintPrivacyVeil();
  const response = await identityFetch('/api/auth/switch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BHD-Persist-Cookie': '1',
    },
    body: JSON.stringify({ sub }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    token?: string;
    user?: { id?: string } | null;
  };
  const userId = typeof body.user?.id === 'string' ? body.user.id : sub;
  if (typeof body.token === 'string') {
    captureAccountToken(userId, body.token);
    setActiveAu(userId);
  }
  return {
    ok: response.ok,
    ...(typeof body.token === 'string' ? { token: body.token } : {}),
    userId,
  };
}

export async function applyAccountIsolation(
  token?: string | null,
  options?: { force?: boolean; sub?: string | null; silent?: boolean },
) {
  if (typeof window === 'undefined') return;
  if (!options?.force && isAccountRebindPending()) return;
  const sub = (options?.sub || readActiveAu() || '').trim();
  if (sub) setActiveAu(sub);
  const here = currentReturnPath();

  if (isIdentityOrigin()) {
    window.location.assign(accountBoundPath(here, sub));
    return;
  }

  const windowToken =
    token ||
    (sub ? tokenForAccount(sub) : '') ||
    boundWindowToken() ||
    sessionStorage.getItem('bhd_window_token') ||
    '';

  if (options?.silent) {
    const result = await silentRebind(windowToken, sub);
    if (result.ok && result.unchanged) {
      clearAccountRebindLock();
      scrubCacheBustFromUrl();
      return;
    }
    if (result.ok && result.userId) {
      sessionStorage.setItem(REBIND_LOCK, String(Date.now()));
      window.location.replace(accountBoundPath(here, result.userId));
      return;
    }
  }

  markIsolationPending();
  if (windowToken) {
    rebindWithWindowToken(windowToken, here, sub);
    return;
  }

  try {
    const response = await identityFetch('/api/auth/window-handoff', { method: 'POST' });
    const data = (await response.json().catch(() => ({}))) as { ticket?: string };
    const start = new URL(
      productStartPath(accountBoundReturnPath(here, sub)),
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
    `/api/auth/bhd/logout?continue=${encodeURIComponent(productStartPath(accountBoundReturnPath(here, sub)))}`,
  );
}

export function clearAccountRebindLock() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(REBIND_LOCK);
  try {
    delete document.documentElement.dataset.bhdSwitching;
    document.getElementById('bhd-privacy-veil')?.remove();
  } catch {
    /* ignore */
  }
}
