'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError, browserNextMutation } from '@/lib/api';
import type { PublicReview, ReviewSummary, ReviewTargetType } from '@/lib/reviews-types';

type ReviewPayload = {
  summary: ReviewSummary;
  data: PublicReview[];
};

function Stars({
  value,
  onChange,
  readOnly,
}: {
  value: number;
  onChange?: (n: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="review-stars" role={readOnly ? 'img' : 'group'}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= value ? 'is-on' : ''}
          disabled={readOnly}
          onClick={() => onChange?.(n)}
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
    <section className="reviews-panel">
      <header className="reviews-panel__head">
        <h2>{ar ? 'التقييمات والتعليقات' : 'Ratings & reviews'}</h2>
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
      </header>

      <div className="reviews-panel__summary">
        <strong>{payload.summary.avgRating ?? '—'}</strong>
        <Stars value={Math.round(payload.summary.avgRating ?? 0)} readOnly />
        <span>
          {payload.summary.reviewCount} {ar ? 'تقييم' : 'reviews'}
          {payload.summary.verifiedCount
            ? ` · ${payload.summary.verifiedCount} ${ar ? 'موثّق' : 'verified'}`
            : ''}
        </span>
      </div>

      {signedIn ? (
        <div className="reviews-panel__form">
          <Stars value={rating} onChange={setRating} />
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

      <ul className="reviews-panel__list">
        {payload.data.map((item) => (
          <li key={item.id}>
            <div className="reviews-panel__row">
              <Stars value={item.rating} readOnly />
              {item.verifiedStay ? (
                <span className="reviews-badge">{badgeLabel(item.verifiedRole, ar)}</span>
              ) : null}
            </div>
            {item.body ? <p>{item.body}</p> : null}
            <small>
              {new Date(item.createdAt).toLocaleDateString(ar ? 'ar-OM' : 'en-OM')}
            </small>
          </li>
        ))}
        {!payload.data.length ? (
          <li className="reviews-panel__empty">
            {ar ? 'لا توجد تقييمات بعد. كن أول من يقيّم.' : 'No reviews yet. Be the first.'}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
