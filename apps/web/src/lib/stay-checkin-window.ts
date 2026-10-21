/** Arrival window for daily-stay check-in (Muscat-style local civil times). */

export const STAY_CHECKIN_EARLY_MS = 4 * 60 * 60 * 1000;

function normalizeTime(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${match[1]!.padStart(2, '0')}:${match[2]}`;
}

/** Local wall-clock in Asia/Muscat (UTC+4, no DST) → absolute Date. */
export function muscatLocalDateTime(dateOn: string, timeHHMM: string): Date {
  const time = normalizeTime(timeHHMM) || '00:00';
  return new Date(`${dateOn.slice(0, 10)}T${time}:00+04:00`);
}

export type StayArrivalWindowInput = {
  checkInOn: string;
  checkOutOn: string;
  checkInFrom?: string | null;
  checkOutUntil?: string | null;
};

/**
 * Check-in opens 4 hours before the listed check-in time, and closes at check-out time.
 * After close, the booking should be treated as no-show / cancelled if still awaiting arrival.
 */
export function stayArrivalWindow(input: StayArrivalWindowInput): {
  opensAt: Date;
  closesAt: Date;
  checkInAt: Date;
  checkOutAt: Date;
} {
  const inTime = normalizeTime(input.checkInFrom) || '15:00';
  const outTime = normalizeTime(input.checkOutUntil) || '12:00';
  const checkInAt = muscatLocalDateTime(input.checkInOn, inTime);
  let checkOutAt = muscatLocalDateTime(input.checkOutOn, outTime);
  if (!(checkOutAt.getTime() > checkInAt.getTime())) {
    checkOutAt = muscatLocalDateTime(input.checkInOn, '23:59');
  }
  return {
    checkInAt,
    checkOutAt,
    opensAt: new Date(checkInAt.getTime() - STAY_CHECKIN_EARLY_MS),
    closesAt: checkOutAt,
  };
}

export type StayCheckinWindowResult =
  | { ok: true; opensAt: Date; closesAt: Date }
  | { ok: false; code: 'stay_checkin_too_early' | 'stay_checkin_window_closed'; opensAt: Date; closesAt: Date };

export function assertStayCheckinWindow(
  input: StayArrivalWindowInput,
  now: Date = new Date(),
): StayCheckinWindowResult {
  const window = stayArrivalWindow(input);
  if (now.getTime() < window.opensAt.getTime()) {
    return {
      ok: false,
      code: 'stay_checkin_too_early',
      opensAt: window.opensAt,
      closesAt: window.closesAt,
    };
  }
  if (now.getTime() >= window.closesAt.getTime()) {
    return {
      ok: false,
      code: 'stay_checkin_window_closed',
      opensAt: window.opensAt,
      closesAt: window.closesAt,
    };
  }
  return { ok: true, opensAt: window.opensAt, closesAt: window.closesAt };
}
