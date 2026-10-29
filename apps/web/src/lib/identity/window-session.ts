export const WINDOW_TOKEN_KEY = 'bhd_window_token';
export const WINDOW_SIGNED_OUT_KEY = 'bhd_window_signed_out';

/** JWT this browser window uses. Other windows keep their own copy. */
export function captureWindowToken(token?: string | null) {
  if (typeof window === 'undefined' || !token) return;
  sessionStorage.setItem(WINDOW_TOKEN_KEY, token);
  sessionStorage.removeItem(WINDOW_SIGNED_OUT_KEY);
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
  const token = sessionStorage.getItem(WINDOW_TOKEN_KEY);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    headers.set('X-BHD-Window-Bootstrap', '1');
  }
  return headers;
}
