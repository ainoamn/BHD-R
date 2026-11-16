import { resolveStoredPropertyNames as resolveStoredPropertyNamesShared } from '@bhd-r/contracts';
import { localizedName } from '@/lib/format';

export type ListingLabelMode = 'title' | 'number' | 'both';

export function normalizeListingLabelMode(value: unknown): ListingLabelMode {
  return value === 'number' || value === 'both' || value === 'title' ? value : 'title';
}

export const resolveStoredPropertyNames = resolveStoredPropertyNamesShared;

/** Public headline for a property from title / number / both. */
export function formatPropertyListingLabel(
  locale: 'ar' | 'en',
  input: {
    nameAr?: string | null | undefined;
    nameEn?: string | null | undefined;
    displayNumber?: string | null | undefined;
    listingLabelMode?: ListingLabelMode | string | null | undefined;
    serialFallback?: string | null | undefined;
  },
): string {
  const mode = normalizeListingLabelMode(input.listingLabelMode);
  const title = localizedName(locale, input.nameAr ?? '', input.nameEn ?? '').trim();
  const number =
    (input.displayNumber ?? '').trim() || (input.serialFallback ?? '').trim();
  if (mode === 'number') return number || title;
  if (mode === 'both') {
    if (number && title) return `${number} · ${title}`;
    return number || title;
  }
  return title || number;
}
