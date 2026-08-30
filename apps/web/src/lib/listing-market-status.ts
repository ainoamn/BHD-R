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
): string {
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
