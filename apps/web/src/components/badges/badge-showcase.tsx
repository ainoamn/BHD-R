import { BadgeEmblem } from '@/components/badges/badge-emblem';
import { Link } from '@/i18n/navigation';
import type { BadgeShowcase, ShowcaseAward } from '@/lib/badges-neon';
import { LEVEL_LABELS, SUBJECT_LABELS, TIER_LABELS } from '@/lib/badges-shared';

function awardedOn(iso: string | null, ar: boolean): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'Asia/Muscat',
  }).format(new Date(iso));
}

function AwardCard({
  award,
  ar,
  featured = false,
}: {
  award: ShowcaseAward;
  ar: boolean;
  featured?: boolean;
}) {
  const lang = ar ? 'ar' : 'en';
  const name = ar ? award.badgeNameAr : award.badgeNameEn;
  const description = ar ? award.descriptionAr : award.descriptionEn;
  const date = awardedOn(award.awardedAt, ar);
  return (
    <Link
      href={`/verify/badge/${award.serial}`}
      className={`badge-showcase__card${featured ? ' badge-showcase__card--featured' : ''} badge-showcase__card--${award.level}`}
    >
      <BadgeEmblem
        tier={award.tier}
        level={award.level}
        icon={award.icon}
        size={featured ? 104 : 58}
      />
      <span className="badge-showcase__body">
        <span className="badge-showcase__tier">
          {TIER_LABELS[award.tier][lang]} · {LEVEL_LABELS[award.level][lang]}
        </span>
        <strong className="badge-showcase__name">{name}</strong>
        {featured && description ? (
          <span className="badge-showcase__description">{description}</span>
        ) : null}
        <span className="badge-showcase__holder">
          <span className="muted">{SUBJECT_LABELS[award.subjectType][lang]}:</span>{' '}
          <bdi>{award.holder}</bdi>
        </span>
        <span className="badge-showcase__meta">
          <bdi>{ar ? award.organizationNameAr : award.organizationNameEn}</bdi>
          {date ? ` · ${date}` : ''}
        </span>
        <span className="badge-showcase__serial" dir="ltr">
          {award.serial}
        </span>
      </span>
    </Link>
  );
}

/** The platform's most prestigious current awards and who holds them. */
export function BadgeShowcaseSection({
  showcase,
  locale,
  guideLink = true,
}: {
  showcase: BadgeShowcase;
  locale: string;
  guideLink?: boolean;
}) {
  const ar = locale !== 'en';
  const [first, ...rest] = showcase.awards;
  const count = (value: number) => value.toLocaleString(ar ? 'ar-OM' : 'en-GB');
  return (
    <section className="section badge-showcase" aria-labelledby="badge-showcase-title">
      <div className="container">
        <div className="section-heading">
          <div>
            <span className="section-kicker section-kicker--gold">
              {ar ? 'لوحة الشرف' : 'Hall of honour'}
            </span>
            <h2 id="badge-showcase-title">
              {ar ? 'أرفع الشارات والأوسمة الممنوحة' : 'Top badges and medals awarded'}
            </h2>
            <p>
              {ar
                ? 'تُمنح من أداء فعلي مُقاس: تقييمات، التزام بالسداد، سرعة صيانة وإنجاز. لكل شارة شهادة برقم تسلسلي يمكن لأي شخص التحقق منها.'
                : 'Earned from measured performance: ratings, on-time payment, fast maintenance and delivery. Each award has a numbered certificate anyone can verify.'}
            </p>
          </div>
          {guideLink ? (
            <Link className="text-link" href="/badges">
              {ar ? 'ما معنى الشارات؟' : 'What do badges mean?'} <span aria-hidden="true">←</span>
            </Link>
          ) : null}
        </div>
        {first ? (
          <>
            <div className="badge-showcase__grid">
              <AwardCard award={first} ar={ar} featured />
              {rest.length ? (
                <div className="badge-showcase__list">
                  {rest.map((award) => (
                    <AwardCard key={award.serial} award={award} ar={ar} />
                  ))}
                </div>
              ) : null}
            </div>
            <p className="badge-showcase__stats">
              {ar
                ? `${count(showcase.activeCount)} شارة سارية لدى ${count(showcase.holderCount)} عقار وشخص ومنشأة.`
                : `${count(showcase.activeCount)} active awards held by ${count(showcase.holderCount)} properties, people and businesses.`}
            </p>
          </>
        ) : (
          <div className="badge-showcase__empty">
            <BadgeEmblem tier="medal" level="gold" icon="trophy" size={64} muted />
            <p>
              {ar
                ? 'لم تُمنح شارات علنية بعد. ستظهر هنا أرفع الشارات فور منحها.'
                : 'No awards yet. The most prestigious ones will appear here as soon as they are granted.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
