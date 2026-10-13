'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReviewForm,
  ScoreBadge,
  guestReviewAssistant,
  type ReviewFormValue,
} from '@/components/reviews/review-form';
import type { ReviewText } from '@/lib/review-rubric';

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
        setOpen(false);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    });
  }

  const mine = saved ?? state.mine?.score ?? null;
  const published = saved === null && state.mine?.published === true;

  const fromHost = state.fromHost ? (
    <div className="stay-guest-review__host">
      <h3>{ar ? 'تقييم المالك لك' : 'The host’s review of you'}</h3>
      <div className="stay-guest-review__done">
        <ScoreBadge score={state.fromHost.score} ar={ar} size="sm" />
        <div>
          {state.fromHost.summary ? (
            <p>{ar ? state.fromHost.summary.ar : state.fromHost.summary.en}</p>
          ) : null}
          {state.fromHost.comment ? (
            <blockquote className="stay-guest-review__quote">{state.fromHost.comment}</blockquote>
          ) : null}
        </div>
      </div>
    </div>
  ) : state.hostWrote ? (
    <div className="stay-guest-review__host">
      <h3>{ar ? 'تقييم المالك لك' : 'The host’s review of you'}</h3>
      <p className="muted">
        {mine === null
          ? ar
            ? 'كتب المالك تقييمه لك. يظهر هنا بعد أن تكتب تقييمك ويُحوَّل مبلغ التأمين وتؤكد استلامه، فلا يرى أي طرف تقييم الآخر قبل أن يكتب تقييمه.'
            : 'The host has reviewed you. It shows here once you have written yours and your deposit is refunded and received, so neither side sees the other’s review before writing their own.'
          : ar
            ? 'كتب المالك تقييمه لك. يظهر هنا بعد تحويل مبلغ التأمين وتأكيد استلامه.'
            : 'The host has reviewed you. It shows here once your deposit is refunded and received.'}
      </p>
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
      {open ? (
        <ReviewForm
          direction="guest_to_host"
          ar={ar}
          idPrefix={`guest-review-${referenceCode}`}
          busy={pending}
          error={error}
          subjectName={propertyName}
          assistant={assistant}
          onSubmit={submit}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <button
          type="button"
          className="button button--primary stay-guest-review__start"
          onClick={() => setOpen(true)}
        >
          {ar ? 'ابدأ التقييم' : 'Start the review'}
        </button>
      )}
      {fromHost}
    </section>
  );
}
