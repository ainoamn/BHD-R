/** Stay date + slot helpers for public checkout (half-open inventory ranges). */

export type StayBookingType = 'overnight_stay' | 'day_use' | 'overnight_only';

export type StayDaySlot = 'morning' | 'evening' | 'full';

export function addUtcDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in Oman (YYYY-MM-DD), the same on server and browser. */
export function stayTodayInOman(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(now);
}

export function isIsoDate(value: string | undefined | null): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Whole nights between two ISO dates (negative when check-out is before check-in). */
export function nightsBetween(checkInOn: string, checkOutOn: string): number {
  const start = Date.parse(`${checkInOn}T00:00:00.000Z`);
  const end = Date.parse(`${checkOutOn}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

export function isSameCalendarDayStay(type: StayBookingType): boolean {
  return type === 'day_use' || type === 'overnight_only';
}

export function slotForStayType(type: StayBookingType): StayDaySlot {
  if (type === 'day_use') return 'morning';
  if (type === 'overnight_only') return 'evening';
  return 'full';
}

/** UI validation: day_use / overnight_only allow same calendar day. */
export function stayDatesValid(
  type: StayBookingType,
  checkInOn: string,
  checkOutOn: string,
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkInOn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOutOn)) {
    return false;
  }
  if (isSameCalendarDayStay(type)) return checkOutOn >= checkInOn;
  return checkOutOn > checkInOn;
}

/**
 * Exclusive checkout for inventory `[checkIn, checkOut)`.
 * day_use / overnight_only always occupy one calendar day → checkOut = checkIn + 1.
 */
export function exclusiveCheckOutOn(
  type: StayBookingType,
  checkInOn: string,
  _checkOutOn: string,
): string {
  if (isSameCalendarDayStay(type)) {
    return addUtcDays(checkInOn, 1);
  }
  return _checkOutOn;
}

/** Whether two stay types conflict on overlapping calendar nights. */
export function stayTypesConflict(a: StayBookingType, b: StayBookingType): boolean {
  const slotA = slotForStayType(a);
  const slotB = slotForStayType(b);
  if (slotA === 'full' || slotB === 'full') return true;
  return slotA === slotB;
}

export function readStayTypeFromSnapshot(snapshot: unknown): StayBookingType | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const root = snapshot as Record<string, unknown>;
  if (
    root.stayType === 'day_use' ||
    root.stayType === 'overnight_only' ||
    root.stayType === 'overnight_stay'
  ) {
    return root.stayType;
  }
  const fees = Array.isArray(root.fees) ? root.fees : [];
  for (const item of fees) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.code === 'stay_type' && typeof row.stayType === 'string') {
      if (
        row.stayType === 'day_use' ||
        row.stayType === 'overnight_only' ||
        row.stayType === 'overnight_stay'
      ) {
        return row.stayType;
      }
    }
  }
  return null;
}

/** Oman-friendly phone: digits with optional + and length 8–15. */
export function isValidGuestPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const digits = trimmed.replace(/[^\d]/g, '');
  return digits.length >= 8 && digits.length <= 15;
}
