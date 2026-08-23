export type BlockingKind = 'hold' | 'reservation' | 'lease' | 'maintenance';

export interface AvailabilityBlock {
  kind: BlockingKind;
  startsAt: Date;
  endsAt: Date | null;
  active: boolean;
}

export type UnitAvailability =
  'available' | 'held' | 'reserved' | 'leased' | 'maintenance' | 'unpublished';

const priority: Record<BlockingKind, number> = {
  lease: 4,
  maintenance: 3,
  reservation: 2,
  hold: 1,
};

export function deriveAvailability(input: {
  publishWhenAvailable: boolean;
  listingEnabled: boolean;
  now?: Date;
  blocks: readonly AvailabilityBlock[];
}): UnitAvailability {
  if (!input.publishWhenAvailable || !input.listingEnabled) return 'unpublished';
  const now = input.now ?? new Date();
  const current = input.blocks
    .filter(
      (block) => block.active && block.startsAt <= now && (!block.endsAt || block.endsAt > now),
    )
    .sort((a, b) => priority[b.kind] - priority[a.kind])[0];
  if (!current) return 'available';
  const mapping: Record<BlockingKind, UnitAvailability> = {
    hold: 'held',
    reservation: 'reserved',
    lease: 'leased',
    maintenance: 'maintenance',
  };
  return mapping[current.kind];
}

export function isPubliclyDiscoverable(availability: UnitAvailability): boolean {
  return availability === 'available';
}
