/** Resolve check-in / check-out clock times for a stay type from property profile settings. */

export type StayPeriodType = 'overnight_stay' | 'day_use' | 'overnight_only';

export type StayPeriodProfileTimes = {
  checkInFrom?: string | null;
  dayUseCheckInFrom?: string | null;
  dayUseCheckOutUntil?: string | null;
  overnightCheckOutUntil?: string | null;
  checkOutUntil?: string | null;
};

export type StayPeriodTimes = {
  checkInTime: string;
  checkOutTime: string;
};

/** Default clocks when the property has not set times yet. */
export const STAY_DEFAULT_DAY_USE_CHECK_IN = '10:00';
export const STAY_DEFAULT_DAY_USE_CHECK_OUT = '22:00';
/** Evening / overnight: 11:00 مساءً → 9:00 صباحاً. */
export const STAY_DEFAULT_OVERNIGHT_CHECK_IN = '23:00';
export const STAY_DEFAULT_OVERNIGHT_CHECK_OUT = '09:00';

function normalizeTime(value: string | null | undefined, fallback: string): string {
  const raw = (value ?? '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  return `${match[1]!.padStart(2, '0')}:${match[2]}`;
}

/** Clock times that apply to the selected stay type (property settings). */
export function resolveStayPeriodTimes(
  stayType: StayPeriodType | null | undefined,
  profile: StayPeriodProfileTimes,
): StayPeriodTimes {
  const dayIn = normalizeTime(profile.dayUseCheckInFrom, STAY_DEFAULT_DAY_USE_CHECK_IN);
  const dayOut = normalizeTime(profile.dayUseCheckOutUntil, STAY_DEFAULT_DAY_USE_CHECK_OUT);
  const nightIn = normalizeTime(profile.checkInFrom, STAY_DEFAULT_OVERNIGHT_CHECK_IN);
  const nightOut = normalizeTime(
    profile.overnightCheckOutUntil ?? profile.checkOutUntil,
    STAY_DEFAULT_OVERNIGHT_CHECK_OUT,
  );
  if (stayType === 'day_use') {
    return { checkInTime: dayIn, checkOutTime: dayOut };
  }
  if (stayType === 'overnight_only') {
    return { checkInTime: nightIn, checkOutTime: nightOut };
  }
  // Full day (overnight_stay): from morning check-in until overnight check-out next day.
  return { checkInTime: dayIn, checkOutTime: nightOut };
}

/** Display “2026-10-21 · 15:00”. */
export function formatStayDateTime(dateOn: string, timeHHMM: string): string {
  const day = dateOn.slice(0, 10);
  const time = normalizeTime(timeHHMM, '00:00');
  return `${day} · ${time}`;
}

export function isHalfDayStayType(stayType: string | null | undefined): boolean {
  return stayType === 'day_use' || stayType === 'overnight_only';
}

/**
 * Calendar day shown as check-out to guests/owners.
 * Day-use is stored as an exclusive [checkIn, checkIn+1) range but ends the same day.
 */
export function displayStayCheckoutOn(
  stayType: string | null | undefined,
  checkInOn: string,
  checkOutOn: string,
): string {
  if (stayType === 'day_use') return checkInOn.slice(0, 10);
  return checkOutOn.slice(0, 10);
}
