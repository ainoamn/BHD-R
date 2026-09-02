'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError, browserNextMutation } from '@/lib/api';
import type { PublicReview, ReviewSummary, ReviewTargetType } from '@/lib/reviews-types';

type ReviewPayload = {
  summary: ReviewSummary;
  data: PublicReview[];
};

function toTenScale(rating: number): string {
  return (rating * 2).toFixed(1);
}

function Stars({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) {
  const filled = Math.round(value);
  return (
    <div className={`review-stars review-stars--${size}`} role="img" aria-label={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= filled ? 'is-on' : ''} aria-hidden="true">
          ★
        </span>
      ))}
    </div>
  );
}

function StarsInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="review-stars review-stars--input" role="group">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= value ? 'is-on' : ''}
          onClick={() => onChange(n)}
          aria-label={`${n}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function badgeLabel(role: string | null | undefined, ar: boolean): string | null {
  if (!role) return null;
  if (role === 'tenant') return ar ? 'مستأجر سابق' : 'Past tenant';
  if (role === 'buyer') return ar ? 'مشتري' : 'Buyer';
  if (role === 'owner') return ar ? 'مالك موثّق' : 'Verified owner';
  return ar ? 'موثّق' : 'Verified';
}

export function ReviewsPanel({
  locale,
  signedIn,
  targets,
}: {
  locale: string;
  signedIn: boolean;
  targets: Array<{
    type: ReviewTargetType;
    id: string;
    titleAr: string;
    titleEn: string;
  }>;
}) {
  const ar = locale === 'ar';
  const [active, setActive] = useState(0);
  const [payloads, setPayloads] = useState<Record<string, ReviewPayload>>({});
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = targets[active];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const item of targets) {
        const key = `${item.type}:${item.id}`;
        try {
          const res = await fetch(
            `/api/public/reviews?targetType=${item.type}&targetId=${item.id}`,
          );
          if (!res.ok) continue;
          const json = (await res.json()) as ReviewPayload;
          if (!cancelled) {
            setPayloads((prev) => ({ ...prev, [key]: json }));
          }
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targets]);

  if (!target) return null;
  const key = `${target.type}:${target.id}`;
  const payload = payloads[key] ?? {
    summary: { avgRating: null, reviewCount: 0, verifiedCount: 0 },
    data: [],
  };
  const avgTen =
    payload.summary.avgRating != null ? toTenScale(payload.summary.avgRating) : null;

  async function submit() {
    if (!signedIn || !target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await browserNextMutation<{ review: PublicReview; summary: ReviewSummary }>(
        '/api/public/reviews',
        {
          method: 'POST',
          body: JSON.stringify({
            targetType: target.type,
            targetId: target.id,
            rating,
            body: body.trim() || null,
          }),
        },
      );
      setPayloads((prev) => {
        const existing = prev[key]?.data ?? [];
        const next = existing.filter((item) => item.id !== res.review.id);
        return {
          ...prev,
          [key]: { summary: res.summary, data: [res.review, ...next] },
        };
      });
      setBody('');
    } catch (caught) {
      const authish =
        caught instanceof ApiError &&
        (caught.status === 401 ||
          caught.status === 403 ||
          /csrf|unauthorized|session/i.test(`${caught.code} ${caught.message}`));
      setError(
        authish
          ? ar
            ? 'تعذّر حفظ التقييم. سجّل الدخول وحاول مجدداً.'
            : 'Could not save review. Sign in and retry.'
          : caught instanceof ApiError
            ? caught.message
            : ar
              ? 'تعذّر حفظ التقييم. أعد المحاولة.'
              : 'Could not save review. Please retry.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="reviews-panel reviews-panel--booking">
      <header className="reviews-panel__head">
        <h2>{ar ? 'التقييمات والمراجعات' : 'Ratings & reviews'}</h2>
        {targets.length > 1 ? (
          <div className="reviews-panel__tabs">
            {targets.map((item, index) => (
              <button
                key={`${item.type}-${item.id}`}
                type="button"
                className={index === active ? 'is-active' : ''}
                onClick={() => setActive(index)}
              >
                {ar ? item.titleAr : item.titleEn}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div className="reviews-panel__hero">
        <div className="reviews-panel__score-block">
          {avgTen ? (
            <>
              <span className="reviews-panel__score" dir="ltr">
                {avgTen}
              </span>
              <span className="reviews-panel__score-suffix">/ 10</span>
            </>
          ) : (
            <span className="reviews-panel__score reviews-panel__score--empty">—</span>
          )}
          <p className="reviews-panel__score-meta">
            {payload.summary.reviewCount}{' '}
            {ar ? 'مراجعة' : payload.summary.reviewCount === 1 ? 'review' : 'reviews'}
          </p>
          {payload.summary.avgRating != null ? (
            <Stars value={payload.summary.avgRating} />
          ) : null}
        </div>
        <div className="reviews-panel__overall">
          <h3>{ar ? 'التقييم العام' : 'Overall rating'}</h3>
          <p className="muted">
            {ar
              ? 'تقييمات حقيقية من الضيوف والعملاء المسجّلين على المنصة.'
              : 'Genuine ratings from signed-in guests and customers on the platform.'}
          </p>
        </div>
      </div>

      {signedIn ? (
        <div className="reviews-panel__form">
          <StarsInput value={rating} onChange={setRating} />
          <textarea
            className="props-smart-input"
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={ar ? 'اكتب تعليقك…' : 'Write your comment…'}
          />
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'إرسال التقييم' : 'Submit review'}
          </button>
          {error ? <p className="reviews-panel__error">{error}</p> : null}
        </div>
      ) : (
        <p className="reviews-panel__signin">
          {ar ? 'يلزم تسجيل الدخول للتقييم والتعليق.' : 'Sign in to rate and comment.'}{' '}
          <Link href="/login">{ar ? 'دخول' : 'Sign in'}</Link>
        </p>
      )}

      <div className="reviews-panel__carousel" aria-label={ar ? 'مراجعات الضيوف' : 'Guest reviews'}>
        {payload.data.length ? (
          payload.data.map((item) => (
            <article key={item.id} className="reviews-panel__card">
              <header className="reviews-panel__card-head">
                <div>
                  <strong dir="ltr">{toTenScale(item.rating)} / 10</strong>
                  <Stars value={item.rating} size="sm" />
                </div>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleDateString(ar ? 'ar-OM' : 'en-OM', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </time>
              </header>
              <p className="reviews-panel__author">{item.authorLabel}</p>
              {item.verifiedStay ? (
                <span className="reviews-badge">{badgeLabel(item.verifiedRole, ar)}</span>
              ) : null}
              {item.body ? <p className="reviews-panel__body">{item.body}</p> : null}
            </article>
          ))
        ) : (
          <p className="reviews-panel__empty">
            {ar ? 'لا توجد تقييمات بعد. كن أول من يقيّم.' : 'No reviews yet. Be the first.'}
          </p>
        )}
      </div>
    </section>
  );
}
