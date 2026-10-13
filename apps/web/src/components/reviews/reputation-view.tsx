'use client';

import { useEffect, useState } from 'react';
import { ScoreBadge } from '@/components/reviews/review-form';
import {
  criterionLabel,
  groupLabel,
  reviewScoreTone,
  rubricFor,
  travellerLabel,
  type PublicReview,
  type TravellerType,
  type Reputation,
  type ReputationSubject,
  type ReviewDirection,
} from '@/lib/review-rubric';

function monthLabel(month: string, ar: boolean): string {
  const date = new Date(`${month}-15T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function dayLabel(iso: string, ar: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

/** Arabic count phrase: one / two / 3–10 / 11+ forms. */
function arCount(count: number, one: string, two: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count === 2) return two;
  return `${count} ${count <= 10 ? few : many}`;
}

function countLabel(count: number, ar: boolean): string {
  if (!ar) return `${count} verified review${count === 1 ? '' : 's'}`;
  return arCount(count, 'تقييم موثّق واحد', 'تقييمان موثّقان', 'تقييمات موثّقة', 'تقييماً موثّقاً');
}

function nightsLabel(nights: number, ar: boolean): string {
  if (!ar) return `${nights} night${nights === 1 ? '' : 's'}`;
  return arCount(nights, 'ليلة واحدة', 'ليلتان', 'ليالٍ', 'ليلة');
}

function guestsLabel(guests: number, ar: boolean): string {
  if (!ar) return `${guests} guest${guests === 1 ? '' : 's'}`;
  return arCount(guests, 'ضيف واحد', 'ضيفان', 'ضيوف', 'ضيفاً');
}

const RATED_WHAT: Record<ReputationSubject, [string, string]> = {
  unit: ['هذه الإقامة', 'this stay'],
  property: ['هذا العقار', 'this property'],
  host: ['إدارة هذا المالك', 'this host'],
  guest: ['هذا الضيف', 'this guest'],
};

/** «3 ضيوف قيّموا هذه الإقامة» — like Booking's reviewer count. */
function reviewersLabel(subject: ReputationSubject, reviewers: number, ar: boolean): string {
  const [whatAr, whatEn] = RATED_WHAT[subject];
  if (subject === 'guest') {
    if (!ar) return `${reviewers} host${reviewers === 1 ? '' : 's'} rated ${whatEn}`;
    return reviewers === 1
      ? `مؤجر واحد قيّم ${whatAr}`
      : `${arCount(reviewers, '', 'مؤجران', 'مؤجرين', 'مؤجراً')} قيّموا ${whatAr}`;
  }
  if (!ar) return `${reviewers} guest${reviewers === 1 ? '' : 's'} rated ${whatEn}`;
  return reviewers === 1
    ? `ضيف واحد قيّم ${whatAr}`
    : `${arCount(reviewers, '', 'ضيفان', 'ضيوف', 'ضيفاً')} قيّموا ${whatAr}`;
}

const FACT_PATHS: Record<'place' | 'unit' | 'date' | 'party', string> = {
  place: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5.5h4V20',
  unit: 'M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 14h18M7 9V6h4v3M3 18v2M21 18v2',
  date: 'M4 6.5h16V20H4zM4 10.5h16M8.5 4v4M15.5 4v4',
  party:
    'M9 11a3.25 3.25 0 1 0 0-6.5A3.25 3.25 0 0 0 9 11ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11.2a3 3 0 1 0-.8-5.9M17.5 14.4c2 .7 3.5 2.9 3.5 5.6',
};

function FactIcon({ kind }: { kind: keyof typeof FACT_PATHS }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        d={FACT_PATHS[kind]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Bar({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="reputation__bar">
      <span>{label}</span>
      <span className="reputation__track" aria-hidden="true">
        <span
          className={`reputation__fill reputation__fill--${score === null ? 'none' : reviewScoreTone(score)}`}
          style={{ width: `${score === null ? 0 : Math.max(4, score * 10)}%` }}
        />
      </span>
      <strong dir="ltr">{score === null ? '—' : score.toFixed(1)}</strong>
    </div>
  );
}

function ReviewCard({
  review,
  subject,
  locale,
}: {
  review: PublicReview;
  subject: ReputationSubject;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const fromGuest = review.direction === 'guest_to_host';
  const name = fromGuest
    ? (review.authorName ?? (ar ? 'ضيف' : 'Guest'))
    : review.hostName
      ? ar
        ? review.hostName.ar
        : review.hostName.en
      : ar
        ? 'المؤجر'
        : 'Host';
  const nameHref = fromGuest
    ? review.guestKey
      ? `/${locale}/profiles/guests/${encodeURIComponent(review.guestKey)}`
      : null
    : `/${locale}/profiles/hosts/${encodeURIComponent(review.hostKey)}`;
  const place = review.propertyName ? (ar ? review.propertyName.ar : review.propertyName.en) : null;
  const shownScore =
    subject === 'host' && review.hostScore !== null ? review.hostScore : review.score;
  const stayed = [
    review.nights ? nightsLabel(review.nights, ar) : null,
    monthLabel(review.stayMonth, ar),
  ]
    .filter(Boolean)
    .join(' · ');
  const countSaysMore =
    review.traveller === 'family' || review.traveller === 'group' || !review.traveller;
  const party = [
    review.traveller ? travellerLabel(review.traveller, ar) : null,
    review.guests && countSaysMore ? guestsLabel(review.guests, ar) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const unit = review.unitName ? (ar ? review.unitName.ar : review.unitName.en) : null;
  const reviewedOn = dayLabel(review.createdAt, ar);
  return (
    <li className="reputation-card">
      <aside className="reputation-card__guest">
        <div className="reputation-card__head">
          <span className="reputation-card__avatar" aria-hidden="true">
            {name.trim().charAt(0)}
          </span>
          <div className="reputation-card__who">
            {nameHref ? (
              <a href={nameHref}>
                <bdi>{name}</bdi>
              </a>
            ) : (
              <bdi>{name}</bdi>
            )}
            {!fromGuest && place ? <small className="muted">{place}</small> : null}
          </div>
        </div>
        <ul className="reputation-card__facts">
          {fromGuest && subject !== 'property' && subject !== 'unit' && place ? (
            <li>
              <FactIcon kind="place" />
              <bdi>{place}</bdi>
            </li>
          ) : null}
          {fromGuest && unit && subject !== 'unit' ? (
            <li>
              <FactIcon kind="unit" />
              <bdi>{unit}</bdi>
            </li>
          ) : null}
          <li>
            <FactIcon kind="date" />
            <span>{fromGuest ? stayed : monthLabel(review.stayMonth, ar)}</span>
          </li>
          {party ? (
            <li>
              <FactIcon kind="party" />
              <span>{party}</span>
            </li>
          ) : null}
        </ul>
      </aside>
      <div className="reputation-card__main">
        <header className="reputation-card__top">
          <small className="muted">
            {reviewedOn ? (ar ? `تاريخ التقييم: ${reviewedOn}` : `Reviewed: ${reviewedOn}`) : null}
          </small>
          <ScoreBadge score={shownScore} ar={ar} size="sm" />
        </header>
        <div className="reputation-card__groups">
          {review.groups.map((group) =>
            group.score === null ? null : (
              <span key={group.key}>
                {groupLabel(review.direction, group.key, ar)}{' '}
                <strong dir="ltr">{group.score.toFixed(1)}</strong>
              </span>
            ),
          )}
          {review.recommend !== null ? (
            <span className={review.recommend ? 'reputation-card__yes' : 'reputation-card__no'}>
              {review.recommend
                ? fromGuest
                  ? ar
                    ? 'ينصح بالعقار'
                    : 'Recommends'
                  : ar
                    ? 'يستضيفه مجدداً'
                    : 'Would host again'
                : fromGuest
                  ? ar
                    ? 'لا ينصح'
                    : 'Does not recommend'
                  : ar
                    ? 'لن يستضيفه مجدداً'
                    : 'Would not host again'}
            </span>
          ) : null}
        </div>
        {review.comment ? (
          <blockquote className="reputation-card__comment" dir="auto">
            {review.comment}
          </blockquote>
        ) : review.commentHidden ? (
          <p className="muted reputation-card__hidden">
            {ar
              ? 'أُخفي التعليق لمخالفته سياسة النشر، وبقيت الدرجات.'
              : 'The comment was hidden for breaking the posting rules; the scores remain.'}
          </p>
        ) : null}
        {review.summary ? (
          <p className="reputation-card__ai">
            <span aria-hidden="true">✦</span> {ar ? review.summary.ar : review.summary.en}
          </p>
        ) : null}
        {review.highlights.length || review.concerns.length ? (
          <ul className="reputation-card__points">
            {review.highlights.map((item) => (
              <li key={`h-${item.en}`} className="reputation-card__point--good">
                {ar ? item.ar : item.en}
              </li>
            ))}
            {review.concerns.map((item) => (
              <li key={`c-${item.en}`} className="reputation-card__point--bad">
                {ar ? item.ar : item.en}
              </li>
            ))}
          </ul>
        ) : null}
        {review.photoIds.length ? (
          <div className="reputation-card__photos">
            {review.photoIds.map((id, index) => (
              <a
                key={id}
                href={`/api/public/reviews/photos/${id}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={`/api/public/reviews/photos/${id}`}
                  alt={ar ? `صورة من التقييم ${index + 1}` : `Review photo ${index + 1}`}
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

const TITLES: Record<
  ReputationSubject,
  { ar: string; en: string; leadAr: string; leadEn: string }
> = {
  property: {
    ar: 'تقييمات الضيوف',
    en: 'Guest reviews',
    leadAr:
      'تقييمات موثّقة من ضيوف أقاموا فعلاً، تُكتب بعد المغادرة: النظافة بتفاصيلها، والعقار، وتعامل الإدارة.',
    leadEn:
      'Verified reviews from guests who actually stayed, written after check-out: detailed cleanliness, the property and the management.',
  },
  unit: {
    ar: 'تقييمات الضيوف لهذه الإقامة',
    en: 'Guest reviews of this stay',
    leadAr:
      'كل تقييمات الضيوف الذين أقاموا في هذه الوحدة، وتعليقاتهم كاملة: النظافة، والعقار، والمالك أو شركة الإدارة، والموظفون.',
    leadEn:
      'Every review from guests who stayed in this unit, with their full comments: cleanliness, the property, the owner or management company, and the staff.',
  },
  host: {
    ar: 'تقييم الضيوف لإدارة المالك',
    en: 'How guests rate this host',
    leadAr: 'متوسط تقييم الضيوف لتعامل المالك وفريقه عبر كل عقاراته.',
    leadEn: 'Guests’ average rating of the host and their team, across all their properties.',
  },
  guest: {
    ar: 'تقييمات المؤجرين لهذا الضيف',
    en: 'How hosts rate this guest',
    leadAr:
      'تقييمات موثّقة كتبها المؤجرون بعد مغادرة الضيف: النظافة، والمحافظة على المكان، والسلوك، والالتزام بالدفع والمواعيد.',
    leadEn:
      'Verified reviews hosts wrote after the guest left: cleanliness, care of the place, conduct, payment and timing.',
  },
};

export function ReputationView({
  subject,
  subjectKey,
  locale,
  hostKey = null,
  initial,
  showAllReviews = false,
  titleId,
}: {
  subject: ReputationSubject;
  subjectKey: string;
  locale: 'ar' | 'en';
  /** On a property page: link to the host's profile. */
  hostKey?: string | null;
  initial?: Reputation | null;
  /** List every loaded review at once instead of the first four. */
  showAllReviews?: boolean;
  titleId?: string;
}) {
  const ar = locale === 'ar';
  const [data, setData] = useState<Reputation | null>(initial ?? null);
  const [loaded, setLoaded] = useState(initial !== undefined);
  const [showAll, setShowAll] = useState(showAllReviews);

  useEffect(() => {
    if (initial !== undefined) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/public/reputation?subject=${subject}&key=${encodeURIComponent(subjectKey)}`,
          { signal: controller.signal, headers: { accept: 'application/json' } },
        );
        if (response.ok) {
          const payload = (await response.json()) as { reputation?: Reputation };
          setData(payload.reputation ?? null);
        }
      } catch {
        /* the section stays empty */
      } finally {
        if (!controller.signal.aborted) setLoaded(true);
      }
    })();
    return () => controller.abort();
  }, [initial, subject, subjectKey]);

  const title = TITLES[subject];
  const direction: ReviewDirection = subject === 'guest' ? 'host_to_guest' : 'guest_to_host';
  const groups = (data?.groups ?? []).filter((group) =>
    subject === 'host'
      ? rubricFor(direction).find((item) => item.key === group.key)?.side === 'host'
      : true,
  );
  const [traveller, setTraveller] = useState<TravellerType | 'all'>('all');
  const allReviews = data?.reviews ?? [];
  const reviews =
    traveller === 'all' ? allReviews : allReviews.filter((item) => item.traveller === traveller);
  const visible = showAll ? reviews : reviews.slice(0, 4);
  const travellers = data?.travellers ?? [];
  const showTravellers = subject !== 'guest' && travellers.some((item) => item.count > 0);

  return (
    <section
      className="reputation property-360__section"
      id={subject === 'property' ? 'property-reviews' : undefined}
      aria-labelledby={titleId ?? `reputation-${subject}-title`}
    >
      <header className="reputation__head">
        <h2 id={titleId ?? `reputation-${subject}-title`}>{ar ? title.ar : title.en}</h2>
        <p className="muted">{ar ? title.leadAr : title.leadEn}</p>
      </header>

      {!loaded ? (
        <p className="muted">{ar ? 'جارٍ تحميل التقييمات…' : 'Loading reviews…'}</p>
      ) : !data || !data.count ? (
        <div className="reputation__empty">
          <strong>{ar ? 'لا توجد تقييمات بعد' : 'No reviews yet'}</strong>
          <p className="muted">
            {subject === 'guest'
              ? ar
                ? 'لم يقيّم أي مؤجر هذا الضيف حتى الآن.'
                : 'No host has rated this guest yet.'
              : ar
                ? 'تظهر هنا تقييمات الضيوف بعد انتهاء إقاماتهم.'
                : 'Guest reviews appear here after their stays.'}
          </p>
        </div>
      ) : (
        <>
          <div className="reputation__summary">
            <div className="reputation__overall">
              {data.score !== null ? <ScoreBadge score={data.score} ar={ar} size="lg" /> : null}
              <div>
                <strong className="reputation__reviewers">
                  {reviewersLabel(subject, data.reviewers || data.count, ar)}
                </strong>
                <span className="muted">{countLabel(data.count, ar)}</span>
                {data.recommendRate !== null ? (
                  <span className="muted">
                    {subject === 'guest'
                      ? ar
                        ? `${data.recommendRate}% من المؤجرين يستضيفونه مجدداً`
                        : `${data.recommendRate}% of hosts would host again`
                      : ar
                        ? `${data.recommendRate}% من الضيوف ينصحون به`
                        : `${data.recommendRate}% of guests recommend it`}
                  </span>
                ) : null}
                {(subject === 'property' || subject === 'unit') && hostKey ? (
                  <a
                    className="reputation__host-link"
                    href={`/${locale}/profiles/hosts/${hostKey}`}
                  >
                    {ar ? 'ملف المالك وتقييم إدارته ←' : 'Host profile and rating →'}
                  </a>
                ) : null}
              </div>
            </div>
            <div className="reputation__bars">
              {groups.map((group) => (
                <Bar
                  key={group.key}
                  label={groupLabel(direction, group.key, ar)}
                  score={group.score}
                />
              ))}
            </div>
          </div>

          {data.profile && (data.profile.summary || data.profile.strengths.length) ? (
            <div className="reputation__ai">
              <span className="reputation__ai-badge">
                <span aria-hidden="true">✦</span>{' '}
                {data.profile.engine === 'ai'
                  ? ar
                    ? 'خلاصة الذكاء الاصطناعي'
                    : 'AI summary'
                  : ar
                    ? 'أبرز ما تكرّر في التقييمات'
                    : 'What reviews keep mentioning'}
              </span>
              {data.profile.summary ? (
                <p>{ar ? data.profile.summary.ar : data.profile.summary.en}</p>
              ) : null}
              <div className="reputation__ai-lists">
                {data.profile.strengths.length ? (
                  <ul className="reputation__ai-good">
                    {data.profile.strengths.map((item) => (
                      <li key={item.en}>{ar ? item.ar : item.en}</li>
                    ))}
                  </ul>
                ) : null}
                {data.profile.watchouts.length ? (
                  <ul className="reputation__ai-bad">
                    {data.profile.watchouts.map((item) => (
                      <li key={item.en}>{ar ? item.ar : item.en}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          <details className="reputation__criteria">
            <summary>{ar ? 'تفاصيل البنود' : 'Score by item'}</summary>
            <div className="reputation__bars">
              {data.criteria
                .filter((item) => item.count > 0)
                .filter((item) =>
                  subject === 'host'
                    ? rubricFor(direction).some(
                        (group) =>
                          group.side === 'host' &&
                          group.criteria.some((criterion) => criterion.key === item.key),
                      )
                    : true,
                )
                .map((item) => (
                  <Bar
                    key={item.key}
                    label={criterionLabel(direction, item.key, ar)}
                    score={item.score}
                  />
                ))}
            </div>
          </details>

          {showTravellers ? (
            <div
              className="reputation__travellers"
              role="group"
              aria-label={ar ? 'تصفية حسب نوع الضيوف' : 'Filter by traveller type'}
            >
              <span className="reputation__travellers-label">
                {ar ? 'المقيّمون:' : 'Reviewers:'}
              </span>
              <button
                type="button"
                aria-pressed={traveller === 'all'}
                onClick={() => setTraveller('all')}
              >
                {ar ? 'الكل' : 'All'} <span dir="ltr">({data.count})</span>
              </button>
              {travellers.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  aria-pressed={traveller === item.type}
                  disabled={item.count === 0}
                  onClick={() => setTraveller(item.type)}
                >
                  {travellerLabel(item.type, ar, true)} <span dir="ltr">({item.count})</span>
                </button>
              ))}
            </div>
          ) : null}

          <ul className="reputation__list">
            {visible.map((review) => (
              <ReviewCard key={review.id} review={review} subject={subject} locale={locale} />
            ))}
          </ul>
          {!reviews.length ? (
            <p className="muted">
              {ar ? 'لا توجد تقييمات معروضة من هذا النوع.' : 'No reviews of this type shown.'}
            </p>
          ) : null}
          {reviews.length > visible.length ? (
            <button
              type="button"
              className="button button--quiet reputation__more"
              onClick={() => setShowAll(true)}
            >
              {ar ? `عرض كل التقييمات (${reviews.length})` : `Show all reviews (${reviews.length})`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
