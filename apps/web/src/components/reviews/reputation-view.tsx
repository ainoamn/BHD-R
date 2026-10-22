'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ModalPortal } from '@/components/modal-portal';
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

const PREVIEW_LIMIT = 4;

function sortReviewsNewestFirst(reviews: readonly PublicReview[]): PublicReview[] {
  return [...reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

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

function reviewFacts(review: PublicReview, subject: ReputationSubject, locale: 'ar' | 'en') {
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
  return { ar, fromGuest, name, nameHref, place, shownScore, stayed, party, unit, reviewedOn };
}

function ReviewerName({ name, href }: { name: string; href: string | null }) {
  return href ? (
    <a href={href}>
      <bdi>{name}</bdi>
    </a>
  ) : (
    <bdi>{name}</bdi>
  );
}

function RecommendChip({ review, ar }: { review: PublicReview; ar: boolean }) {
  if (review.recommend === null) return null;
  const fromGuest = review.direction === 'guest_to_host';
  return (
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
  );
}

/** Table view: one row per review; the comment is clamped until opened. */
function ReviewRow({
  review,
  subject,
  locale,
}: {
  review: PublicReview;
  subject: ReputationSubject;
  locale: 'ar' | 'en';
}) {
  const facts = reviewFacts(review, subject, locale);
  const { ar } = facts;
  const [open, setOpen] = useState(false);
  const long = (review.comment?.length ?? 0) > 140;
  return (
    <tr>
      <td data-label={ar ? 'الضيف' : 'Guest'}>
        <span className="reputation-table__who">
          <span className="reputation-card__avatar" aria-hidden="true">
            {facts.name.trim().charAt(0)}
          </span>
          <span>
            <ReviewerName name={facts.name} href={facts.nameHref} />
            {facts.party ? <small className="muted">{facts.party}</small> : null}
          </span>
        </span>
      </td>
      <td data-label={ar ? 'الإقامة' : 'Stay'}>
        <span>
          {facts.fromGuest ? facts.stayed : monthLabel(review.stayMonth, ar)}
          {facts.fromGuest && facts.unit && subject !== 'unit' ? (
            <small className="muted">
              <bdi>{facts.unit}</bdi>
            </small>
          ) : null}
        </span>
      </td>
      <td data-label={ar ? 'الدرجة' : 'Score'}>
        <ScoreBadge score={facts.shownScore} ar={ar} size="sm" />
      </td>
      <td data-label={ar ? 'التعليق' : 'Comment'} className="reputation-table__comment">
        <div>
          {review.comment ? (
            <>
              <p className={open ? undefined : 'is-clamped'} dir="auto">
                {review.comment}
              </p>
              {long ? (
                <button
                  type="button"
                  className="reputation-table__more"
                  onClick={() => setOpen(!open)}
                >
                  {open ? (ar ? 'أقل' : 'Less') : ar ? 'التعليق كاملاً' : 'Full comment'}
                </button>
              ) : null}
            </>
          ) : review.commentHidden ? (
            <span className="muted">{ar ? 'أُخفي التعليق' : 'Comment hidden'}</span>
          ) : (
            <span className="muted">{ar ? 'بلا تعليق' : 'No comment'}</span>
          )}
          <span className="reputation-card__groups">
            <RecommendChip review={review} ar={ar} />
          </span>
        </div>
      </td>
      <td data-label={ar ? 'تاريخ التقييم' : 'Reviewed'}>{facts.reviewedOn}</td>
    </tr>
  );
}

const photoSrc = (id: string) => `/api/public/reviews/photos/${id}`;

/** Full-screen viewer over the page: swipe or use the arrows between the review's photos. */
function PhotoViewer({
  ids,
  start,
  ar,
  onClose,
}: {
  ids: string[];
  start: number;
  ar: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);

  const slideAt = (at: number) => trackRef.current?.children[at] as HTMLElement | undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    document.documentElement.classList.add('photo-viewer-open');
    slideAt(start)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
    // Closing here would fire a deferred `close` event and unmount the viewer on re-run;
    // unmounting the element already removes it from the top layer.
    return () => document.documentElement.classList.remove('photo-viewer-open');
  }, [start]);

  function go(next: number) {
    const target = Math.max(0, Math.min(ids.length - 1, next));
    slideAt(target)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  function onScroll() {
    const track = trackRef.current;
    if (!track?.clientWidth) return;
    setIndex(Math.round(Math.abs(track.scrollLeft) / track.clientWidth));
  }

  const close = () => dialogRef.current?.close();
  const step = ar ? -1 : 1;

  return (
    <dialog
      ref={dialogRef}
      className="photo-viewer"
      aria-label={ar ? 'صور التقييم' : 'Review photos'}
      onClose={onClose}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target === event.currentTarget || target.classList.contains('photo-viewer__slide')) {
          close();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(index + step);
        else if (event.key === 'ArrowLeft') go(index - step);
      }}
    >
      <div className="photo-viewer__bar">
        <span dir="ltr">
          {index + 1} / {ids.length}
        </span>
        <button type="button" className="photo-viewer__close" onClick={close}>
          {ar ? 'إغلاق ×' : 'Close ×'}
        </button>
      </div>
      <div className="photo-viewer__track" ref={trackRef} onScroll={onScroll}>
        {ids.map((id, at) => (
          <figure key={id} className="photo-viewer__slide">
            <img
              src={photoSrc(id)}
              alt={ar ? `صورة من التقييم ${at + 1}` : `Review photo ${at + 1}`}
            />
          </figure>
        ))}
      </div>
      {ids.length > 1 ? (
        <>
          <button
            type="button"
            className="photo-viewer__nav photo-viewer__nav--prev"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label={ar ? 'الصورة السابقة' : 'Previous photo'}
          >
            {ar ? '›' : '‹'}
          </button>
          <button
            type="button"
            className="photo-viewer__nav photo-viewer__nav--next"
            onClick={() => go(index + 1)}
            disabled={index === ids.length - 1}
            aria-label={ar ? 'الصورة التالية' : 'Next photo'}
          >
            {ar ? '‹' : '›'}
          </button>
        </>
      ) : null}
    </dialog>
  );
}

