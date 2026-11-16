import { localizedName } from '@/lib/format';
import type { CatalogueListing } from '@/lib/listing-market-status';
import { formatPropertyListingLabel } from '@/lib/property-listing-label';
import { inferUnitKind, unitKindLabel } from '@/lib/unit-identity';

/** Deduplicate adjacent/repeated location parts. */
export function formatListingLocation(
  listing: Pick<CatalogueListing, 'governorate' | 'wilayat' | 'city'> & {
    area?: string | null;
    street?: string | null;
  },
): string {
  const normalize = (part: string) => part.trim().replace(/\s+/g, ' ');
  const parts = [listing.street, listing.area, listing.city, listing.wilayat, listing.governorate]
    .map((part) => (typeof part === 'string' ? normalize(part) : ''))
    .filter(Boolean);
  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.some((existing) => existing === part)) unique.push(part);
  }
  return unique.join(' · ');
}

/** Multi-unit card headline: «شقة A-02» (kind + code), not building-prefixed unit name. */
export function formatUnitCardHeadline(listing: CatalogueListing, locale: 'ar' | 'en'): string {
  const kind = inferUnitKind({
    ...(listing.unitCode != null ? { code: listing.unitCode } : {}),
    nameAr: listing.unitNameAr,
    nameEn: listing.unitNameEn,
  });
  const code = (listing.unitCode ?? '').trim();
  if (code) return `${unitKindLabel(kind, locale)} ${code}`.trim();
  const unitTitle = localizedName(locale, listing.unitNameAr, listing.unitNameEn);
  return unitTitle || unitKindLabel(kind, locale);
}

export function formatBuildingCardLine(listing: CatalogueListing, locale: 'ar' | 'en'): string {
  return formatPropertyListingLabel(locale, {
    nameAr: listing.propertyNameAr,
    nameEn: listing.propertyNameEn,
    displayNumber: listing.displayNumber,
    listingLabelMode: listing.listingLabelMode,
  });
}

export function formatListingCardTitle(
  listing: CatalogueListing,
  locale: 'ar' | 'en',
): { headline: string; buildingLine: string | null; isMulti: boolean } {
  const isMulti = listing.propertyKind === 'multi_unit';
  if (isMulti) {
    return {
      headline: formatUnitCardHeadline(listing, locale),
      buildingLine: formatBuildingCardLine(listing, locale) || null,
      isMulti: true,
    };
  }
  const propertyTitle = formatPropertyListingLabel(locale, {
    nameAr: listing.propertyNameAr,
    nameEn: listing.propertyNameEn,
    displayNumber: listing.displayNumber,
    listingLabelMode: listing.listingLabelMode,
  });
  const unitTitle = localizedName(locale, listing.unitNameAr, listing.unitNameEn);
  const headline =
    !unitTitle || unitTitle === propertyTitle || propertyTitle.includes(unitTitle)
      ? propertyTitle
      : `${propertyTitle} — ${unitTitle}`;
  return { headline, buildingLine: null, isMulti: false };
}
