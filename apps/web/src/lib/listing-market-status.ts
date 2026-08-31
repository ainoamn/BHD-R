import type { PublicListing } from '@bhd-r/contracts';

export type ListingMarketStatus =
  | 'available'
  | 'available_rent'
  | 'available_sale'
  | 'reserved'
  | 'leased'
  | 'sold';

export type CatalogueListing = PublicListing & {
  marketStatus: ListingMarketStatus;
  /** Enriched for public browse facets / filters */
  hasPool?: boolean;
  parkingSpaces?: number;
  amenities?: string[];
  city?: string;
  latitude?: number | null;
  longitude?: number | null;
  mapsUrl?: string | null;
  organizationId?: string;
  ownerPartyId?: string | null;
  avgRating?: number | null;
  reviewCount?: number;
  propertyKind?: 'single_unit' | 'multi_unit';
  unitCode?: string | null;
  propertySerial?: string | null;
  /** Derived unit serial (building serial + type index) for multi-unit catalogue cards */
  unitSerial?: string | null;
};

export function marketStatusFromPurpose(
  purpose: PublicListing['listingPurpose'],
): ListingMarketStatus {
  if (purpose === 'sale') return 'available_sale';
  if (purpose === 'rent') return 'available_rent';
  return 'available';
}

export function marketStatusLabel(
  status: ListingMarketStatus,
  t: (key: string) => string,
  purpose?: PublicListing['listingPurpose'],
): string {
  if (
    (status === 'available' || status === 'available_rent' || status === 'available_sale') &&
    purpose === 'both'
  ) {
    return t('Property.availableForRentOrSale');
  }
  switch (status) {
    case 'available_rent':
      return t('Property.availableForRent');
    case 'available_sale':
      return t('Property.availableForSale');
    case 'reserved':
      return t('Property.reserved');
    case 'leased':
      return t('Property.leased');
    case 'sold':
      return t('Property.sold');
    default:
      return t('Property.available');
  }
}

export function marketStatusTone(
  status: ListingMarketStatus,
): 'positive' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'reserved':
      return 'warning';
    case 'leased':
    case 'sold':
      return 'neutral';
    default:
      return 'positive';
  }
}
