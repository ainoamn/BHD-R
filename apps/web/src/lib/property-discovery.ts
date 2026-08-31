import type { CatalogueListing } from '@/lib/listing-market-status';
import type { ManagedProperty } from '@/components/property-detail-manager';
import {
  asPublicListingCategory,
  searchPublicListingsFromNeon,
  type PublicListingSearchInput,
} from '@/lib/search-public-listings-neon';

export type AiTag = { ar: string; en: string };

export function buildAiTags(property: ManagedProperty): AiTag[] {
  const unit = property.units[0];
  const tags: AiTag[] = [];
  const purpose = unit?.listingPurpose;
  if (purpose === 'rent' || purpose === 'both') tags.push({ ar: 'للإيجار', en: 'For rent' });
  if (purpose === 'sale' || purpose === 'both') tags.push({ ar: 'للبيع', en: 'For sale' });
  tags.push({ ar: property.category, en: property.category });
  if (unit) {
    tags.push({ ar: `${unit.bedrooms} غرف`, en: `${unit.bedrooms} bedrooms` });
    tags.push({ ar: `${unit.bathrooms} حمّامات`, en: `${unit.bathrooms} baths` });
  }
  if (property.profile?.furnishing === 'furnished') {
    tags.push({ ar: 'مفروش', en: 'Furnished' });
  } else if (property.profile?.furnishing === 'unfurnished') {
    tags.push({ ar: 'غير مفروش', en: 'Unfurnished' });
  }
  for (const amenity of property.amenities ?? []) {
    tags.push({
      ar: amenity.labelAr || amenity.code,
      en: amenity.labelEn || amenity.code,
    });
  }
  if (property.address?.wilayat) {
    tags.push({ ar: property.address.wilayat, en: property.address.wilayat });
  }
  return tags.slice(0, 16);
}

export type PropertyDiscoveryRails = {
  similar: CatalogueListing[];
  recommended: CatalogueListing[];
  topRated: CatalogueListing[];
};

export async function loadPropertyDiscoveryRails(
  property: ManagedProperty,
): Promise<PropertyDiscoveryRails> {
  const unit = property.units[0];
  const purpose =
    unit?.listingPurpose === 'sale' || unit?.listingPurpose === 'rent'
      ? unit.listingPurpose
      : undefined;

  const base: PublicListingSearchInput = {
    limit: 12,
    excludePropertyId: property.id,
  };
  if (property.address?.countryCode) base.countryCode = property.address.countryCode;
  if (purpose) base.purpose = purpose;

  const similarInput: PublicListingSearchInput = { ...base };
  if (property.address?.governorate) similarInput.governorate = property.address.governorate;
  if (property.address?.wilayat) similarInput.wilayat = property.address.wilayat;
  const category = asPublicListingCategory(property.category);
  if (category) similarInput.category = category;

  const recommendedInput: PublicListingSearchInput = { ...base };
  if (property.address?.governorate) recommendedInput.governorate = property.address.governorate;
  if (unit?.bedrooms) recommendedInput.bedroomsMin = Math.max(0, unit.bedrooms - 1);

  const poolInput: PublicListingSearchInput = { ...base, limit: 24 };
  if (property.address?.governorate) poolInput.governorate = property.address.governorate;

  const emptyResult: { data: CatalogueListing[] } = { data: [] };
  const results = await Promise.all([
    searchPublicListingsFromNeon(similarInput).catch(() => emptyResult),
    searchPublicListingsFromNeon(recommendedInput).catch(() => emptyResult),
    searchPublicListingsFromNeon(poolInput).catch(() => emptyResult),
  ]);
  const similarRes = results[0] ?? emptyResult;
  const recommendedRes = results[1] ?? emptyResult;
  const poolRes = results[2] ?? emptyResult;

  const amenityCodes = new Set((property.amenities ?? []).map((a) => a.code));
  const recommended = [...recommendedRes.data]
    .map((item) => {
      const overlap = (item.amenities ?? []).filter((code) => amenityCodes.has(code)).length;
      const bedScore =
        unit && item.bedrooms != null ? Math.max(0, 3 - Math.abs(item.bedrooms - unit.bedrooms)) : 0;
      return { item, score: overlap * 2 + bedScore };
    })
    .sort((a, b) => b.score - a.score)
    .map((row) => row.item)
    .slice(0, 8);

  const topRated = [...poolRes.data]
    .filter((item) => (item.reviewCount ?? 0) > 0 || (item.avgRating ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.avgRating ?? 0) - (a.avgRating ?? 0) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
    )
    .slice(0, 8);

  const topRatedFinal =
    topRated.length > 0
      ? topRated
      : [...poolRes.data]
          .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
          .slice(0, 8);

  return {
    similar: similarRes.data.slice(0, 8) as CatalogueListing[],
    recommended: recommended.slice(0, 8) as CatalogueListing[],
    topRated: topRatedFinal as CatalogueListing[],
  };
}
