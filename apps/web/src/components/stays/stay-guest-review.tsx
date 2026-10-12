'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ReviewForm, ScoreBadge, type ReviewFormValue } from '@/components/reviews/review-form';
import type { ReviewText } from '@/lib/review-rubric';

export type StayGuestReviewState = {
  required: boolean;
  mine: { score: number } | null;
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

  if (mine !== null) {
    return (
      <section className="guest-stay-detail__card stay-guest-review" id="stay-review">
        <h2>{ar ? 'تقييمك للإقامة' : 'Your review'}</h2>
        <div className="stay-guest-review__done">
          <ScoreBadge score={mine} ar={ar} />
          <p>
            {ar
              ? 'شكراً لتقييمك. يساعد رأيك الضيوف الآخرين ويحسّن الخدمة.'
              : 'Thank you. Your review helps other guests and improves the service.'}
            {state.hostWrote || state.fromHost
              ? null
              : ar
                ? ' يُنشر تقييمك بعد أن يقيّمك المالك، أو بعد 14 يوماً.'
                : ' It is published once the host reviews you, or after 14 days.'}
          </p>
        </div>
        {state.fromHost ? (
          <div className="stay-guest-review__host">
            <h3>{ar ? 'تقييم المالك لك' : 'The host’s review of you'}</h3>
            <div className="stay-guest-review__done">
              <ScoreBadge score={state.fromHost.score} ar={ar} size="sm" />
              <div>
                {state.fromHost.summary ? (
                  <p>{ar ? state.fromHost.summary.ar : state.fromHost.summary.en}</p>
                ) : null}
                {state.fromHost.comment ? (
                  <blockquote className="stay-guest-review__quote">
                    {state.fromHost.comment}
                  </blockquote>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  if (!state.required) return null;

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
            ? 'خطوة إلزامية قبل طلب استرداد التأمين: قيّم نظافة المكان والعقار وتعامل الإدارة. يستغرق دقيقتين.'
            : 'Required before you can request your deposit back: rate the cleanliness, the property and the management. It takes two minutes.'
          : ar
            ? 'التقييم إلزامي بعد المغادرة: قيّم نظافة المكان والعقار وتعامل الإدارة. يستغرق دقيقتين.'
            : 'Reviews are required after check-out: rate the cleanliness, the property and the management. It takes two minutes.'}
      </p>
      {open ? (
        <ReviewForm
          direction="guest_to_host"
          ar={ar}
          idPrefix={`guest-review-${referenceCode}`}
          busy={pending}
          error={error}
          subjectName={propertyName}
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
    </section>
  );
}
