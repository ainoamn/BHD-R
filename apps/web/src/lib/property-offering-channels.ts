/** Property offering marks: daily stay, long-term lease, and/or sale. */

export type PropertyOfferingChannel = 'stay' | 'rent' | 'sale';

export const PROPERTY_OFFERING_FILTERS = ['all', 'stay', 'rent', 'sale'] as const;
export type PropertyOfferingFilter = (typeof PROPERTY_OFFERING_FILTERS)[number];

export function offeringChannelLabel(
  channel: PropertyOfferingChannel,
  locale: 'ar' | 'en',
): string {
  const ar = locale === 'ar';
  if (channel === 'stay') return ar ? 'إيجار يومي' : 'Daily stay';
  if (channel === 'sale') return ar ? 'للبيع' : 'For sale';
  return ar ? 'عقد طويل' : 'Long-term lease';
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

export function offeringChannelsFromPurposes(
  purposes: ReadonlyArray<'rent' | 'sale' | 'both' | string | null | undefined>,
  hasDailyStay: boolean,
): PropertyOfferingChannel[] {
  const channels: PropertyOfferingChannel[] = [];
  let rent = false;
  let sale = false;
  for (const purpose of purposes) {
    if (purpose === 'rent' || purpose === 'both') rent = true;
    if (purpose === 'sale' || purpose === 'both') sale = true;
  }
  if (hasDailyStay) channels.push('stay');
  if (rent) channels.push('rent');
  if (sale) channels.push('sale');
  return channels;
}

export function rowMatchesOfferingFilter(
  channels: unknown,
  filter: PropertyOfferingFilter,
): boolean {
  if (filter === 'all') return true;
  if (!Array.isArray(channels)) return false;
  return channels.map(String).includes(filter);
}
