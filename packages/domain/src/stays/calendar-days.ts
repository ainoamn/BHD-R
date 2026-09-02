import type { StayDayAvailability } from './inventory-projection.js';

export function enumerateStayDates(fromOn: string, toOn: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${fromOn}T00:00:00.000Z`);
  const end = new Date(`${toOn}T00:00:00.000Z`);
  while (cursor < end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function addCalendarMonths(isoMonthStart: string, months: number): string {
  const cursor = new Date(`${isoMonthStart}T00:00:00.000Z`);
  cursor.setUTCMonth(cursor.getUTCMonth() + months);
  return cursor.toISOString().slice(0, 10);
}

export function monthStartFromDate(isoDate: string): string {
  const [year, month] = isoDate.split('-');
  return `${year}-${month}-01`;
}

export function nextMonthStart(isoMonthStart: string): string {
  return addCalendarMonths(isoMonthStart, 1);
}

export type InventoryDayRow = {
  stayDate: string;
  availabilityStatus: string;
  effectiveRateMinor?: string | null;
  currency?: string | null;
};

export function fillInventoryCalendarDays(
  rows: readonly InventoryDayRow[],
  fromOn: string,
  toOn: string,
): Array<{
  stayDate: string;
  availabilityStatus: StayDayAvailability | 'unavailable';
  effectiveRateMinor?: string | null;
  currency?: string | null;
}> {
  const byDate = new Map(rows.map((row) => [row.stayDate, row]));
  return enumerateStayDates(fromOn, toOn).map((stayDate) => {
    const row = byDate.get(stayDate);
    if (!row) {
      return { stayDate, availabilityStatus: 'unavailable' as const };
    }
    return {
      stayDate,
      availabilityStatus: row.availabilityStatus as StayDayAvailability | 'unavailable',
      ...(row.effectiveRateMinor != null ? { effectiveRateMinor: row.effectiveRateMinor } : {}),
      ...(row.currency != null ? { currency: row.currency } : {}),
    };
  });
}

export function isStayDateSelectable(
  status: StayDayAvailability | 'unavailable',
  stayDate: string,
  todayIso = new Date().toISOString().slice(0, 10),
): boolean {
  return stayDate >= todayIso && status === 'available';
}
