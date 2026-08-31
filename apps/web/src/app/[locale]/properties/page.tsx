import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PropertiesBrowse } from '@/components/properties-browse';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import {
  filtersFromSearchRecord,
  type BrowseFilterState,
} from '@/lib/properties-browse-filters';
import type { CatalogueListing } from '@/lib/listing-market-status';
import {
  searchPublicListingsFromNeon,
  asPublicListingCategory,
  type PublicListingSearchInput,
} from '@/lib/search-public-listings-neon';
import { publicApiFetch } from '@/lib/server-api';
import { bilingualAlternates } from '@/lib/seo';
import type { ListingCollection } from '@/lib/types';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'ar' ? 'العقارات المتاحة' : 'Available properties',
    description:
      locale === 'ar'
        ? 'وحدات منشورة ومتاحة فعلياً للإيجار والبيع عبر BHD R.'
        : 'Live, publicly available properties for rent and sale through BHD R.',
    alternates: bilingualAlternates(locale, '/properties'),
  };
}

function parsePurpose(value: string | undefined): 'rent' | 'sale' | undefined {
  return value === 'rent' || value === 'sale' ? value : undefined;
}

function parseMajorPrice(value: string | undefined): number | undefined {
  if (!value || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function loadListings(query: URLSearchParams): Promise<ListingCollection & { data: CatalogueListing[] }> {
  const empty = {
    data: [] as CatalogueListing[],
    pagination: { nextCursor: null, hasMore: false },
  };
  if (hasDatabaseUrl()) {
    try {
      const bedroomsRaw = query.get('bedrooms');
      const bedrooms =
        bedroomsRaw && bedroomsRaw !== '' && Number.isFinite(Number(bedroomsRaw))
          ? Number(bedroomsRaw)
          : undefined;
      const bedroomsMinRaw = query.get('bedroomsMin');
      const bedroomsMin =
        bedroomsMinRaw && Number.isFinite(Number(bedroomsMinRaw))
          ? Number(bedroomsMinRaw)
          : undefined;
      const bathroomsMinRaw = query.get('bathroomsMin');
      const bathroomsMin =
        bathroomsMinRaw && Number.isFinite(Number(bathroomsMinRaw))
          ? Number(bathroomsMinRaw)
          : undefined;
      const search: PublicListingSearchInput = {
        limit: Number(query.get('limit') ?? 100) || 100,
      };
      const countryCode = query.get('countryCode');
      const governorate = query.get('governorate');
      const wilayat = query.get('wilayat');
      const village = query.get('village');
      const category = asPublicListingCategory(query.get('category'));
      const categories = (query.get('categories') ?? '')
        .split(',')
        .map((item) => asPublicListingCategory(item.trim()))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
      const currency = query.get('currency');
      const purpose = parsePurpose(query.get('purpose') ?? undefined);
      const priceMin = parseMajorPrice(query.get('priceMin') ?? undefined);
      const priceMax = parseMajorPrice(query.get('priceMax') ?? undefined);
      const amenities = (query.get('amenities') ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const q = query.get('q')?.trim();
      const hasPool = query.get('hasPool') === '1' || query.get('hasPool') === 'true';
      const hasParking =
        query.get('hasParking') === '1' || query.get('hasParking') === 'true';

      if (countryCode) search.countryCode = countryCode;
      if (governorate) search.governorate = governorate;
      if (wilayat) search.wilayat = wilayat;
      if (village) search.village = village;
      if (categories.length) search.categories = categories;
      else if (category) search.category = category;
      if (bedrooms !== undefined) search.bedrooms = bedrooms;
      if (bedroomsMin !== undefined) search.bedroomsMin = bedroomsMin;
      if (bathroomsMin !== undefined) search.bathroomsMin = bathroomsMin;
      if (currency) {
        search.currency = currency as NonNullable<PublicListingSearchInput['currency']>;
      }
      if (purpose) search.purpose = purpose;
      if (priceMin !== undefined) search.priceMin = priceMin;
      if (priceMax !== undefined) search.priceMax = priceMax;
      if (hasPool) search.hasPool = true;
      if (hasParking) search.hasParking = true;
      if (amenities.length) search.amenities = amenities;
      if (q) search.q = q;
      return await searchPublicListingsFromNeon(search);
    } catch (error) {
      console.error('[properties] Neon catalogue failed', error);
    }
  }
  return publicApiFetch<ListingCollection>(`/v1/public/listings?${query.toString()}`, 30)
    .then((payload) => ({
      ...payload,
      data: payload.data.map((item) => ({
        ...item,
        marketStatus:
          item.listingPurpose === 'sale'
            ? ('available_sale' as const)
            : item.listingPurpose === 'rent'
              ? ('available_rent' as const)
              : ('available' as const),
      })),
    }))
    .catch(() => empty);
}

export default async function PropertiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const raw = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = one(value);
  }
  const initialFilters: BrowseFilterState = filtersFromSearchRecord(flat);

  const query = new URLSearchParams({ locale, limit: '100' });
  const serialized = filtersFromSearchRecord(flat);
  // Seed SSR with lightly filtered catalogue (country + purpose) so client facets have data.
  if (serialized.purpose) query.set('purpose', serialized.purpose);
  if (serialized.countryCode) query.set('countryCode', serialized.countryCode);
  if (serialized.governorate) query.set('governorate', serialized.governorate);
  if (serialized.wilayat) query.set('wilayat', serialized.wilayat);
  if (serialized.village) query.set('village', serialized.village);
  if (serialized.categories.length === 1) query.set('category', serialized.categories[0]!);
  if (serialized.categories.length > 1) {
    query.set('categories', serialized.categories.join(','));
  }
  if (serialized.bedroomsMin > 0) query.set('bedroomsMin', String(serialized.bedroomsMin));
  if (serialized.bathroomsMin > 0) query.set('bathroomsMin', String(serialized.bathroomsMin));
  if (serialized.currency) query.set('currency', serialized.currency);
  if (serialized.priceMin) query.set('priceMin', serialized.priceMin);
  if (serialized.priceMax) query.set('priceMax', serialized.priceMax);
  if (serialized.hasPool) query.set('hasPool', '1');
  if (serialized.hasParking) query.set('hasParking', '1');
  if (serialized.amenities.length) query.set('amenities', serialized.amenities.join(','));
  if (serialized.q) query.set('q', serialized.q);

  const t = await getTranslations();
  const listings = await loadListings(query);
  const purpose = parsePurpose(initialFilters.purpose || undefined);
  const heading =
    purpose === 'rent'
      ? locale === 'ar'
        ? 'عقارات للإيجار'
        : 'Properties for rent'
      : purpose === 'sale'
        ? locale === 'ar'
          ? 'عقارات للبيع'
          : 'Properties for sale'
        : t('Nav.available');

  return (
    <PropertiesBrowse
      locale={locale}
      heading={heading}
      hint={t('Home.featuredHint')}
      initialFilters={initialFilters}
      initialListings={listings.data}
    />
  );
}
