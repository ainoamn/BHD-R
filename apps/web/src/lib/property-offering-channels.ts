/** Property offering marks: daily stay, long-term lease, and/or sale. */

export type PropertyOfferingChannel = 'stay' | 'rent' | 'sale';

export const PROPERTY_OFFERING_FILTERS = ['all', 'stay', 'rent', 'sale'] as const;
export type PropertyOfferingFilter = (typeof PROPERTY_OFFERING_FILTERS)[number];

export type OfferingChannelCounts = Partial<Record<PropertyOfferingChannel, number>>;

export function offeringChannelLabel(
  channel: PropertyOfferingChannel,
  locale: 'ar' | 'en',
): string {
  const ar = locale === 'ar';
  if (channel === 'stay') return ar ? 'إيجار يومي' : 'Daily stay';
  if (channel === 'sale') return ar ? 'للبيع' : 'For sale';
  return ar ? 'عقد طويل' : 'Long-term lease';
}

/** Badge text; for multi-unit buildings include how many units use this channel. */
export function offeringChannelBadgeLabel(
  channel: PropertyOfferingChannel,
  locale: 'ar' | 'en',
  count?: number,
): string {
  const label = offeringChannelLabel(channel, locale);
  if (typeof count === 'number' && count > 0) {
    return locale === 'ar' ? `${label} · ${count}` : `${label} · ${count}`;
  }
  return label;
}

export function offeringFilterLabel(filter: PropertyOfferingFilter, locale: 'ar' | 'en'): string {
  if (filter === 'all') return locale === 'ar' ? 'الكل' : 'All';
  return offeringChannelLabel(filter, locale);
}

/** Tone class for status-pill badges. */
export function offeringChannelTone(channel: PropertyOfferingChannel): string {
  if (channel === 'stay') return 'ready';
  if (channel === 'sale') return 'warn';
  return 'info';
}

/** Channels for one unit (daily stay is independent of listing purpose). */
export function unitOfferingChannels(
  purpose: 'rent' | 'sale' | 'both' | string | null | undefined,
  hasDailyStay: boolean,
): PropertyOfferingChannel[] {
  const channels: PropertyOfferingChannel[] = [];
  if (hasDailyStay) channels.push('stay');
  if (purpose === 'rent' || purpose === 'both') channels.push('rent');
  if (purpose === 'sale' || purpose === 'both') channels.push('sale');
  return channels;
}

/** Property-level helper: purposes drive rent/sale; `hasDailyStay` adds stay once (not per unit). */
export function offeringChannelsFromPurposes(
  purposes: ReadonlyArray<'rent' | 'sale' | 'both' | string | null | undefined>,
  hasDailyStay: boolean,
): PropertyOfferingChannel[] {
  if (!purposes.length) return hasDailyStay ? ['stay'] : [];
  const aggregated = aggregateOfferingChannels(
    purposes.map((purpose) => ({ purpose, hasDailyStay: false })),
  );
  if (hasDailyStay && !aggregated.channels.includes('stay')) {
    return ['stay', ...aggregated.channels];
  }
  return aggregated.channels;
}

/** Aggregate per-unit channels into ordered list + unit counts (multi-unit clarity). */
export function aggregateOfferingChannels(
  units: ReadonlyArray<{
    purpose: 'rent' | 'sale' | 'both' | string | null | undefined;
    hasDailyStay: boolean;
  }>,
): { channels: PropertyOfferingChannel[]; counts: OfferingChannelCounts } {
  const counts: OfferingChannelCounts = {};
  for (const unit of units) {
    for (const channel of unitOfferingChannels(unit.purpose, unit.hasDailyStay)) {
      counts[channel] = (counts[channel] ?? 0) + 1;
    }
  }
  const order: PropertyOfferingChannel[] = ['stay', 'rent', 'sale'];
  const channels = order.filter((channel) => (counts[channel] ?? 0) > 0);
  return { channels, counts };
}

export function rowMatchesOfferingFilter(
  channels: unknown,
  filter: PropertyOfferingFilter,
): boolean {
  if (filter === 'all') return true;
  if (!Array.isArray(channels)) return false;
  return channels.map(String).includes(filter);
}
