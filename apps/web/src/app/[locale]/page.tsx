import { EmptyState } from '@bhd-r/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ListingCard } from '@/components/listing-card';
import { PropertySearch } from '@/components/property-search';
import { publicApiFetch } from '@/lib/server-api';
import type { ListingCollection } from '@/lib/types';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const listings = await publicApiFetch<ListingCollection>(
    `/v1/public/listings?locale=${locale}&limit=6`,
  ).catch(() => ({ data: [], pagination: { nextCursor: null, hasMore: false } }));
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">{t('Home.eyebrow')}</span>
            <h1>{t('Home.title')}</h1>
            <p className="hero-copy">{t('Home.subtitle')}</p>
            <div className="hero-actions">
              <Link href="/properties" className="button button--primary">
                {t('Home.cta')}
              </Link>
              <Link href="/login" className="button button--secondary">
                {t('Nav.login')}
              </Link>
            </div>
          </div>
          <div className="hero-panel">
            <PropertySearch locale={locale} />
          </div>
        </div>
      </section>
      <section className="section" aria-labelledby="featured-title">
        <div className="container">
          <div className="section-heading">
            <div>
              <h2 id="featured-title">{t('Home.featured')}</h2>
              <p>{t('Home.featuredHint')}</p>
            </div>
            <Link href="/properties">{t('Common.viewAll')} ←</Link>
          </div>
          {listings.data.length ? (
            <div className="listing-grid">
              {listings.data.map((listing) => (
                <ListingCard key={listing.id} listing={listing} locale={locale} />
              ))}
            </div>
          ) : (
            <EmptyState title={t('Common.noResults')} description={t('Home.featuredHint')} />
          )}
        </div>
      </section>
      <section id="how-it-works" className="section section--tint">
        <div className="container value-grid">
          <article className="value-card">
            <span aria-hidden="true">01</span>
            <h2>{t('Home.ownerTitle')}</h2>
            <p>{t('Home.ownerText')}</p>
          </article>
          <article className="value-card">
            <span aria-hidden="true">02</span>
            <h2>{t('Home.tenantTitle')}</h2>
            <p>{t('Home.tenantText')}</p>
          </article>
        </div>
      </section>
    </>
  );
}
