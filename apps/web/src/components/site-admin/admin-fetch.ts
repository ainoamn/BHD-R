import { ApiError } from '@/lib/api';

export type AdminNotice = { tone: 'success' | 'error'; text: string };

export async function adminGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  const payload = (await response.json().catch(() => null)) as
    (T & { error?: { code?: string; messageAr?: string } }) | null;
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
