import { DEFAULT_IDENTITY_ISSUER } from '@/lib/bhd/identity-public';
import { getCachedCatalogApps } from '@/lib/bhd/catalog';
import {
  boundWindowToken,
  captureAccountToken,
  captureProductSession,
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
/** Keep ?au= on the URL without navigation — stabilizes multi-tab binding. */
export function ensureAuInUrl(sub?: string | null) {
  if (typeof window === 'undefined') return;
  const au = (sub || readActiveAu() || '').trim();
  if (!au) return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('au') === au) return;
    url.searchParams.set('au', au);
    url.searchParams.delete('_bhd');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
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
/** Cooldown after a silent cookie repair — stops multi-tab thrash. */
export const SILENT_SSO_GUARD_MS = 45_000;

export function isAccountRebindPending() {
  if (typeof sessionStorage === 'undefined') return false;
  const raw = sessionStorage.getItem(REBIND_LOCK);
  if (!raw) return false;
  const at = Number(raw);
  return Number.isFinite(at) && Date.now() - at < 12_000;
}

/** Only the focused visible tab may rewrite the shared product cookie. */
export function tabMayClaimProductCookie() {
  if (typeof document === 'undefined') return false;
  if (document.hidden) return false;
  try {
    if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
  } catch {
    /* ignore */
  }
  return true;
}

export function emitAccountRebound(userId?: string | null, options?: { refresh?: boolean }) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('bhd:account-rebound', {
        detail: { userId: userId || '', refresh: options?.refresh !== false },
      }),
    );
  } catch {
    /* ignore */
  }
}

const PRODUCT_SESSION_CHANNEL = 'bhd-product-session';
const HOSTILE_COOKIE_KEY = 'bhd_hostile_cookie_owner';
/** Survives refresh so bootstrap can veil before wrong SSR paints. */
export const PRODUCT_COOKIE_OWNER_LS = 'bhd_product_cookie_sub';

export function rememberProductCookieOwner(sub: string) {
  if (typeof window === 'undefined' || !sub) return;
  try {
    localStorage.setItem(PRODUCT_COOKIE_OWNER_LS, sub);
  } catch {
    /* ignore */
  }
}

export function readRememberedProductCookieOwner(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(PRODUCT_COOKIE_OWNER_LS)?.trim() || '';
  } catch {
    return '';
  }
}

/** Tell other tabs which account now owns the shared product cookie. */
export function broadcastProductCookieOwner(sub: string) {
  if (typeof window === 'undefined' || !sub) return;
  rememberProductCookieOwner(sub);
  try {
    const bc = new BroadcastChannel(PRODUCT_SESSION_CHANNEL);
    bc.postMessage({ type: 'cookie-owner', sub, at: Date.now() });
    bc.close();
  } catch {
    /* ignore */
  }
}

/** Other tab switched accounts — freeze live UI until this tab rebinds its ?au=. */
export function markHostileProductCookie(ownerSub: string) {
  if (typeof sessionStorage === 'undefined' || !ownerSub) return;
  const au = readActiveAu();
  if (au && ownerSub !== au) {
    sessionStorage.setItem(HOSTILE_COOKIE_KEY, ownerSub);
  }
}

export function clearHostileProductCookie() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(HOSTILE_COOKIE_KEY);
}

export function hasHostileProductCookie(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  const owner = sessionStorage.getItem(HOSTILE_COOKIE_KEY)?.trim() || '';
  if (!owner) return false;
  const au = readActiveAu();
  return Boolean(au && owner !== au);
}

export function watchProductCookieOwner(onOwner: (sub: string) => void): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return () => undefined;
  }
  try {
    const bc = new BroadcastChannel(PRODUCT_SESSION_CHANNEL);
    bc.onmessage = (event: MessageEvent) => {
      const sub =
        event.data && typeof event.data === 'object' && event.data.type === 'cookie-owner'
          ? String(event.data.sub || '')
          : '';
      if (sub) onOwner(sub);
    };
    return () => {
      try {
        bc.close();
      } catch {
        /* ignore */
      }
    };
  } catch {
    return () => undefined;
  }
}

/**
 * True when this tab's ?au= matches the product session cookie.
 * Used to skip live refresh so another tab's account switch cannot paint here.
 */
