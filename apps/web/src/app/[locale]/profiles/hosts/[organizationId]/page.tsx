import type { Metadata } from 'next';
import { after } from 'next/server';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { ReputationView } from '@/components/reviews/reputation-view';
import { ScoreBadge } from '@/components/reviews/review-form';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadReputation, refreshReviewProfile } from '@/lib/booking-reviews-neon';
import { bilingualAlternates } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; organizationId: string }>;
}): Promise<Metadata> {
  const { locale, organizationId } = await params;
  return {
    title: locale === 'ar' ? 'ملف المالك وتقييماته' : 'Host profile',
    alternates: bilingualAlternates(locale, `/profiles/hosts/${organizationId}`),
  };
}

/** Public host profile: how guests rated the host's management across all properties. */
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

  const loaded = await loadReputation('host', organizationId).catch(() => null);
  if (!loaded) notFound();
  const { reputation, stale } = loaded;
  if (stale) {
    after(() =>
      refreshReviewProfile('host', reputation.key, { oidcToken: null }).catch(() => undefined),
    );
  }
  const name = reputation.name ? (ar ? reputation.name.ar : reputation.name.en) : null;

  return (
    <main className="section">
      <div className="container party-profile">
        <header className="party-profile__head profile-head">
          <span className="profile-head__avatar" aria-hidden="true">
            {(name ?? '؟').charAt(0)}
          </span>
          <div>
            <p className="party-profile__eyebrow">{ar ? 'ملف المالك' : 'Host profile'}</p>
            <h1>{name ?? (ar ? 'المالك' : 'Host')}</h1>
            <p className="muted">
              {ar
                ? 'تقييم الضيوف لتعامل المالك وفريقه، وتقييمات عقاراته من ضيوف أقاموا فعلاً.'
                : 'How guests rate the host and their team, from guests who actually stayed.'}
            </p>
          </div>
          {reputation.score !== null ? (
            <ScoreBadge score={reputation.score} ar={ar} size="lg" />
          ) : null}
        </header>
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
