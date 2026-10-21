/** Arrival window for daily-stay check-in (Muscat-style local civil times). */

export const STAY_CHECKIN_EARLY_MS = 4 * 60 * 60 * 1000;

export type StayCheckinType = 'overnight_stay' | 'day_use' | 'overnight_only';

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
  /** day_use = morning slot; overnight_only = evening; overnight_stay = full stay. */
  stayType?: StayCheckinType | null;
  checkInFrom?: string | null;
  checkOutUntil?: string | null;
  dayUseCheckOutUntil?: string | null;
  overnightCheckOutUntil?: string | null;
};

/**
 * Check-in opens up to 4 hours before the stay period starts, and closes when the
 * booked period ends. After close, the booking is treated as no-show if still awaiting arrival.
 *
 * - day_use (صباحي / بدون مبيت): same calendar day until day-use check-out
 * - overnight_only (مسائي / مبيت فقط): from evening check-in until overnight check-out
 * - overnight_stay: from check-in time until overnight check-out on departure day
 */
export function stayArrivalWindow(input: StayArrivalWindowInput): {
  opensAt: Date;
  closesAt: Date;
  checkInAt: Date;
  checkOutAt: Date;
} {
  const type = input.stayType ?? 'overnight_stay';
  const eveningIn = normalizeTime(input.checkInFrom) || '15:00';
  const overnightOut =
    normalizeTime(input.overnightCheckOutUntil) ||
    normalizeTime(input.checkOutUntil) ||
    '11:00';
  const dayUseOut = normalizeTime(input.dayUseCheckOutUntil) || '23:00';

  let checkInAt: Date;
  let checkOutAt: Date;

  if (type === 'day_use') {
    // Morning / day-use occupies the arrival calendar day until day-use check-out.
    checkInAt = muscatLocalDateTime(input.checkInOn, '00:00');
    checkOutAt = muscatLocalDateTime(input.checkInOn, dayUseOut);
  } else if (type === 'overnight_only') {
    checkInAt = muscatLocalDateTime(input.checkInOn, eveningIn);
    // Inventory checkOutOn is the exclusive next morning for half-day slots.
    checkOutAt = muscatLocalDateTime(input.checkOutOn, overnightOut);
  } else {
    checkInAt = muscatLocalDateTime(input.checkInOn, eveningIn);
    checkOutAt = muscatLocalDateTime(input.checkOutOn, overnightOut);
  }

  if (!(checkOutAt.getTime() > checkInAt.getTime())) {
    checkOutAt = new Date(checkInAt.getTime() + 60 * 60 * 1000);
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
  | {
      ok: false;
      code: 'stay_checkin_too_early' | 'stay_checkin_window_closed';
      opensAt: Date;
      closesAt: Date;
    };

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