export async function productSessionMatchesTab(): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  if (hasHostileProductCookie()) return false;
  const au = readActiveAu();
  if (!au) return true;
  try {
    const response = await fetch('/api/auth/me', {
      cache: 'no-store',
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    const body = (await response.json().catch(() => ({}))) as { currentSub?: string | null };
    if (body.currentSub && body.currentSub !== au) {
      markHostileProductCookie(body.currentSub);
      return false;
    }
    if (body.currentSub && body.currentSub === au) clearHostileProductCookie();
    return true;
  } catch {
    return true;
  }
}

const VEIL_MARK_SRC = '/brand/bhd-official-symbol.svg';
/** Explicit account-switch splash only (not used on normal page loads). */
export const VEIL_MIN_MS = 400;
export const VEIL_MAX_MS = 900;
const VEIL_FADE_MS = 320;

let veilShownAt = 0;
let veilReady = false;
let veilMinTimer = 0;
let veilMaxTimer = 0;
let veilExitTimer = 0;

function veilCaption() {
  try {
    return document.documentElement.lang === 'en'
      ? 'Loading your workspace…'
      : 'جاري تجهيز مساحتك…';
  } catch {
    return 'جاري تجهيز مساحتك…';
  }
}

function veilMarkup() {
  return `<div class="bhd-account-veil__panel"><div class="bhd-account-veil__stage"><span class="bhd-account-veil__glow" aria-hidden="true"></span><span class="bhd-account-veil__ring" aria-hidden="true"></span><div class="bhd-account-veil__mark"><img src="${VEIL_MARK_SRC}" alt="" width="168" height="52" decoding="async" fetchpriority="high" /></div></div><p class="bhd-account-veil__caption">${veilCaption()}</p><div class="bhd-account-veil__track" aria-hidden="true"><span class="bhd-account-veil__bar"></span></div></div>`;
}

function resetVeilBudget() {
  veilShownAt = 0;
  veilReady = false;
  if (veilMinTimer) window.clearTimeout(veilMinTimer);
  if (veilMaxTimer) window.clearTimeout(veilMaxTimer);
  if (veilExitTimer) window.clearTimeout(veilExitTimer);
  veilMinTimer = 0;
  veilMaxTimer = 0;
  veilExitTimer = 0;
}

function startVeilBudget() {
  if (veilShownAt) return;
  veilShownAt = Date.now();
  veilReady = false;
  if (veilMinTimer) window.clearTimeout(veilMinTimer);
  if (veilMaxTimer) window.clearTimeout(veilMaxTimer);
  veilMinTimer = window.setTimeout(() => {
    veilMinTimer = 0;
    if (veilReady) releasePrivacyVeil();
  }, VEIL_MIN_MS);
  // Hard cap so refresh never sticks on the splash.
  veilMaxTimer = window.setTimeout(() => {
    veilMaxTimer = 0;
    veilReady = true;
    releasePrivacyVeil();
  }, VEIL_MAX_MS);
}

/** Branded cover while cookie/?au= reconcile — fixed ~0.7–1.8s budget. */
export function paintPrivacyVeil(_message?: string) {
  if (typeof document === 'undefined') return;
  try {
    document.documentElement.dataset.bhdSwitching = '1';
    document.documentElement.style.setProperty('--bhd-veil-ms', `${VEIL_MAX_MS}ms`);
    let veil = document.getElementById('bhd-privacy-veil');
    if (!veil) {
      veil = document.createElement('div');
      veil.id = 'bhd-privacy-veil';
      veil.className = 'bhd-account-veil';
      veil.setAttribute('aria-hidden', 'true');
      veil.innerHTML = veilMarkup();
      document.body.appendChild(veil);
    } else {
      veil.classList.remove('is-exiting');
      if (!veil.querySelector('.bhd-account-veil__panel')) {
        veil.className = 'bhd-account-veil';
        veil.innerHTML = veilMarkup();
      }
    }
    startVeilBudget();
  } catch {
    /* ignore */
  }
}

/** Session aligned (or refresh done) — lift after the minimum splash, or immediately if past it. */
export function signalPrivacyVeilReady() {
  veilReady = true;
  if (!veilShownAt) {
    clearAccountRebindLock();
    return;
  }
  const waited = Date.now() - veilShownAt;
  if (waited >= VEIL_MIN_MS) releasePrivacyVeil();
}

/** Fade out the splash then unlock the page. */
export function releasePrivacyVeil() {
  if (typeof document === 'undefined') {
    clearAccountRebindLock();
    return;
  }
  try {
    const veil = document.getElementById('bhd-privacy-veil');
    if (!veil || veil.classList.contains('is-exiting')) {
      clearAccountRebindLock();
      resetVeilBudget();
      return;
    }
    veil.classList.add('is-exiting');
    document.documentElement.dataset.bhdSwitching = '0';
    if (veilExitTimer) window.clearTimeout(veilExitTimer);
    veilExitTimer = window.setTimeout(() => {
      veilExitTimer = 0;
      clearAccountRebindLock();
      resetVeilBudget();
    }, VEIL_FADE_MS);
  } catch {
    clearAccountRebindLock();
    resetVeilBudget();
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
      sessionToken?: string | null;
      csrf?: string | null;
    };
    if (!response.ok || !body.ok) return { ok: false };
    // Keep the tab's identity ?au= — product user.id is a different id space and must not
    // replace it (multi-tab cookie reclaim would then fail productSessionMatchesTab).
    if (boundSub) {
      setActiveAu(boundSub);
      ensureAuInUrl(boundSub);
      captureProductSession(boundSub, body.sessionToken, body.csrf);
    } else if (body.user?.id) {
      setActiveAu(body.user.id);
      captureProductSession(body.user.id, body.sessionToken, body.csrf);
    }
    return {
      ok: true,
      unchanged: Boolean(body.unchanged),
      ...(body.user?.id ? { userId: body.user.id } : {}),
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Before authenticated reads/writes: bind this tab's ?au= and cache its product JWT.
 * Multi-tab browsers share one cookie — API calls must send the tab-bound product session.
 */
export async function claimProductSessionForActiveAu(): Promise<{ ok: boolean }> {
  if (typeof window === 'undefined') return { ok: true };
  const au = readActiveAu();
  if (!au) return { ok: true };
  try {
    const { boundProductSessionToken } = await import('@/lib/identity/window-session');
    const matches = await productSessionMatchesTab();
    // Cookie already matches and this tab has a cached product JWT — skip rebind.
    if (matches && boundProductSessionToken()) return { ok: true };
    // Rebind (or unchanged hand-back) so sessionStorage holds this tab's product JWT + CSRF.
    const result = await silentRebind(null, au);
    if (!result.ok) return { ok: false };
    clearHostileProductCookie();
    broadcastProductCookieOwner(result.userId || au);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function switchWindowAccount(
  sub: string,
): Promise<{ ok: boolean; token?: string; userId?: string; error?: string }> {
  if (!sub) return { ok: false };
  paintPrivacyVeil();
  try {
    // Cookie-only: do NOT send the current tab Bearer — it pins identity to the
    // old account and blocks multi-account POST /api/auth/switch (Google-style).
    const response = await fetch(identityApiUrl('/api/auth/switch'), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-BHD-Persist-Cookie': '1',
      },
      body: JSON.stringify({ sub }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      token?: string;
      user?: { id?: string } | null;
      error?: { code?: string } | string;
    };
    const userId = typeof body.user?.id === 'string' ? body.user.id : sub;
    if (!response.ok) {
      signalPrivacyVeilReady();
      clearAccountRebindLock();
      const code =
        typeof body.error === 'object' && body.error?.code
          ? body.error.code
          : typeof body.error === 'string'
            ? body.error
            : 'switch_failed';
      return { ok: false, userId, error: code };
    }
    if (typeof body.token === 'string') {
      captureAccountToken(userId, body.token);
    }
    setActiveAu(userId);
    broadcastProductCookieOwner(userId);
    return {
      ok: true,
      userId,
      ...(typeof body.token === 'string' ? { token: body.token } : {}),
    };
  } catch {
    signalPrivacyVeilReady();
    clearAccountRebindLock();
    return { ok: false, error: 'network' };
  }
}

export async function applyAccountIsolation(
  token?: string | null,
  options?: {
    force?: boolean;
    sub?: string | null;
    silent?: boolean;
    /** Reclaim shared cookie only — do not veil or router.refresh (multi-window focus). */
    quiet?: boolean;
  },
) {
  if (typeof window === 'undefined') return;
  if (!options?.force && isAccountRebindPending()) return;
  const sub = (options?.sub || readActiveAu() || '').trim();
  if (sub) setActiveAu(sub);
  const here = currentReturnPath();
  const quiet = Boolean(options?.quiet);

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
    if (!tabMayClaimProductCookie()) return;
    // Never paint the branded veil here — it flickered on every page with ?au=.
    const result = await silentRebind(windowToken, sub);
    if (result.ok) {
      scrubCacheBustFromUrl();
      // Cookie fixed in-place — never hard-navigate (stops blink + tab wars).
      if (!result.unchanged) {
        const guardKey = `bhd-sso:${result.userId || sub || 'x'}`;
        sessionStorage.setItem(guardKey, String(Date.now()));
        clearHostileProductCookie();
        if (result.userId || sub) broadcastProductCookieOwner(result.userId || sub || '');
        signalPrivacyVeilReady();
        // quiet = cookie only; otherwise caller may soft-refresh without a veil.
        emitAccountRebound(result.userId || sub, { refresh: !quiet });
      } else {
        clearHostileProductCookie();
        if (result.userId || sub) rememberProductCookieOwner(result.userId || sub || '');
        signalPrivacyVeilReady();
      }
      return;
    }
  }

  markIsolationPending();
  if (sub) broadcastProductCookieOwner(sub);
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
    document.documentElement.removeAttribute('data-bhd-switching');
    document.getElementById('bhd-privacy-veil')?.remove();
  } catch {
    /* ignore */
  }
}
