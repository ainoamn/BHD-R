import type { Metadata } from 'next';
import { EmptyState } from '@bhd-r/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { StayCard, type StayCardListing } from '@/components/stays/stay-card';
import { StaySearch } from '@/components/stays/stay-search';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { publicApiFetch } from '@/lib/server-api';

type SearchResult = {
  items?: StayCardListing[];
  nextCursor?: string | null;
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const query = await searchParams;
  const dated = typeof query.checkInOn === 'string' || typeof query.checkOutOn === 'string';
  return {
    robots: dated ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isStaysPublicSurfaceEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Stays');
  const query = await searchParams;

  const pick = (key: string) => {
    const value = query[key];
    return typeof value === 'string' ? value : undefined;
  };

  const destination = pick('destination');
  const checkInOn = pick('checkInOn');
  const checkOutOn = pick('checkOutOn');
  const adults = pick('adults');
  const children = pick('children');

  const qs = new URLSearchParams();
  qs.set('locale', locale === 'en' ? 'en' : 'ar');
  if (destination) qs.set('governorate', destination);
  if (checkInOn) qs.set('checkInOn', checkInOn);
  if (checkOutOn) qs.set('checkOutOn', checkOutOn);
  if (adults) qs.set('adults', adults);
  if (children) qs.set('children', children);

  const result = await publicApiFetch<SearchResult>(
    `/v1/public/stays/search?${qs.toString()}`,
    8,
  ).catch(() => ({ items: [] as StayCardListing[] }));

  const items = result.items ?? [];

  return (
    <div className="container section stays-public">
      <header className="section-heading">
        <div>
          <span className="section-kicker">BHD R</span>
          <h1>{t('searchTitle')}</h1>
          <p className="muted">{t('shellHint')}</p>
        </div>
      </header>

      <StaySearch
        locale={locale}
        defaults={{
          ...(destination ? { destination } : {}),
          ...(checkInOn ? { checkInOn } : {}),
          ...(checkOutOn ? { checkOutOn } : {}),
          ...(adults ? { adults } : {}),
          ...(children ? { children } : {}),
        }}
      />

      {items.length ? (
        <div className="listing-grid stays-public__grid">
          {items.map((listing) => (
            <StayCard
              key={listing.slug}
              listing={listing}
              locale={locale}
              query={{
                ...(checkInOn ? { checkInOn } : {}),
                ...(checkOutOn ? { checkOutOn } : {}),
                ...(adults ? { adults } : {}),
                ...(children ? { children } : {}),
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState title={t('noResults')} description={t('comingOnline')} />
      )}
    </div>
  );
}
