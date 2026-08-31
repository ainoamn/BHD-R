import type { Metadata } from 'next';
import { EmptyState } from '@bhd-r/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingCard } from '@/components/listing-card';
import { PropertyFilters, type PropertyFilterDefaults } from '@/components/property-filters';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
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

async function loadListings(query: URLSearchParams): Promise<ListingCollection> {
  const empty: ListingCollection = {
    data: [],
    pagination: { nextCursor: null, hasMore: false },
  };
  if (hasDatabaseUrl()) {
    try {
      const bedroomsRaw = query.get('bedrooms');
      const bedrooms =
        bedroomsRaw && bedroomsRaw !== '' && Number.isFinite(Number(bedroomsRaw))
          ? Number(bedroomsRaw)
          : undefined;
      const search: PublicListingSearchInput = {
        limit: Number(query.get('limit') ?? 24) || 24,
      };
      const countryCode = query.get('countryCode');
      const governorate = query.get('governorate');
      const wilayat = query.get('wilayat');
      const village = query.get('village');
      const category = asPublicListingCategory(query.get('category'));
      const currency = query.get('currency');
      const purpose = parsePurpose(query.get('purpose') ?? undefined);
      const priceMin = parseMajorPrice(query.get('priceMin') ?? undefined);
      const priceMax = parseMajorPrice(query.get('priceMax') ?? undefined);
      if (countryCode) search.countryCode = countryCode;
      if (governorate) search.governorate = governorate;
      if (wilayat) search.wilayat = wilayat;
      if (village) search.village = village;
      if (category) search.category = category;
      if (bedrooms !== undefined) search.bedrooms = bedrooms;
      if (currency) {
        search.currency = currency as NonNullable<PublicListingSearchInput['currency']>;
      }
      if (purpose) search.purpose = purpose;
      if (priceMin !== undefined) search.priceMin = priceMin;
      if (priceMax !== undefined) search.priceMax = priceMax;
      return await searchPublicListingsFromNeon(search);
    } catch (error) {
      console.error('[properties] Neon catalogue failed', error);
    }
  }
  return publicApiFetch<ListingCollection>(`/v1/public/listings?${query.toString()}`, 30).catch(
    () => empty,
  );
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
  const one = (value: string | string[] | undefined) =>
    typeof value === 'string' ? value : undefined;
  const defaults: PropertyFilterDefaults = {};
  const purposeValue = one(raw.purpose);
  const countryCode = one(raw.countryCode);
  const governorate = one(raw.governorate);
  const wilayat = one(raw.wilayat);
  const village = one(raw.village);
  const category = one(raw.category);
  const bedrooms = one(raw.bedrooms);
  const currency = one(raw.currency);
  const priceMin = one(raw.priceMin);
  const priceMax = one(raw.priceMax);
  if (purposeValue) defaults.purpose = purposeValue;
  if (countryCode) defaults.countryCode = countryCode;
  if (governorate) defaults.governorate = governorate;
  if (wilayat) defaults.wilayat = wilayat;
  if (village) defaults.village = village;
  if (category) defaults.category = category;
  if (bedrooms) defaults.bedrooms = bedrooms;
  if (currency) defaults.currency = currency;
  if (priceMin) defaults.priceMin = priceMin;
  if (priceMax) defaults.priceMax = priceMax;
  const query = new URLSearchParams({ locale, limit: '24' });
  Object.entries(defaults).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const t = await getTranslations();
  const listings = await loadListings(query);
  const purpose = parsePurpose(defaults.purpose);
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
    <>
      <header className="page-hero">
        <div className="container">
          <h1>{heading}</h1>
          <p>{t('Home.featuredHint')}</p>
        </div>
      </header>
      <section className="section">
        <div className="container">
          <PropertyFilters locale={locale} compact defaults={defaults} />
          {listings.data.length ? (
            <div className="listing-grid">
              {listings.data.map((listing) => (
                <ListingCard key={listing.id} listing={listing} locale={locale} />
              ))}
            </div>
          ) : (
            <EmptyState title={t('Common.noResults')} />
          )}
        </div>
      </section>
    </>
  );
}
