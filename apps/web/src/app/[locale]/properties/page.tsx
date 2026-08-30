import type { Metadata } from 'next';
import { EmptyState } from '@bhd-r/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingCard } from '@/components/listing-card';
import { PropertySearch } from '@/components/property-search';
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
      const category = asPublicListingCategory(query.get('category'));
      const currency = query.get('currency');
      if (countryCode) search.countryCode = countryCode;
      if (governorate) search.governorate = governorate;
      if (category) search.category = category;
      if (bedrooms !== undefined) search.bedrooms = bedrooms;
      if (currency) {
        search.currency = currency as NonNullable<PublicListingSearchInput['currency']>;
      }
      const neon = await searchPublicListingsFromNeon(search);
      if (neon.data.length) return neon;
    } catch {
      /* fall through to Nest */
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
  const defaults = {
    countryCode: one(raw.countryCode),
    governorate: one(raw.governorate),
    category: one(raw.category),
    bedrooms: one(raw.bedrooms),
    currency: one(raw.currency),
  };
  const query = new URLSearchParams({ locale, limit: '24' });
  Object.entries(defaults).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const t = await getTranslations();
  const listings = await loadListings(query);
  return (
    <>
      <header className="page-hero">
        <div className="container">
          <h1>{t('Nav.available')}</h1>
          <p>{t('Home.featuredHint')}</p>
        </div>
      </header>
      <section className="section">
        <div className="container">
          <PropertySearch locale={locale} compact defaults={defaults} />
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
