'use client';

import { useEffect, useState } from 'react';
import { ScoreBadge } from '@/components/reviews/review-form';
import {
  criterionLabel,
  groupLabel,
  reviewScoreTone,
  rubricFor,
  type PublicReview,
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

function countLabel(count: number, ar: boolean): string {
  if (!ar) return `${count} verified review${count === 1 ? '' : 's'}`;
  if (count === 1) return 'تقييم موثّق واحد';
  if (count === 2) return 'تقييمان موثّقان';
  return `${count} ${count <= 10 ? 'تقييمات موثّقة' : 'تقييماً موثّقاً'}`;
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
  return (
    <li className="reputation-card">
      <header className="reputation-card__head">
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
          <small className="muted">
            {fromGuest
              ? ar
                ? `أقام في ${monthLabel(review.stayMonth, ar)}`
                : `Stayed ${monthLabel(review.stayMonth, ar)}`
              : `${place ? `${place} · ` : ''}${monthLabel(review.stayMonth, ar)}`}
            {fromGuest && subject !== 'property' && place ? ` · ${place}` : ''}
          </small>
        </div>
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
            <a key={id} href={`/api/public/reviews/photos/${id}`} target="_blank" rel="noreferrer">
              <img
                src={`/api/public/reviews/photos/${id}`}
                alt={ar ? `صورة من التقييم ${index + 1}` : `Review photo ${index + 1}`}
                loading="lazy"
              />
            </a>
          ))}
        </div>
      ) : null}
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
}: {
  subject: ReputationSubject;
  subjectKey: string;
  locale: 'ar' | 'en';
  /** On a property page: link to the host's profile. */
  hostKey?: string | null;
  initial?: Reputation | null;
}) {
  const ar = locale === 'ar';
  const [data, setData] = useState<Reputation | null>(initial ?? null);
  const [loaded, setLoaded] = useState(initial !== undefined);
  const [showAll, setShowAll] = useState(false);

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
  const reviews = data?.reviews ?? [];
  const visible = showAll ? reviews : reviews.slice(0, 4);

  return (
    <section
      className="reputation property-360__section"
      id={subject === 'property' ? 'property-reviews' : undefined}
      aria-labelledby={`reputation-${subject}-title`}
    >
      <header className="reputation__head">
        <h2 id={`reputation-${subject}-title`}>{ar ? title.ar : title.en}</h2>
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
                <strong>{countLabel(data.count, ar)}</strong>
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
                {subject === 'property' && hostKey ? (
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

          <ul className="reputation__list">
            {visible.map((review) => (
              <ReviewCard key={review.id} review={review} subject={subject} locale={locale} />
            ))}
          </ul>
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
