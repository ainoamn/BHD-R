export type StayDayStatus =
  | 'available'
  | 'blocked'
  | 'booked'
  | 'hold'
  | 'maintenance'
  | 'lease'
  | 'unavailable';

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

export function isStayDateSelectable(
  status: StayDayStatus,
  stayDate: string,
  todayIso = new Date().toISOString().slice(0, 10),
): boolean {
  return stayDate >= todayIso && status === 'available';
}
