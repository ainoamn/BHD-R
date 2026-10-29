import { Suspense } from 'react';
import Image from 'next/image';
import { EmptyState } from '@bhd-r/ui';
import '../home.css';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BadgeShowcaseSection } from '@/components/badges/badge-showcase';
import { HomeLeaderboardsSection } from '@/components/home/home-leaderboards';
import { ListingCard } from '@/components/listing-card';
import { PropertySearch } from '@/components/property-search';
import { HomeSearchTabs } from '@/components/stays/home-search-tabs';
import { StaySearch } from '@/components/stays/stay-search';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { EMPTY_LEADERBOARDS, type HomeLeaderboards } from '@/lib/leaderboards-shared';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { getShellViewer } from '@/lib/viewer';
import { withTimeoutFallback } from '@/lib/with-timeout';
import type { BadgeShowcase } from '@/lib/badges-neon';
import type { ListingCollection } from '@/lib/types';

const homeCopy = {
  ar: {
    heroNote: 'من عُمان، بمعيار يليق بعقارك',
    subtitle: 'وحدات متاحة لحظياً، عقود إلكترونية، تحصيل وصيانة في منصة واحدة.',
    stats: {
      publicUnits: 'وحدة معروضة',
      properties: 'عقار منشور',
      partners: 'شريك خدمات',
      ratings: 'تقييم موثّق',
    },
    stepsTitle: 'من الإضافة إلى التحصيل',
    steps: [
      ['أضف العقار', 'فردي أو متعدد الوحدات'],
      ['انشر المتاح', 'المؤجر يختفي تلقائياً'],
      ['وقّع العقد', 'توقيع إلكتروني لكل طرف'],
      ['تابع التشغيل', 'فواتير وصيانة وتقارير'],
    ],
    ctaTitle: 'عقار واحد أو محفظة كاملة',
    ctaText: 'حساب BHD واحد، وصلاحيات مستقلة لكل دور.',
    portal: 'افتح مساحتك',
  },
  en: {
    heroNote: 'From Oman, built to a higher property standard',
    subtitle: 'Live availability, e-signed leases, collections and maintenance in one platform.',
    stats: {
      publicUnits: 'listed units',
      properties: 'published properties',
      partners: 'service partners',
      ratings: 'verified ratings',
    },
    stepsTitle: 'From onboarding to collection',
    steps: [
      ['Add the property', 'Single or multi-unit'],
      ['Publish availability', 'Leased units hide themselves'],
      ['Sign the lease', 'E-signature for every party'],
      ['Run operations', 'Invoices, upkeep, reports'],
    ],
    ctaTitle: 'One property or a full portfolio',
    ctaText: 'One BHD account, separate permissions for every role.',
    portal: 'Open your workspace',
  },
} as const;

type HomeCopy = (typeof homeCopy)[keyof typeof homeCopy];

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

function HomeBodySkeleton({ locale }: { locale: string }) {
  return (
    <div className="section" aria-busy="true">
      <div className="container">
        <div className="route-skeleton">
          <div className="route-skeleton__line route-skeleton__line--lg" />
          <div className="route-skeleton__line" />
          <div className="route-skeleton__grid">
            <div className="route-skeleton__card" />
            <div className="route-skeleton__card" />
            <div className="route-skeleton__card" />
          </div>
          <p className="muted route-skeleton__label">
            {locale === 'ar' ? 'جاري تحميل المحتوى…' : 'Loading content…'}
          </p>
        </div>
      </div>
    </div>
  );
}

