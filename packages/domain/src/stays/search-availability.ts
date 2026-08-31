/**
 * Given projected day statuses for [checkIn, checkOut), return whether the stay is bookable.
 * Missing days count as unavailable (projection must be complete).
 */
export function stayRangeFullyAvailable(
  nights: readonly { stayDate: string; availabilityStatus: string }[],
  range: { checkInOn: string; checkOutOn: string },
): boolean {
  const needed: string[] = [];
  const start = Date.parse(`${range.checkInOn}T00:00:00.000Z`);
  const end = Date.parse(`${range.checkOutOn}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  for (let t = start; t < end; t += 86_400_000) {
    needed.push(new Date(t).toISOString().slice(0, 10));
  }
  const byDate = new Map(nights.map((night) => [night.stayDate, night.availabilityStatus]));
  return needed.every((date) => byDate.get(date) === 'available');
}
