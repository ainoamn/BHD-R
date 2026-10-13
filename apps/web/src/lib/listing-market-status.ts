import type { PublicListing } from '@bhd-r/contracts';

export type ListingMarketStatus =
  'available' | 'available_rent' | 'available_sale' | 'reserved' | 'leased' | 'sold';

export type CatalogueListing = PublicListing & {
  marketStatus: ListingMarketStatus;
  /** Enriched for public browse facets / filters */
  hasPool?: boolean;
  parkingSpaces?: number;
  amenities?: string[];
  city?: string;
  area?: string | null;
  street?: string | null;
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
  /** Paid reservation hold end — the unit returns to vacant if the booking is not completed. */
  reservedUntil?: string | null;
};

/** Guest score on 10 and review count of a card, or null before any released review. */
export function catalogueRating(
  listing: CatalogueListing,
): { score: number; count: number } | null {
  const score = listing.avgRating;
  const count = listing.reviewCount ?? 0;
  return typeof score === 'number' && score > 0 && count > 0 ? { score, count } : null;
}

/** «Reserved until …» note for cards; null when the unit is not under a paid reservation. */
export function reservedUntilNote(
  listing: Pick<CatalogueListing, 'marketStatus' | 'reservedUntil'>,
  locale: string,
): string | null {
  if (listing.marketStatus !== 'reserved' || !listing.reservedUntil) return null;
  const until = new Date(listing.reservedUntil);
  if (Number.isNaN(until.getTime())) return null;
  const ar = locale === 'ar';
  const date = until.toLocaleDateString(ar ? 'ar-OM' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return ar
    ? `محجوز — الحجز ساري حتى ${date}، وإن لم تُستكمل الإجراءات يعود العقار شاغراً`
    : `Reserved until ${date} — if the booking is not completed the property becomes vacant again`;
}

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
