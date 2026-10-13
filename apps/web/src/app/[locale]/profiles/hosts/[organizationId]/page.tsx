import type { Metadata } from 'next';
import { after } from 'next/server';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { hostRoleLabel, hostStockLabel, memberSinceLabel } from '@/components/host-card';
import { HostShareQr } from '@/components/host-share-qr';
import { ListingCatalogueCard } from '@/components/listing-catalogue-card';
import { ReputationView } from '@/components/reviews/reputation-view';
import { ScoreBadge } from '@/components/reviews/review-form';
import { StayCatalogueCard } from '@/components/stays/stay-catalogue-card';
import { reviewCountLabel } from '@/components/stays/stay-rating-badge';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadHostSummary, loadReputation, refreshReviewProfile } from '@/lib/booking-reviews-neon';
import type { CatalogueListing } from '@/lib/listing-market-status';
import { searchPublicListingsFromNeon } from '@/lib/search-public-listings-neon';
import { searchStaysCatalogueFromNeon } from '@/lib/search-stays-catalogue-neon';
import { contractQrSvg } from '@/lib/contract-verify';
import { bilingualAlternates, publicWebOrigin } from '@/lib/seo';
import type { StayCatalogueListing } from '@/lib/stays-catalogue-listing';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { withTimeoutFallback } from '@/lib/with-timeout';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; organizationId: string }>;
}): Promise<Metadata> {
  const { locale, organizationId } = await params;
  return {
    title: locale === 'ar' ? 'ملف المالك وعقاراته وتقييماته' : 'Host profile',
    alternates: bilingualAlternates(locale, `/profiles/hosts/${organizationId}`),
  };
}

/** Public host profile: who owns or manages the listings, their rating, and all their listings. */
export default async function HostProfilePage({
  params,
}: {
  params: Promise<{ locale: string; organizationId: string }>;
}) {
  const { locale: raw, organizationId } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const ar = locale === 'ar';
  if (!hasDatabaseUrl()) notFound();

  const staysLoad: Promise<StayCatalogueListing[]> = isStaysPublicSurfaceEnabled()
    ? withTimeoutFallback(
        searchStaysCatalogueFromNeon({ organizationId, limit: 100 }).then((r) => r.data),
        6_000,
        [],
        'host-stays',
      ).catch(() => [])
    : Promise.resolve([]);
  const listingsLoad: Promise<CatalogueListing[]> = withTimeoutFallback(
    searchPublicListingsFromNeon({ organizationId, limit: 100 }).then((r) => r.data),
    6_000,
    [],
    'host-listings',
  ).catch(() => []);
  const [host, loaded, stays, listings] = await Promise.all([
    loadHostSummary(organizationId).catch(() => null),
    loadReputation('host', organizationId).catch(() => null),
    staysLoad,
    listingsLoad,
  ]);
  if (!host || !loaded) notFound();
  const { reputation, stale } = loaded;
  if (stale) {
    after(() =>
      refreshReviewProfile('host', reputation.key, { oidcToken: null }).catch(() => undefined),
    );
  }
  const name = ar ? host.name.ar : host.name.en;
  const profileUrl = `${publicWebOrigin()}/${locale}/profiles/hosts/${organizationId}`;
  const qrSvg = await contractQrSvg(profileUrl);

  return (
    <main className="section">
      <div className="container party-profile host-profile">
        <header className="party-profile__head profile-head host-profile__head">
          <span className="profile-head__avatar" aria-hidden="true">
            {name.trim().charAt(0) || '؟'}
          </span>
          <div>
            <p className="party-profile__eyebrow">
              {ar ? 'ملف المالك أو مدير العقار' : 'Owner or property manager'} ·{' '}
              <span className={`host-card__role host-card__role--${host.type}`}>
                {hostRoleLabel(host.type, ar)}
              </span>
            </p>
            <h1>
              <bdi>{name}</bdi>
            </h1>
            <p className="muted">
              {hostStockLabel(host, ar)} · {memberSinceLabel(host.memberSince, ar)}
            </p>
          </div>
          {host.score !== null ? (
            <div className="host-profile__score">
              <ScoreBadge score={host.score} ar={ar} size="lg" />
              <small className="muted">
                {ar ? 'تقييم الإدارة · ' : 'Management · '}
                {reviewCountLabel(host.reviews, ar)}
              </small>
            </div>
          ) : null}
        </header>

        <dl className="host-profile__stats">
          <div>
            <dt>{ar ? 'العقارات' : 'Properties'}</dt>
            <dd>{host.properties}</dd>
          </div>
          <div>
            <dt>{ar ? 'الوحدات' : 'Units'}</dt>
            <dd>{host.units}</dd>
          </div>
          <div>
            <dt>{ar ? 'إقامات يومية' : 'Daily stays'}</dt>
            <dd>{stays.length}</dd>
          </div>
          <div>
            <dt>{ar ? 'للإيجار أو البيع' : 'For rent or sale'}</dt>
            <dd>{listings.length}</dd>
          </div>
          <div>
            <dt>{ar ? 'تقييم الإدارة' : 'Management rating'}</dt>
            <dd dir="ltr">{host.score !== null ? host.score.toFixed(1) : '—'}</dd>
          </div>
        </dl>

        <HostShareQr svg={qrSvg} url={profileUrl} name={name} locale={locale} />

        <section className="host-profile__section" aria-labelledby="host-stays-title">
          <h2 id="host-stays-title">
            {ar ? 'الإقامات اليومية' : 'Daily stays'} <small>({stays.length})</small>
          </h2>
          {stays.length ? (
            <div className="listing-grid host-profile__grid">
              {stays.map((stay) => (
                <StayCatalogueCard key={stay.id} listing={stay} locale={locale} />
              ))}
            </div>
          ) : (
            <p className="muted">
              {ar ? 'لا توجد إقامات يومية منشورة الآن.' : 'No daily stays published right now.'}
            </p>
          )}
        </section>

        <section className="host-profile__section" aria-labelledby="host-listings-title">
          <h2 id="host-listings-title">
            {ar ? 'عقارات للإيجار أو البيع' : 'Properties for rent or sale'}{' '}
            <small>({listings.length})</small>
          </h2>
          {listings.length ? (
            <div className="listing-grid host-profile__grid">
              {listings.map((listing) => (
                <ListingCatalogueCard key={listing.id} listing={listing} locale={locale} />
              ))}
            </div>
          ) : (
            <p className="muted">
              {ar
                ? 'لا توجد عقارات معروضة للإيجار أو البيع الآن.'
                : 'No properties listed for rent or sale right now.'}
            </p>
          )}
        </section>

        <ReputationView
          subject="host"
          subjectKey={reputation.key}
          locale={locale}
          initial={reputation}
        />
      </div>
    </main>
  );
}
