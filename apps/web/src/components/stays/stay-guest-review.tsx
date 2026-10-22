'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ModalPortal } from '@/components/modal-portal';
import {
  ReviewForm,
  ScoreBadge,
  guestReviewAssistant,
  type ReviewFormValue,
} from '@/components/reviews/review-form';
import type { ReviewText } from '@/lib/review-rubric';

/** Open the guest review dialog from anywhere on the stay page (e.g. deposit CTA). */
export const STAY_REVIEW_OPEN_EVENT = 'bhd-r-stay-review-open';

export function openStayReviewDialog(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (window.location.hash !== '#stay-review') {
    window.history.replaceState(null, '', `${pathname}${search}#stay-review`);
  }
  window.dispatchEvent(new Event(STAY_REVIEW_OPEN_EVENT));
}

export type StayGuestReviewState = {
  required: boolean;
  mine: { score: number; published: boolean } | null;
  fromHost: {
    score: number;
    recommend: boolean | null;
    summary: ReviewText | null;
    comment: string | null;
  } | null;
  hostWrote: boolean;
};

/** The guest's review of the stay: required after check-out, before the deposit refund request. */
export function StayGuestReview({
  referenceCode,
  propertyName,
  state,
  depositWaiting,
  ar,
}: {
  referenceCode: string;
  propertyName: string | null;
  state: StayGuestReviewState;
  /** The deposit refund request waits for this review. */
  depositWaiting: boolean;
  ar: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<number | null>(null);
  const assistant = useMemo(() => guestReviewAssistant(referenceCode), [referenceCode]);

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === '#stay-review') setOpen(true);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    window.addEventListener(STAY_REVIEW_OPEN_EVENT, openFromHash);
    return () => {
      window.removeEventListener('hashchange', openFromHash);
      window.removeEventListener(STAY_REVIEW_OPEN_EVENT, openFromHash);
    };
  }, []);

  function closeDialog() {
    setOpen(false);
    if (typeof window !== 'undefined' && window.location.hash === '#stay-review') {
      const { pathname, search } = window.location;
      window.history.replaceState(null, '', `${pathname}${search}`);
    }
  }

  function submit(value: ReviewFormValue) {
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch('/api/public/stays/guest/review', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-requested-with': 'BHD-R',
          },
          body: JSON.stringify({ referenceCode, ...value }),
          signal: AbortSignal.timeout(45_000),
        });
        const payload = (await response.json().catch(() => null)) as {
          review?: { score: number };
          error?: { messageAr?: string; message?: string };
        } | null;
        if (!response.ok || !payload?.review) {
          throw new Error(
            (ar ? payload?.error?.messageAr : payload?.error?.message) ??
              (ar ? 'تعذّر حفظ التقييم. أعد المحاولة.' : 'Could not save the review.'),
          );
        }
        setSaved(payload.review.score);
        closeDialog();
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    });
  }

  const mine = saved ?? state.mine?.score ?? null;
  const published = saved === null && state.mine?.published === true;
  const [hostOpen, setHostOpen] = useState(false);

  const hostSummary = state.fromHost
    ? ar
      ? state.fromHost.summary?.ar
      : state.fromHost.summary?.en
    : null;

  const fromHost = state.fromHost ? (
    <div className="stay-guest-review__host">
      <h3 className="stay-guest-review__host-title">
        {ar ? 'تقييم المالك لك' : 'The host’s review of you'}
      </h3>
      <div className="stay-guest-review__host-lead">
        <ScoreBadge score={state.fromHost.score} ar={ar} size="sm" />
        {hostSummary ? <p className="stay-guest-review__host-phrase">{hostSummary}</p> : null}
      </div>
      {state.fromHost.comment || state.fromHost.recommend !== null ? (
        <>
          <button
            type="button"
            className="stay-guest-review__host-toggle"
            aria-expanded={hostOpen}
            onClick={() => setHostOpen((open) => !open)}
          >
            <span>
              {ar ? 'التقييم والتعليق بالكامل' : 'Full rating and comment'}
            </span>
            <span className="muted">
              {hostOpen ? (ar ? 'إخفاء' : 'Hide') : ar ? 'عرض' : 'Show'}
            </span>
          </button>
          {hostOpen ? (
            <div className="stay-guest-review__host-panel">
              {state.fromHost.recommend !== null ? (
                <p className="muted">
                  {state.fromHost.recommend
                    ? ar
                      ? 'أوصى المضيف باستضافتك مجدداً.'
                      : 'The host would host you again.'
                    : ar
                      ? 'لم يوصِ المضيف باستضافتك مجدداً.'
                      : 'The host would not host you again.'}
                </p>
              ) : null}
              {state.fromHost.comment ? (
                <blockquote className="stay-guest-review__quote">{state.fromHost.comment}</blockquote>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  ) : state.hostWrote ? (
    <div className="stay-guest-review__host">
      <button
        type="button"
        className="stay-guest-review__host-toggle"
        aria-expanded={hostOpen}
        onClick={() => setHostOpen((open) => !open)}
      >
        <strong>{ar ? 'تقييم المالك لك' : 'The host’s review of you'}</strong>
        <span className="muted">
          {hostOpen ? (ar ? 'إخفاء' : 'Hide') : ar ? 'عرض' : 'Show'}
        </span>
      </button>
      {hostOpen ? (
        <p className="muted">
          {mine === null
            ? ar
              ? 'كتب المالك تقييمه لك. يظهر هنا بعد أن تكتب تقييمك ويُحوَّل مبلغ التأمين وتؤكد استلامه، فلا يرى أي طرف تقييم الآخر قبل أن يكتب تقييمه.'
              : 'The host has reviewed you. It shows here once you have written yours and your deposit is refunded and received, so neither side sees the other’s review before writing their own.'
            : ar
              ? 'كتب المالك تقييمه لك. يظهر هنا بعد تحويل مبلغ التأمين وتأكيد استلامه.'
              : 'The host has reviewed you. It shows here once your deposit is refunded and received.'}
        </p>
      ) : null}
    </div>
  ) : null;

  if (mine !== null) {
    return (
      <section className="guest-stay-detail__card stay-guest-review" id="stay-review">
        <h2>{ar ? 'تقييمك للإقامة' : 'Your review'}</h2>
        <div className="stay-guest-review__done">
          <ScoreBadge score={mine} ar={ar} />
          <p>
            {ar
              ? 'شكراً لتقييمك. يساعد رأيك الضيوف الآخرين ويحسّن الخدمة.'
              : 'Thank you. Your review helps other guests and improves the service.'}{' '}
            {published
              ? ar
                ? 'تقييمك منشور الآن.'
                : 'Your review is now published.'
              : ar
                ? 'لحمايتك، لا يُنشر تقييمك ولا يُبلَّغ المالك بوجوده إلا بعد استرداد مبلغ التأمين وتأكيد استلامه.'
                : 'To protect you, your review is not published and the host is not told about it until your deposit is refunded and received.'}
          </p>
        </div>
        {fromHost}
      </section>
    );
  }

  if (!state.required)
    return fromHost ? (
      <section className="guest-stay-detail__card stay-guest-review" id="stay-review">
        {fromHost}
      </section>
    ) : null;

  return (
    <section
      className="guest-stay-detail__card stay-guest-review stay-guest-review--due"
      id="stay-review"
      aria-labelledby="stay-review-title"
    >
      <h2 id="stay-review-title">{ar ? 'قيّم إقامتك' : 'Rate your stay'}</h2>
      <p className="stay-guest-review__lead">
        {depositWaiting
          ? ar
            ? 'خطوة إلزامية قبل طلب استرداد التأمين: قيّم نظافة المكان والعقار، وتعامل المالك أو شركة إدارة العقار، والموظفين العاملين في المكان. يستغرق دقيقتين.'
            : 'Required before you can request your deposit back: rate the cleanliness, the property, the owner or management company, and the on-site staff. It takes two minutes.'
          : ar
            ? 'التقييم إلزامي بعد المغادرة: قيّم نظافة المكان والعقار، وتعامل المالك أو شركة إدارة العقار، والموظفين العاملين في المكان. يستغرق دقيقتين.'
            : 'Reviews are required after check-out: rate the cleanliness, the property, the owner or management company, and the on-site staff. It takes two minutes.'}{' '}
        {ar
          ? 'لن يرى المالك تقييمك ولن يُبلَّغ بوجوده قبل استرداد التأمين.'
          : 'The host will not see your review, or know it exists, before your deposit is refunded.'}
      </p>
      <button
        type="button"
        className="button button--primary stay-guest-review__start"
        onClick={() => openStayReviewDialog()}
      >
        {ar ? 'ابدأ التقييم' : 'Start the review'}
      </button>
      {fromHost}

      {open ? (
        <ModalPortal onClose={() => !pending && closeDialog()}>
          <div
            className="ops-modal ops-modal--create stay-review-modal"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !pending) closeDialog();
            }}
          >
            <section
              className="ops-modal__card stay-review-modal__card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="stay-review-dialog-title"
              dir={ar ? 'rtl' : 'ltr'}
            >
              <header>
                <div>
                  <span className="ops-kicker" dir="ltr">
                    {referenceCode}
                  </span>
                  <h2 id="stay-review-dialog-title">
                    {ar ? 'تقييم الإقامة' : 'Stay review'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => closeDialog()}
                  disabled={pending}
                  aria-label={ar ? 'إغلاق' : 'Close'}
                >
                  ×
                </button>
              </header>
              <div className="stay-review-modal__body">
                <ReviewForm
                  direction="guest_to_host"
                  ar={ar}
                  idPrefix={`guest-review-${referenceCode}`}
                  busy={pending}
                  error={error}
                  subjectName={propertyName}
                  assistant={assistant}
                  stepped
                  onSubmit={submit}
                  onCancel={closeDialog}
                />
              </div>
            </section>
          </div>
        </ModalPortal>
      ) : null}
    </section>
  );
}
