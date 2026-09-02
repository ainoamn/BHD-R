import type { PublicListing } from '@bhd-r/contracts';

/** Public stay catalogue row — one published stay profile per unit. */
export type StayCatalogueListing = {
  id: string;
  slug: string;
  unitId: string;
  unitCode: string | null;
  unitNameAr: string;
  unitNameEn: string;
  propertyId: string;
  propertyNameAr: string;
  propertyNameEn: string;
  propertyKind: 'single_unit' | 'multi_unit' | null;
  category: PublicListing['category'];
  governorate: string;
  wilayat: string;
  city?: string | null;
  area?: string | null;
  street?: string | null;
  bedrooms: number;
  bathrooms: number;
  areaSquareMeters: number | null;
  maxGuests: number;
  nightlyMinor: string | null;
  currency: string;
  coverImageUrl: string | null;
  publishedAt: string;
  hasPool?: boolean;
  parkingSpaces?: number;
  amenities?: string[];
  latitude?: number | null;
  longitude?: number | null;
  mapsUrl?: string | null;
  unitSerial?: string | null;
};

export type StayCatalogueCollection = {
  data: StayCatalogueListing[];
  pagination: { nextCursor: null; hasMore: false };
};
