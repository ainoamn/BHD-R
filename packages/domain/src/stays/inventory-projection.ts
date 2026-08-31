/**
 * Resolve projected day availability from active inventory lock kinds.
 * Priority: booking > hold > maintenance > lease > owner_block/channel > available.
 */
export const stayDayAvailabilityStatuses = [
  'available',
  'blocked',
  'booked',
  'hold',
  'maintenance',
  'lease',
] as const;

export type StayDayAvailability = (typeof stayDayAvailabilityStatuses)[number];

export const stayInventoryLockKinds = [
  'hold',
  'booking',
  'owner_block',
  'maintenance',
  'lease',
  'channel',
] as const;

export type StayInventoryLockKind = (typeof stayInventoryLockKinds)[number];

export function availabilityFromLockKinds(
  kinds: readonly StayInventoryLockKind[],
): StayDayAvailability {
  if (kinds.includes('booking')) return 'booked';
  if (kinds.includes('hold')) return 'hold';
  if (kinds.includes('maintenance')) return 'maintenance';
  if (kinds.includes('lease')) return 'lease';
  if (kinds.includes('owner_block') || kinds.includes('channel')) return 'blocked';
  return 'available';
}
