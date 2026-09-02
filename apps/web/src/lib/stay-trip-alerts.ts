/** Client helpers for recent stay booking alerts (header bell + guest trips). */

export type StayTripAlert = {
  id: string;
  referenceCode: string;
  status: string;
  checkInOn: string;
  checkOutOn: string;
  currency?: string;
  totalMinor?: string;
  updatedAt: string;
};

const STORAGE_KEY = 'bhd-r-stay-trip-alerts';
const MAX_ITEMS = 12;

export function readStayTripAlerts(): StayTripAlert[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StayTripAlert[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.referenceCode === 'string' &&
        typeof item.status === 'string',
    );
  } catch {
    return [];
  }
}

export function rememberStayTripAlert(alert: Omit<StayTripAlert, 'updatedAt'> & { updatedAt?: string }) {
  if (typeof window === 'undefined') return;
  const next: StayTripAlert = {
    ...alert,
    updatedAt: alert.updatedAt ?? new Date().toISOString(),
  };
  const existing = readStayTripAlerts().filter(
    (item) => item.id !== next.id && item.referenceCode !== next.referenceCode,
  );
  const merged = [next, ...existing].slice(0, MAX_ITEMS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('bhd-r-stay-alerts'));
  } catch {
    // ignore quota / private mode
  }
}

export function stayAlertNeedsAction(status: string): boolean {
  return (
    status === 'payment_pending' ||
    status === 'request_pending' ||
    status === 'payment_failed'
  );
}

export function stayStatusLabel(status: string, ar: boolean): string {
  switch (status) {
    case 'payment_pending':
    case 'request_pending':
      return ar ? 'بانتظار الدفع' : 'Awaiting payment';
    case 'confirmed':
    case 'paid':
    case 'pre_arrival':
      return ar ? 'مؤكّد' : 'Confirmed';
    case 'checked_in':
      return ar ? 'تم تسجيل الوصول' : 'Checked in';
    case 'checked_out':
    case 'closed':
      return ar ? 'مكتمل' : 'Completed';
    case 'cancelled':
    case 'expired':
      return ar ? 'ملغى / منتهٍ' : 'Cancelled / expired';
    case 'payment_failed':
      return ar ? 'فشل الدفع' : 'Payment failed';
    default:
      return status;
  }
}