async function HomeDeferredBody({
  locale,
  copy,
  featuredTitle,
  featuredHint,
  availableNow,
  viewAll,
  noResults,
}: {
  locale: string;
  copy: HomeCopy;
  featuredTitle: string;
  featuredHint: string;
  availableNow: string;
  viewAll: string;
  noResults: string;
}) {
  const emptyListings = { data: [], pagination: { nextCursor: null, hasMore: false } };
  const emptyShowcase: BadgeShowcase = { awards: [], activeCount: 0, holderCount: 0 };
  const database = hasDatabaseUrl();

  const [viewer, showcase, leaders, listings] = await Promise.all([
    getShellViewer().catch(() => null),
    database
      ? import('@/lib/badges-neon')
          .then(({ loadBadgeShowcaseSafe }) => loadBadgeShowcaseSafe(4))
          .catch(() => emptyShowcase)
      : emptyShowcase,
    database
      ? import('@/lib/home-leaderboards-neon')
          .then(({ loadHomeLeaderboardsSafe }) => loadHomeLeaderboardsSafe())
          .catch((): HomeLeaderboards => EMPTY_LEADERBOARDS)
      : EMPTY_LEADERBOARDS,
    database
      ? import('@/lib/search-public-listings-neon')
          .then(({ searchPublicListingsFromNeon }) =>
            withTimeoutFallback(
              searchPublicListingsFromNeon({ limit: 6 }),
              8_000,
              emptyListings as ListingCollection,
              'home-neon',
            ),
          )
          .catch(() => emptyListings as ListingCollection)
      : (emptyListings as ListingCollection),
  ]);
  const signedIn = Boolean(viewer);
  const workspaceHref = `/${locale}/portal`;
  const signInHref = `/api/auth/bhd/start?returnTo=${encodeURIComponent(workspaceHref)}`;
  const stats = (Object.keys(copy.stats) as (keyof typeof copy.stats)[])
    .map((key) => ({ key, value: leaders.stats[key], label: copy.stats[key] }))
    .filter((stat) => stat.value > 0);

  return (
    <>
      {stats.length ? (
        <div className="container home-deferred-stats">
          <ul
            className="home-hero__stats home-hero__stats--below"
            aria-label={locale === 'ar' ? 'أرقام حية' : 'Live numbers'}
          >
            {stats.map((stat) => (
              <li key={stat.key}>
                <strong>
                  {stat.value.toLocaleString(locale === 'ar' ? 'ar-OM-u-nu-latn' : 'en')}
                </strong>
                <span>{stat.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <HomeLeaderboardsSection data={leaders} locale={locale} />

      <section className="home-section" aria-labelledby="featured-title">
        <div className="container">
          <header className="home-head">
            <div>
              <span className="home-head__kicker">{availableNow}</span>
              <h2 id="featured-title">{featuredTitle}</h2>
              <p>{featuredHint}</p>
            </div>
            <Link className="home-head__link" href="/properties">
              {viewAll}
            </Link>
          </header>
          {listings.data.length ? (
            <div className="listing-grid home-listings">
              {listings.data.map((listing) => (
                <ListingCard key={listing.id} listing={listing} locale={locale} />
              ))}
            </div>
          ) : (
            <EmptyState title={noResults} description={featuredHint} />
          )}
        </div>
      </section>

      <div className="home-showcase">
        <BadgeShowcaseSection showcase={showcase} locale={locale} />
      </div>

      <section
        id="how-it-works"
        className="home-section home-flow"
        aria-labelledby="home-flow-title"
      >
        <div className="container home-flow__inner">
          <div className="home-flow__steps">
            <h2 id="home-flow-title">{copy.stepsTitle}</h2>
            <ol>
              {copy.steps.map(([title, text], index) => (
                <li key={title}>
                  <span aria-hidden="true">{index + 1}</span>
                  <div>
                    <strong>{title}</strong>
                    <small>{text}</small>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="home-flow__cta">
            <strong>{copy.ctaTitle}</strong>
            <p>{copy.ctaText}</p>
            {signedIn ? (
              <Link href="/portal" className="button button--gold button--small">
                {copy.portal}
              </Link>
            ) : (
              <a href={signInHref} className="button button--gold button--small">
                {copy.portal}
              </a>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { assertPublicSitePage } = await import('@/lib/site-page-gate');
  await assertPublicSitePage('home');
  const t = await getTranslations();
  const copy = homeCopy[locale === 'en' ? 'en' : 'ar'];
  const workspaceHref = `/${locale}/portal`;
  const signInHref = `/api/auth/bhd/start?returnTo=${encodeURIComponent(workspaceHref)}`;

  return (
    <>
      <link rel="preload" as="image" href="/images/oman/fort-bg.webp" fetchPriority="high" />
      <section className="home-hero">
        <Image
          className="home-hero__image"
          src="/images/oman/fort-bg.webp"
          alt=""
          fill
          priority
          sizes="100vw"
        />
        <div className="home-hero__veil" aria-hidden="true" />
        <div className="container home-hero__inner">
          <div className="home-hero__copy">
            <span className="home-hero__note">{copy.heroNote}</span>
            <h1>{t('Home.title')}</h1>
            <p>{copy.subtitle}</p>
            <div className="home-hero__actions">
              <Link href="/properties" className="button button--gold button--small">
                {t('Home.cta')}
              </Link>
              <a href={signInHref} className="button button--glass button--small">
                {t('Nav.login')}
              </a>
            </div>
          </div>
          <div className="hero-search home-hero__search">
            {isStaysPublicSurfaceEnabled() ? (
              <div className="hero-search__booking-wrap">
                <HomeSearchTabs
                  locale={locale}
                  rentSearch={<PropertySearch locale={locale} defaults={{ purpose: 'rent' }} />}
                  saleSearch={<PropertySearch locale={locale} defaults={{ purpose: 'sale' }} />}
                  staySearch={<StaySearch locale={locale} variant="hero" />}
                />
              </div>
            ) : (
              <PropertySearch locale={locale} />
            )}
          </div>
        </div>
      </section>

      <Suspense fallback={<HomeBodySkeleton locale={locale} />}>
        <HomeDeferredBody
          locale={locale}
          copy={copy}
          featuredTitle={t('Home.featured')}
          featuredHint={t('Home.featuredHint')}
          availableNow={t('Home.availableNow')}
          viewAll={t('Common.viewAll')}
          noResults={t('Common.noResults')}
        />
      </Suspense>
    </>
  );
}
