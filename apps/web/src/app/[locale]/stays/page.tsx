import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { StaySearch } from '@/components/stays/stay-search';
import { StaysBrowse } from '@/components/stays/stays-browse';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { bilingualAlternates } from '@/lib/seo';
import {
  asPublicListingCategory,
  searchStaysCatalogueFromNeon,
  type StayCatalogueSearchInput,
} from '@/lib/search-stays-catalogue-neon';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import {
  stayFiltersFromSearchRecord,
  type StayBrowseFilterState,
} from '@/lib/stays-browse-filters';
import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';
import { searchPublicStaysOnNeon } from '@/lib/load-public-stays-neon';
import { publicApiFetch } from '@/lib/server-api';
import type { StaySearchListing, StaySearchResponse } from '@bhd-r/contracts';

function mapSearchItemsToCatalogue(items: StaySearchListing[]): StayCatalogueListing[] {
  return items
    .filter((item) => Boolean(item.unitId))
    .map((item) => ({
      id: item.unitId!,
      slug: item.slug,
      unitId: item.unitId!,
      unitCode: item.unitCode ?? null,
      unitNameAr: item.unitNameAr ?? item.titleAr,
      unitNameEn: item.unitNameEn ?? item.titleEn,
      propertyId: '',
      propertyNameAr: item.propertyNameAr ?? '',
      propertyNameEn: item.propertyNameEn ?? '',
      propertyKind: null,
      category: 'apartment' as const,
      governorate: item.destination ?? '',
      wilayat: '',
      bedrooms: item.bedrooms ?? 0,
      bathrooms: item.bathrooms ?? 0,
      areaSquareMeters: null,
      maxGuests: item.maxGuests ?? 0,
      nightlyMinor: item.nightlyMinor ?? null,
      currency: item.currency ?? 'OMR',
      coverImageUrl: item.coverImageUrl ?? null,
      publishedAt: new Date().toISOString(),
    }));
}

