import type { Metadata } from 'next';
import { EmptyState } from '@bhd-r/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListingCard } from '@/components/listing-card';
import { PropertySearch } from '@/components/property-search';
import { publicApiFetch } from '@/lib/server-api';
import type { ListingCollection } from '@/lib/types';

export const metadata: Metadata = {
  title: 'العقارات المتاحة | Available properties',
  description: 'وحدات منشورة ومتاحة فعلياً للإيجار عبر BHD R.',
};

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
  const listings = await publicApiFetch<ListingCollection>(
    `/v1/public/listings?${query.toString()}`,
    30,
  ).catch(() => ({ data: [], pagination: { nextCursor: null, hasMore: false } }));
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
