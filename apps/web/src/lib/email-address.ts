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

/**
 * Mask a mailbox for UI: keep the first and last local character, hide the middle,
 * leave the domain readable (e.g. `a••••9@hotmail.com`).
 */
export function maskEmailAddress(value: string | null | undefined): string {
  const email = normalizeEmailInput(value ?? '');
  const at = email.indexOf('@');
  if (at < 1 || at === email.length - 1) return email || '—';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length === 1) return `${local}••••@${domain}`;
  if (local.length === 2) return `${local[0]}••••${local[1]}@${domain}`;
  return `${local[0]}${'•'.repeat(Math.min(5, local.length - 2))}${local[local.length - 1]}@${domain}`;
}