async function loadSearchFallback(countryCode: string): Promise<StayCatalogueListing[]> {
  const searchQuery = {
    countryCode,
    locale: 'ar' as const,
    limit: 100,
    adults: 2,
    children: 0,
  };
  if (hasDatabaseUrl()) {
    try {
      const neon = await searchPublicStaysOnNeon(searchQuery);
      if (neon.items.length) return mapSearchItemsToCatalogue(neon.items);
    } catch (error) {
      console.error('[stays] Neon search fallback failed', error);
    }
  }
  const api = await publicApiFetch<StaySearchResponse>(
    `/v1/public/stays/search?countryCode=${countryCode}&locale=ar&limit=100&adults=2&children=0`,
    8,
  ).catch(() => null);
  return api?.items?.length ? mapSearchItemsToCatalogue(api.items) : [];
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { locale } = await params;
  const query = await searchParams;
  const dated = typeof query.checkInOn === 'string' || typeof query.checkOutOn === 'string';
  return {
    title: locale === 'ar' ? 'إقامة يومية' : 'Daily stays',
    description:
      locale === 'ar'
        ? 'ابحث عن إقامات يومية فاخرة في سلطنة عُمان — كل وحدة على حدة مع تصفية متقدمة.'
        : 'Search luxury daily stays in Oman — each unit listed separately with advanced filters.',
    alternates: bilingualAlternates(locale, '/stays'),
    robots: dated ? { index: false, follow: true } : { index: true, follow: true },
  };
}

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseMajorPrice(value: string | undefined): number | undefined {
  if (!value || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

async function loadStaysCatalogue(
  query: URLSearchParams,
): Promise<StayCatalogueListing[]> {
  const countryCode = query.get('countryCode') ?? 'OM';
  if (!hasDatabaseUrl()) {
    return loadSearchFallback(countryCode);
  }
  try {
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
    const search: StayCatalogueSearchInput = { limit: 100 };
    const governorate = query.get('governorate');
    const wilayat = query.get('wilayat');
    const village = query.get('village');
    const category = asPublicListingCategory(query.get('category'));
    const categories = (query.get('categories') ?? '')
      .split(',')
      .map((item) => asPublicListingCategory(item.trim()))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const currency = query.get('currency');
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
    if (bedroomsMin !== undefined) search.bedroomsMin = bedroomsMin;
    if (bathroomsMin !== undefined) search.bathroomsMin = bathroomsMin;
    if (currency) search.currency = currency;
    if (priceMin !== undefined) search.priceMin = priceMin;
    if (priceMax !== undefined) search.priceMax = priceMax;
    if (hasPool) search.hasPool = true;
    if (hasParking) search.hasParking = true;
    if (amenities.length) search.amenities = amenities;
    if (q) search.q = q;

    const payload = await searchStaysCatalogueFromNeon(search);
    if (payload.data.length) return payload.data;
    return loadSearchFallback(countryCode ?? 'OM');
  } catch (error) {
    console.error('[stays] Neon catalogue failed', error);
    return loadSearchFallback(query.get('countryCode') ?? 'OM');
  }
}

export default async function StaysSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isStaysPublicSurfaceEnabled()) notFound();
  const { locale: rawLocale } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const t = await getTranslations('Stays');
  const raw = await searchParams;

  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = one(value);
  }
  const initialFilters: StayBrowseFilterState = stayFiltersFromSearchRecord(flat);

  const destination = flat.destination;
  const checkInOn = flat.checkInOn;
  const checkOutOn = flat.checkOutOn;
  const adults = flat.adults;
  const children = flat.children;

  const stayDates = {
    ...(destination ? { destination } : {}),
    ...(checkInOn ? { checkInOn } : {}),
    ...(checkOutOn ? { checkOutOn } : {}),
    ...(adults ? { adults } : {}),
    ...(children ? { children } : {}),
  };

  const query = new URLSearchParams({ limit: '100' });
  if (initialFilters.countryCode) query.set('countryCode', initialFilters.countryCode);
  if (initialFilters.governorate) query.set('governorate', initialFilters.governorate);
  if (initialFilters.wilayat) query.set('wilayat', initialFilters.wilayat);
  if (initialFilters.village) query.set('village', initialFilters.village);
  if (initialFilters.categories.length === 1) {
    query.set('category', initialFilters.categories[0]!);
  }
  if (initialFilters.categories.length > 1) {
    query.set('categories', initialFilters.categories.join(','));
  }
  if (initialFilters.bedroomsMin > 0) query.set('bedroomsMin', String(initialFilters.bedroomsMin));
  if (initialFilters.bathroomsMin > 0) {
    query.set('bathroomsMin', String(initialFilters.bathroomsMin));
  }
  if (initialFilters.currency) query.set('currency', initialFilters.currency);
  if (initialFilters.priceMin) query.set('priceMin', initialFilters.priceMin);
  if (initialFilters.priceMax) query.set('priceMax', initialFilters.priceMax);
  if (initialFilters.hasPool) query.set('hasPool', '1');
  if (initialFilters.hasParking) query.set('hasParking', '1');
  if (initialFilters.amenities.length) query.set('amenities', initialFilters.amenities.join(','));
  if (initialFilters.q) query.set('q', initialFilters.q);

  const listings = await loadStaysCatalogue(query);

  return (
    <StaysBrowse
      locale={locale}
      heading={t('searchTitle')}
      hint={t('shellHint')}
      initialFilters={initialFilters}
      initialListings={listings}
      stayDates={stayDates}
      searchBar={
        <StaySearch
          locale={locale}
          variant="inline"
          defaults={{
            ...(destination ? { destination } : {}),
            ...(checkInOn ? { checkInOn } : {}),
            ...(checkOutOn ? { checkOutOn } : {}),
            ...(adults ? { adults } : {}),
            ...(children ? { children } : {}),
          }}
        />
      }
    />
  );
}
