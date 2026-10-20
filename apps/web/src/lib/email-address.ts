/**
 * Emails pasted from Arabic/RTL UIs often carry invisible bidi marks (U+202B…U+202E).
 * Resend rejects those as invalid recipients, so strip them before store or send.
 */
const INVISIBLE_EMAIL_CHARS = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function normalizeEmailInput(value: string): string {
  return value.normalize('NFKC').replace(INVISIBLE_EMAIL_CHARS, '').trim().toLowerCase();
}

export function isPlausibleEmail(value: string): boolean {
  const email = normalizeEmailInput(value);
  return email.length > 0 && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