function ReviewPhotos({ ids, ar }: { ids: string[]; ar: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      <div className="reputation-card__photos">
        {ids.map((id, index) => (
          <button
            key={id}
            type="button"
            onClick={() => setOpen(index)}
            aria-label={ar ? `عرض صورة التقييم ${index + 1}` : `View review photo ${index + 1}`}
          >
            <img src={photoSrc(id)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {open !== null ? (
        <PhotoViewer ids={ids} start={open} ar={ar} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}

function ReviewCard({
  review,
  subject,
  locale,
  defaultOpen = false,
}: {
  review: PublicReview;
  subject: ReputationSubject;
  locale: 'ar' | 'en';
  defaultOpen?: boolean;
}) {
  const { ar, fromGuest, name, nameHref, place, shownScore, stayed, party, unit, reviewedOn } =
    reviewFacts(review, subject, locale);
  const [open, setOpen] = useState(defaultOpen);
  const preview =
    review.comment?.trim() ||
    (review.summary ? (ar ? review.summary.ar : review.summary.en) : null) ||
    (review.commentHidden
      ? ar
        ? 'أُخفي التعليق لمخالفته سياسة النشر، وبقيت الدرجات.'
        : 'Comment hidden; scores remain.'
      : ar
        ? 'بلا تعليق نصي'
        : 'No written comment');

  return (
    <li className={`reputation-card${open ? ' is-open' : ' is-collapsed'}`}>
      <button
        type="button"
        className="reputation-card__summary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="reputation-card__summary-who">
          <span className="reputation-card__avatar" aria-hidden="true">
            {name.trim().charAt(0)}
          </span>
          <span className="reputation-card__summary-text">
            <strong>
              <ReviewerName name={name} href={null} />
            </strong>
            <small className="muted">
              {reviewedOn ?? (fromGuest ? stayed : monthLabel(review.stayMonth, ar))}
            </small>
            {!open ? (
              <span className="reputation-card__preview" dir="auto">
                {preview}
              </span>
            ) : null}
          </span>
        </span>
        <span className="reputation-card__summary-meta">
          <ScoreBadge score={shownScore} ar={ar} size="sm" />
          <span className="muted reputation-card__chevron" aria-hidden="true">
            {open ? (ar ? 'إخفاء' : 'Hide') : ar ? 'عرض' : 'Show'}
          </span>
        </span>
      </button>

      {open ? (
        <div className="reputation-card__body">
          <aside className="reputation-card__guest">
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
            <div className="reputation-card__groups">
              {review.groups.map((group) =>
                group.score === null ? null : (
                  <span key={group.key}>
                    {groupLabel(review.direction, group.key, ar)}{' '}
                    <strong dir="ltr">{group.score.toFixed(1)}</strong>
                  </span>
                ),
              )}
              <RecommendChip review={review} ar={ar} />
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
            {nameHref ? (
              <p className="reputation-card__profile-link">
                <a href={nameHref}>{ar ? 'ملف المقيّم ←' : 'Reviewer profile →'}</a>
              </p>
            ) : null}
            {review.photoIds.length ? <ReviewPhotos ids={review.photoIds} ar={ar} /> : null}
          </div>
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
      'تقييمات موثّقة من ضيوف أقاموا فعلاً، تُكتب بعد المغادرة: النظافة بتفاصيلها، والعقار، وتعامل الإدارة. وفي المبنى متعدد الوحدات يجمع التقييم كل وحداته.',
    leadEn:
      'Verified reviews from guests who actually stayed, written after check-out: detailed cleanliness, the property and the management. For a multi-unit building it totals every unit.',
  },
  unit: {
    ar: 'تقييمات الضيوف لهذه الوحدة',
    en: 'Guest reviews of this unit',
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

type ReviewsView = 'list' | 'grid' | 'table';
const REVIEWS_VIEW_KEY = 'bhd-r-reviews-view';
const REVIEWS_VIEWS: Array<[ReviewsView, string, string]> = [
  ['list', 'قائمة', 'List'],
  ['grid', 'شبكة', 'Grid'],
  ['table', 'جدول', 'Table'],
];

function parseReviewsView(raw: string | null): ReviewsView {
  return raw === 'grid' || raw === 'table' ? raw : 'list';
}

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
  const [allOpen, setAllOpen] = useState(false);
  const [view, setView] = useState<ReviewsView>('list');

  useEffect(() => {
    try {
      setView(parseReviewsView(window.localStorage.getItem(REVIEWS_VIEW_KEY)));
    } catch {
      /* ignore */
    }
  }, []);

  function changeView(next: ReviewsView) {
    setView(next);
    try {
      window.localStorage.setItem(REVIEWS_VIEW_KEY, next);
    } catch {
      /* ignore */
    }
  }

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
  const allReviews = useMemo(
    () => sortReviewsNewestFirst(data?.reviews ?? []),
    [data?.reviews],
  );
  const reviews = useMemo(
    () =>
      traveller === 'all'
        ? allReviews
        : allReviews.filter((item) => item.traveller === traveller),
    [allReviews, traveller],
  );
  const visible = showAllReviews ? reviews : reviews.slice(0, PREVIEW_LIMIT);
  const travellers = data?.travellers ?? [];
  const showTravellers = subject !== 'guest' && travellers.some((item) => item.count > 0);
  const hasMore = !showAllReviews && reviews.length > PREVIEW_LIMIT;

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

          <div className="reputation__toolbar">
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
            <div
              className="props-view-toggle reputation__views"
              role="group"
              aria-label={ar ? 'طريقة عرض التقييمات' : 'Reviews view'}
            >
              {REVIEWS_VIEWS.map(([mode, labelAr, labelEn]) => (
                <button
                  key={mode}
                  type="button"
                  className={view === mode ? 'is-active' : undefined}
                  aria-pressed={view === mode}
                  onClick={() => changeView(mode)}
                >
                  {ar ? labelAr : labelEn}
                </button>
              ))}
            </div>
          </div>

          {view === 'table' ? (
            visible.length ? (
              <div className="reputation-table-wrap">
                <table className="reputation-table">
                  <thead>
                    <tr>
                      <th scope="col">{ar ? 'الضيف' : 'Guest'}</th>
                      <th scope="col">{ar ? 'الإقامة' : 'Stay'}</th>
                      <th scope="col">{ar ? 'الدرجة' : 'Score'}</th>
                      <th scope="col">{ar ? 'التعليق' : 'Comment'}</th>
                      <th scope="col">{ar ? 'تاريخ التقييم' : 'Reviewed'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((review) => (
                      <ReviewRow
                        key={review.id}
                        review={review}
                        subject={subject}
                        locale={locale}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null
          ) : (
            <ul className={`reputation__list reputation__list--${view}`}>
              {visible.map((review) => (
                <ReviewCard key={review.id} review={review} subject={subject} locale={locale} />
              ))}
            </ul>
          )}
          {!reviews.length ? (
            <p className="muted">
              {ar ? 'لا توجد تقييمات معروضة من هذا النوع.' : 'No reviews of this type shown.'}
            </p>
          ) : null}
          {hasMore ? (
            <button
              type="button"
              className="button button--quiet reputation__more"
              onClick={() => setAllOpen(true)}
            >
              {ar
                ? `فتح كل التقييمات (${reviews.length})`
                : `Open all reviews (${reviews.length})`}
            </button>
          ) : null}
          {allOpen ? (
            <ModalPortal onClose={() => setAllOpen(false)}>
              <div
                className="ops-modal ops-modal--create reputation-all-modal"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setAllOpen(false);
                }}
              >
                <section
                  className="ops-modal__card reputation-all-modal__card"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="reputation-all-title"
                  dir={ar ? 'rtl' : 'ltr'}
                >
                  <header>
                    <div>
                      <h2 id="reputation-all-title">
                        {ar ? title.ar : title.en}
                      </h2>
                      <p className="muted">
                        {ar
                          ? `${reviews.length} تقييماً · الأحدث أولاً`
                          : `${reviews.length} reviews · newest first`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAllOpen(false)}
                      aria-label={ar ? 'إغلاق' : 'Close'}
                    >
                      ×
                    </button>
                  </header>
                  <div className="reputation-all-modal__body">
                    {view === 'table' ? (
                      <div className="reputation-table-wrap">
                        <table className="reputation-table">
                          <thead>
                            <tr>
                              <th scope="col">{ar ? 'الضيف' : 'Guest'}</th>
                              <th scope="col">{ar ? 'الإقامة' : 'Stay'}</th>
                              <th scope="col">{ar ? 'الدرجة' : 'Score'}</th>
                              <th scope="col">{ar ? 'التعليق' : 'Comment'}</th>
                              <th scope="col">{ar ? 'تاريخ التقييم' : 'Reviewed'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reviews.map((review) => (
                              <ReviewRow
                                key={review.id}
                                review={review}
                                subject={subject}
                                locale={locale}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <ul className={`reputation__list reputation__list--${view}`}>
                        {reviews.map((review) => (
                          <ReviewCard
                            key={review.id}
                            review={review}
                            subject={subject}
                            locale={locale}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </div>
            </ModalPortal>
          ) : null}
        </>
      )}
    </section>
  );
}
