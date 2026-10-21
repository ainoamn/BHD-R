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
  const dayIn = normalizeTime(profile.dayUseCheckInFrom, '08:00');
  const dayOut = normalizeTime(profile.dayUseCheckOutUntil, '23:00');
  const nightIn = normalizeTime(profile.checkInFrom, '15:00');
  const nightOut = normalizeTime(
    profile.overnightCheckOutUntil ?? profile.checkOutUntil,
    '11:00',
  );
  if (stayType === 'day_use') {
    return { checkInTime: dayIn, checkOutTime: dayOut };
  }
  return { checkInTime: nightIn, checkOutTime: nightOut };
}

/** Display “2026-10-21 · 15:00”. */
export function formatStayDateTime(dateOn: string, timeHHMM: string): string {
  const day = dateOn.slice(0, 10);
  const time = normalizeTime(timeHHMM, '00:00');
  return `${day} · ${time}`;
}
