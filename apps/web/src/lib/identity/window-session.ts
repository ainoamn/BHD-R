export const WINDOW_TOKEN_KEY = 'bhd_window_token';
export const WINDOW_SIGNED_OUT_KEY = 'bhd_window_signed_out';
/** Google-style per-account tokens so tabs can bind via ?au=<sub>. */
export const ACCOUNT_TOKENS_KEY = 'bhd_account_tokens';
/** Product JWT + CSRF per identity sub — API calls must not rely on the shared cookie alone. */
export const PRODUCT_SESSION_TOKENS_KEY = 'bhd_product_session_tokens';
export const PRODUCT_CSRF_TOKENS_KEY = 'bhd_product_csrf_tokens';
export const ACTIVE_AU_KEY = 'bhd_active_au';

type TokenMap = Record<string, string>;

function readNamedTokenMap(storageKey: string): TokenMap {
  if (typeof sessionStorage === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: TokenMap = {};
    for (const [key, value] of Object.entries(parsed as TokenMap)) {
      if (typeof key === 'string' && key && typeof value === 'string' && value.length > 20)
        out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeNamedTokenMap(storageKey: string, map: TokenMap) {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(storageKey, JSON.stringify(map));
}

function readTokenMap(): TokenMap {
  return readNamedTokenMap(ACCOUNT_TOKENS_KEY);
}

function writeTokenMap(map: TokenMap) {
  writeNamedTokenMap(ACCOUNT_TOKENS_KEY, map);
}

/** JWT this browser window uses. Other windows keep their own copy. */
export function captureWindowToken(token?: string | null, sub?: string | null) {
  if (typeof window === 'undefined' || !token) return;
  sessionStorage.setItem(WINDOW_TOKEN_KEY, token);
  sessionStorage.removeItem(WINDOW_SIGNED_OUT_KEY);
  if (sub) {
    const map = readTokenMap();
    map[sub] = token;
    writeTokenMap(map);
    sessionStorage.setItem(ACTIVE_AU_KEY, sub);
  }
}

export function captureAccountToken(sub: string, token: string) {
  if (typeof window === 'undefined' || !sub || !token) return;
  captureWindowToken(token, sub);
}

export function tokenForAccount(sub?: string | null): string {
  if (typeof window === 'undefined' || !sub) return '';
  return readTokenMap()[sub] || '';
}

export function readActiveAu(): string {
  if (typeof window === 'undefined') return '';
  try {
    const fromUrl = new URL(window.location.href).searchParams.get('au')?.trim() || '';
    if (fromUrl) return fromUrl;
  } catch {
    /* ignore */
  }
  return sessionStorage.getItem(ACTIVE_AU_KEY)?.trim() || '';
}

export function setActiveAu(sub: string) {
  if (typeof window === 'undefined' || !sub) return;
  sessionStorage.setItem(ACTIVE_AU_KEY, sub);
}

/** Token for this tab's bound account (URL ?au= → map → window token). */
export function boundWindowToken(): string {
  if (typeof window === 'undefined') return '';
  if (sessionStorage.getItem(WINDOW_SIGNED_OUT_KEY) === '1') return '';
  const au = readActiveAu();
  if (au) {
    const mapped = tokenForAccount(au);
    if (mapped) return mapped;
  }
  return sessionStorage.getItem(WINDOW_TOKEN_KEY) || '';
}

export function signOutThisWindow() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(WINDOW_TOKEN_KEY);
  sessionStorage.setItem(WINDOW_SIGNED_OUT_KEY, '1');
}

export function windowFetchHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (typeof window === 'undefined') return headers;
  if (sessionStorage.getItem(WINDOW_SIGNED_OUT_KEY) === '1') {
    headers.set('X-BHD-Window-Signed-Out', '1');
    return headers;
  }
  const token = boundWindowToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    headers.set('X-BHD-Window-Bootstrap', '1');
  }
  return headers;
}

/** Persist the product session that belongs to this tab's identity account. */
export function captureProductSession(
  sub: string | null | undefined,
  sessionToken?: string | null,
  csrf?: string | null,
) {
  if (typeof window === 'undefined') return;
  const au = (sub || readActiveAu() || '').trim();
  if (!au) return;
  if (sessionToken && sessionToken.length > 20) {
    const map = readNamedTokenMap(PRODUCT_SESSION_TOKENS_KEY);
    map[au] = sessionToken;
    writeNamedTokenMap(PRODUCT_SESSION_TOKENS_KEY, map);
  }
  if (csrf && csrf.length > 20) {
    const map = readNamedTokenMap(PRODUCT_CSRF_TOKENS_KEY);
    map[au] = csrf;
    writeNamedTokenMap(PRODUCT_CSRF_TOKENS_KEY, map);
  }
}

export function productSessionForAccount(sub?: string | null): string {
  if (typeof window === 'undefined' || !sub) return '';
  return readNamedTokenMap(PRODUCT_SESSION_TOKENS_KEY)[sub] || '';
}

export function productCsrfForAccount(sub?: string | null): string {
  if (typeof window === 'undefined' || !sub) return '';
  return readNamedTokenMap(PRODUCT_CSRF_TOKENS_KEY)[sub] || '';
}

/** Bound product JWT for this tab (?au=), independent of whichever account owns the shared cookie. */
export function boundProductSessionToken(): string {
  if (typeof window === 'undefined') return '';
  if (sessionStorage.getItem(WINDOW_SIGNED_OUT_KEY) === '1') return '';
  return productSessionForAccount(readActiveAu());
}

export function boundProductCsrfToken(): string {
  if (typeof window === 'undefined') return '';
  if (sessionStorage.getItem(WINDOW_SIGNED_OUT_KEY) === '1') return '';
  return productCsrfForAccount(readActiveAu());
}

/**
 * Headers that pin API auth to this tab's account.
 * Server prefers `x-bhd-product-session` over the shared `bhd_r_session` cookie.
 * Only attach au/identity pins when a product JWT is cached — otherwise a stale identity
 * bearer can reject a still-valid cookie session (lab-reset / admin reads).
 */
export function tabBoundAuthHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  if (typeof window === 'undefined') return headers;
  const product = boundProductSessionToken();
  if (!product) return headers;
  const au = readActiveAu();
  if (au) headers.set('x-bhd-active-au', au);
  const identity = boundWindowToken();
  if (identity) headers.set('x-bhd-identity-bearer', identity);
  headers.set('x-bhd-product-session', product);
  const csrf = boundProductCsrfToken();
  if (csrf && !headers.has('x-csrf-token')) headers.set('x-csrf-token', csrf);
  return headers;
}

/** Drop a revoked / mismatched cached product JWT so the next claim can mint a fresh one. */
export function clearProductSession(sub?: string | null) {
  if (typeof window === 'undefined') return;
  const au = (sub || readActiveAu() || '').trim();
  if (!au) return;
  const sessions = readNamedTokenMap(PRODUCT_SESSION_TOKENS_KEY);
  if (sessions[au]) {
    delete sessions[au];
    writeNamedTokenMap(PRODUCT_SESSION_TOKENS_KEY, sessions);
  }
  const csrfs = readNamedTokenMap(PRODUCT_CSRF_TOKENS_KEY);
  if (csrfs[au]) {
    delete csrfs[au];
    writeNamedTokenMap(PRODUCT_CSRF_TOKENS_KEY, csrfs);
  }
}
