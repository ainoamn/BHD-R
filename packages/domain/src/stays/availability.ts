/**
 * Half-open stay ranges [checkIn, checkOut) — checkout day is available for the next guest.
 */

export type StayDateRange = {
  checkInOn: string; // YYYY-MM-DD
  checkOutOn: string; // YYYY-MM-DD (exclusive)
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertStayDate(value: string, field = 'date'): void {
  if (!ISO_DATE.test(value)) throw new RangeError(`${field} must be YYYY-MM-DD`);
}

export function parseStayDateUtc(value: string): Date {
  assertStayDate(value);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date ${value}`);
  return date;
}

export function nightsBetween(range: StayDateRange): number {
  assertStayDate(range.checkInOn, 'checkInOn');
  assertStayDate(range.checkOutOn, 'checkOutOn');
  const start = parseStayDateUtc(range.checkInOn).getTime();
  const end = parseStayDateUtc(range.checkOutOn).getTime();
  if (end <= start) throw new RangeError('checkOutOn must be after checkInOn');
  return Math.round((end - start) / 86_400_000);
}

/**
 * Half-open overlap: [a, b) overlaps [c, d) iff a < d && c < b.
 * Adjacent ranges that only touch at the boundary do NOT overlap.
 */
export function stayRangesOverlap(a: StayDateRange, b: StayDateRange): boolean {
  assertStayDate(a.checkInOn, 'a.checkInOn');
  assertStayDate(a.checkOutOn, 'a.checkOutOn');
  assertStayDate(b.checkInOn, 'b.checkInOn');
  assertStayDate(b.checkOutOn, 'b.checkOutOn');
  return a.checkInOn < b.checkOutOn && b.checkInOn < a.checkOutOn;
}

export function formatDaterangeLiteral(range: StayDateRange): string {
  nightsBetween(range); // validates
  return `[${range.checkInOn},${range.checkOutOn})`;
}

/**
 * Domain-level concurrent lock winner simulation.
 * Real exclusivity is enforced by PostgreSQL GiST EXCLUDE on stay_inventory_locks —
 * this helper only models first-writer-wins for unit tests without a DB.
 */
export function simulateConcurrentLockWinner(
  attempts: readonly StayDateRange[],
): { winnerIndex: number; rejectedIndexes: number[] } {
  if (attempts.length === 0) throw new RangeError('At least one attempt is required');
  const accepted: StayDateRange[] = [];
  const rejectedIndexes: number[] = [];
  let winnerIndex = -1;
  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i]!;
    const conflicts = accepted.some((existing) => stayRangesOverlap(existing, attempt));
    if (conflicts) {
      rejectedIndexes.push(i);
      continue;
    }
    if (winnerIndex < 0) winnerIndex = i;
    accepted.push(attempt);
  }
  return { winnerIndex, rejectedIndexes };
}
