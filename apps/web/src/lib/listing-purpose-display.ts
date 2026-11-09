import type { PublicListing } from '@bhd-r/contracts';
import type { ListingMarketStatus } from '@/lib/listing-market-status';

/** Human labels for listing purpose badges (rent / sale / both). */
export function listingPurposeBadges(
  purpose: PublicListing['listingPurpose'] | undefined,
  locale: 'ar' | 'en',
): string[] {
  const ar = locale === 'ar';
  if (purpose === 'sale') return [ar ? 'للبيع' : 'For sale'];
  if (purpose === 'both') return [ar ? 'عقد طويل' : 'Long-term lease', ar ? 'للبيع' : 'For sale'];
  return [ar ? 'عقد طويل' : 'Long-term lease'];
}

export function listingPurposeCaption(
  purpose: PublicListing['listingPurpose'] | undefined,
  locale: 'ar' | 'en',
): string {
  const badges = listingPurposeBadges(purpose, locale);
  if (badges.length === 2) {
    return locale === 'ar' ? 'عقد طويل أو للبيع' : 'Long-term lease or for sale';
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

/** Short stamp for public browse cards (long-term rent + sale). */
export function occupancyWatermarkLabel(
  status: ListingMarketStatus,
  locale: 'ar' | 'en',
): string {
  const ar = locale === 'ar';
  switch (occupancyFromMarketStatus(status)) {
    case 'leased':
      return ar ? 'مؤجر' : 'Leased';
    case 'sold':
      return ar ? 'مباع' : 'Sold';
    case 'reserved':
      return ar ? 'محجوز' : 'Reserved';
    default:
      return ar ? 'شاغر' : 'Vacant';
  }
}

export function occupancyWatermarkModifier(
  status: ListingMarketStatus,
): 'vacant' | 'reserved' | 'taken' {
  if (status === 'reserved') return 'reserved';
  if (status === 'leased' || status === 'sold') return 'taken';
  return 'vacant';
}
