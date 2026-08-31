import type { PublicListing } from '@bhd-r/contracts';
import type { ListingMarketStatus } from '@/lib/listing-market-status';

/** Human labels for listing purpose badges (rent / sale / both). */
export function listingPurposeBadges(
  purpose: PublicListing['listingPurpose'] | undefined,
  locale: 'ar' | 'en',
): string[] {
  const ar = locale === 'ar';
  if (purpose === 'sale') return [ar ? 'للبيع' : 'For sale'];
  if (purpose === 'both') return [ar ? 'للإيجار' : 'For rent', ar ? 'للبيع' : 'For sale'];
  return [ar ? 'للإيجار' : 'For rent'];
}

export function listingPurposeCaption(
  purpose: PublicListing['listingPurpose'] | undefined,
  locale: 'ar' | 'en',
): string {
  const badges = listingPurposeBadges(purpose, locale);
  if (badges.length === 2) {
    return locale === 'ar' ? 'للإيجار أو البيع' : 'For rent or sale';
  }
  return badges[0] ?? (locale === 'ar' ? 'متاح' : 'Available');
}

export type UnitOccupancy = 'available' | 'reserved' | 'leased' | 'sold';

export function occupancyLabel(status: UnitOccupancy, locale: 'ar' | 'en'): string {
  const ar = locale === 'ar';
  switch (status) {
    case 'leased':
      return ar ? 'مؤجّرة' : 'Leased';
    case 'sold':
      return ar ? 'مباعة' : 'Sold';
    case 'reserved':
      return ar ? 'محجوزة' : 'Reserved';
    default:
      return ar ? 'شاغرة' : 'Vacant';
  }
}

export function occupancyFromMarketStatus(status: ListingMarketStatus): UnitOccupancy {
  if (status === 'leased') return 'leased';
  if (status === 'sold') return 'sold';
  if (status === 'reserved') return 'reserved';
  return 'available';
}
