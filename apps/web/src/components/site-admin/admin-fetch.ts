import { ApiError } from '@/lib/api';
import { tabBoundAuthHeaders } from '@/lib/identity/window-session';

export type AdminNotice = { tone: 'success' | 'error'; text: string };

/** Bind ?au= product session before site-admin reads so counts match the tab account. */
async function claimActiveAuIfNeeded(): Promise<void> {
  try {
    const { claimProductSessionForActiveAu } = await import('@/lib/identity/client');
    const claimed = await claimProductSessionForActiveAu();
    if (!claimed.ok) {
      throw new ApiError(
        401,
        'account_mismatch',
        'الحساب النشط في هذه النافذة لا يطابق جلسة المنتج — بدّل الحساب من الرأس ثم أعد المحاولة.',
      );
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
  }
}

export async function adminGet<T>(path: string): Promise<T> {
  await claimActiveAuIfNeeded();
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: tabBoundAuthHeaders({ accept: 'application/json' }),
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { code?: string; messageAr?: string } })
    | null;
  if (!response.ok || !payload) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'request_failed',
      payload?.error?.messageAr ?? 'تعذّر التحميل.',
    );
  }
  return payload;
}

export function adminErrorText(
  error: unknown,
  ar: boolean,
  fallbackAr: string,
  fallbackEn: string,
) {
  return error instanceof ApiError && error.message ? error.message : ar ? fallbackAr : fallbackEn;
}

export function adminDate(value: string | null, ar: boolean): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

export function adminDateTime(value: string | null, ar: boolean): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

export function adminBytes(bytes: number, ar: boolean): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ar ? '0 بايت' : '0 B';
  const units = ar
    ? ['بايت', 'ك.ب', 'م.ب', 'ج.ب', 'ت.ب']
    : ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const formatted = value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${units[index]}`;
}
