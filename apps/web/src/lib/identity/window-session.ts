export const WINDOW_TOKEN_KEY = 'bhd_window_token';
export const WINDOW_SIGNED_OUT_KEY = 'bhd_window_signed_out';
/** Google-style per-account tokens so tabs can bind via ?au=<sub>. */
export const ACCOUNT_TOKENS_KEY = 'bhd_account_tokens';
export const ACTIVE_AU_KEY = 'bhd_active_au';

type TokenMap = Record<string, string>;

function readTokenMap(): TokenMap {
  if (typeof sessionStorage === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(ACCOUNT_TOKENS_KEY);
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

function writeTokenMap(map: TokenMap) {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(ACCOUNT_TOKENS_KEY, JSON.stringify(map));
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
