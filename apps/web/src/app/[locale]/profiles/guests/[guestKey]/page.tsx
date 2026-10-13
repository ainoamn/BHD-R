import type { Metadata } from 'next';
import { after } from 'next/server';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { ReputationView } from '@/components/reviews/reputation-view';
import { ScoreBadge } from '@/components/reviews/review-form';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadReputation, refreshReviewProfile } from '@/lib/booking-reviews-neon';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'ar' ? 'ملف الضيف وتقييماته' : 'Guest profile',
    robots: { index: false, follow: false },
  };
}

/** Public guest profile: how hosts rated this guest after their stays. */
export default async function GuestProfilePage({
  params,
}: {
  params: Promise<{ locale: string; guestKey: string }>;
}) {
  const { locale: raw, guestKey } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const ar = locale === 'ar';
  if (!hasDatabaseUrl()) notFound();

  const loaded = await loadReputation('guest', decodeURIComponent(guestKey)).catch(() => null);
  if (!loaded) notFound();
  const { reputation, stale } = loaded;
  if (stale) {
    after(() =>
      refreshReviewProfile('guest', reputation.key, { oidcToken: null }).catch(() => undefined),
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
            <p className="party-profile__eyebrow">{ar ? 'ملف الضيف' : 'Guest profile'}</p>
            <h1>
              <bdi>{name ?? (ar ? 'ضيف' : 'Guest')}</bdi>
            </h1>
            <p className="muted">
              {ar
                ? 'تقييمات المؤجرين بعد كل إقامة، يطّلع عليها المؤجرون قبل قبول الحجز.'
                : 'Host reviews after each stay, which hosts check before accepting a booking.'}
            </p>
          </div>
          {reputation.score !== null ? (
            <ScoreBadge score={reputation.score} ar={ar} size="lg" />
          ) : null}
        </header>
        <ReputationView
          subject="guest"
          subjectKey={reputation.key}
          locale={locale}
          initial={reputation}
        />
      </div>
    </main>
  );
}
