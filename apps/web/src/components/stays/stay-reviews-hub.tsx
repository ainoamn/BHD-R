'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { BrandMark, Button } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { ApiError, browserNextMutation } from '@/lib/api';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import type { StayReviewPending, StayReviewPublic } from '@/lib/stay-reviews-types';
import { scoreLabel } from '@/lib/stay-reviews-client';

function toTen(rating: number): string {
  return (rating * 2).toFixed(1);
}

function CategoryInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="stay-review-cat">
      <span>{label}</span>
      <select
        className="select"
        value={value}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
      >
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StayReviewsHub({
  locale,
  signedIn,
  propertyId,
  propertyName,
  initialPending = [],
}: {
  locale: string;
  signedIn: boolean;
  propertyId: string;
  propertyName: string;
  initialPending?: StayReviewPending[];
}) {
  const ar = locale === 'ar';
  const [published, setPublished] = useState<StayReviewPublic[]>([]);
  const [pending, setPending] = useState<StayReviewPending[]>(initialPending);
  const [activeBookingId, setActiveBookingId] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [prosText, setProsText] = useState('');
  const [consText, setConsText] = useState('');
  const [body, setBody] = useState('');
  const [cleanliness, setCleanliness] = useState(5);
  const [locationScore, setLocationScore] = useState(5);
  const [valueScore, setValueScore] = useState(5);
  const [communication, setCommunication] = useState(5);
  const [accuracy, setAccuracy] = useState(5);
  const [checkInScore, setCheckInScore] = useState(5);
  const [keywords, setKeywords] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const propertyPending = useMemo(
    () => pending.filter((item) => item.propertyId === propertyId),
    [pending, propertyId],
  );

  const loadPublished = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/public/stays/reviews?propertyId=${encodeURIComponent(propertyId)}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { data?: StayReviewPublic[] };
      setPublished(json.data ?? []);
    } catch {
      /* ignore */
    }
  }, [propertyId]);

  const loadPending = useCallback(async () => {
    if (!signedIn) return;
    try {
      const res = await fetch('/api/public/stays/reviews/pending', {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const json = (await res.json()) as { data?: StayReviewPending[] };
      setPending(json.data ?? []);
    } catch {
      /* ignore */
    }
  }, [signedIn]);

  useEffect(() => {
    void loadPublished();
    void loadPending();
  }, [loadPending, loadPublished]);

  async function assistDraft() {
    setBusy(true);
    setError(null);
    try {
      const draft = await browserNextMutation<{
        title: string;
        prosText: string;
        consText: string;
        body: string;
      }>('/api/public/stays/reviews/assist', {
        method: 'POST',
        body: JSON.stringify({
          locale: ar ? 'ar' : 'en',
          rating,
          propertyName,
          cleanliness,
          locationScore,
          valueScore,
          communication,
          keywords,
        }),
      });
      setTitle(draft.title);
      setProsText(draft.prosText);
      setConsText(draft.consText);
      setBody(draft.body);
      setNotice(ar ? 'تم توليد مسودة التقييم بالذكاء الاصطناعي.' : 'AI draft ready.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar ? 'تعذّر التوليد' : 'Assist failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitReview() {
    if (!activeBookingId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await browserNextMutation('/api/public/stays/reviews', {
        method: 'POST',
        body: JSON.stringify({
          bookingId: activeBookingId,
          rating,
          title,
          prosText,
          consText,
          body,
          cleanliness,
          locationScore,
          valueScore,
          communication,
          accuracy,
          checkInScore,
        }),
      });
      setNotice(ar ? 'تم نشر تقييمك. شكراً!' : 'Your review was published. Thank you!');
      setActiveBookingId(null);
      setPending((rows) => rows.filter((row) => row.bookingId !== activeBookingId));
      await loadPublished();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar ? 'تعذّر الحفظ' : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stay-reviews-hub property-360__section" aria-labelledby="stay-reviews-title">
      <h2 id="stay-reviews-title">{ar ? 'تقييمات الإقامة' : 'Stay reviews'}</h2>
      <p className="muted">
        {ar
          ? 'تقييمات موثّقة بعد انتهاء الإقامة فقط — إيجابيات وسلبيات وتقييمات تفصيلية تُبنى منها درجة العقار الذكية.'
          : 'Verified after checkout only — pros, cons, and category scores feed the property smart rating.'}
      </p>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="notice notice--success" role="status">
          {notice}
        </p>
      ) : null}

      {!signedIn ? (
        <p className="notice notice--info">
          {ar ? 'سجّل الدخول لتقييم إقامتك بعد المغادرة.' : 'Sign in to rate your stay after checkout.'}{' '}
          <Link href="/login">{ar ? 'دخول' : 'Sign in'}</Link>
        </p>
      ) : null}

      {propertyPending.length ? (
        <div className="stay-reviews-pending">
          <h3>{ar ? 'بانتظار تقييمك' : 'Waiting for your review'}</h3>
          <ul className="stay-reviews-timeline">
            {propertyPending.map((item) => {
              const cover = toPublicMediaSrc(item.coverImageUrl);
              return (
                <li key={item.bookingId} className="stay-review-card stay-review-card--pending">
                  <div className="stay-review-card__body">
                    <p className="stay-review-card__title">
                      {ar
                        ? `ما زال بإمكانك تقييم إقامتك في ${item.titleAr}`
                        : `You can still rate your stay at ${item.titleEn}`}
                    </p>
                    <p className="muted">
                      {ar
                        ? `يتبقى لديك ${item.daysLeft} يوماً`
                        : `You only have ${item.daysLeft} days left`}
                      {' · '}
                      <span dir="ltr">{item.referenceCode}</span>
                    </p>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setActiveBookingId(item.bookingId);
                        setNotice(null);
                        setError(null);
                      }}
                    >
                      {ar ? 'قيّم إقامتك' : 'Rate your stay'}
                    </Button>
                  </div>
                  <div className="stay-review-card__thumb">
                    {cover ? (
                      <Image src={cover} alt="" fill sizes="96px" />
                    ) : (
                      <BrandMark tone="onDark" />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {activeBookingId ? (
        <form
          className="stay-review-form card"
          onSubmit={(event) => {
            event.preventDefault();
            void submitReview();
          }}
        >
          <h3>{ar ? 'اكتب تقييمك' : 'Write your review'}</h3>
          <div className="field">
            <label htmlFor="stay-rating">{ar ? 'التقييم العام' : 'Overall rating'}</label>
            <select
              id="stay-rating"
              className="select"
              value={rating}
              onChange={(event) => setRating(Number.parseInt(event.target.value, 10))}
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} · {toTen(n)}/10 · {scoreLabel(n * 2, ar)}
                </option>
              ))}
            </select>
          </div>
          <div className="stay-review-cats">
            <CategoryInput
              label={ar ? 'النظافة' : 'Cleanliness'}
              value={cleanliness}
              onChange={setCleanliness}
            />
            <CategoryInput
              label={ar ? 'الموقع' : 'Location'}
              value={locationScore}
              onChange={setLocationScore}
            />
            <CategoryInput
              label={ar ? 'القيمة' : 'Value'}
              value={valueScore}
              onChange={setValueScore}
            />
            <CategoryInput
              label={ar ? 'التواصل' : 'Communication'}
              value={communication}
              onChange={setCommunication}
            />
            <CategoryInput
              label={ar ? 'دقة الإعلان' : 'Accuracy'}
              value={accuracy}
              onChange={setAccuracy}
            />
            <CategoryInput
              label={ar ? 'تسجيل الدخول' : 'Check-in'}
              value={checkInScore}
              onChange={setCheckInScore}
            />
          </div>
          <div className="field">
            <label htmlFor="stay-keywords">
              {ar ? 'كلمات مفتاحية للمساعد الذكي' : 'Keywords for AI assist'}
            </label>
            <input
              id="stay-keywords"
              className="input"
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder={ar ? 'مثال: هدوء، موقف سيارات، مسبح' : 'e.g. quiet, parking, pool'}
            />
          </div>
          <div className="hero-actions">
            <Button type="button" variant="quiet" disabled={busy} onClick={() => void assistDraft()}>
              {ar ? 'توليد مسودة بالذكاء الاصطناعي' : 'Generate AI draft'}
            </Button>
          </div>
          <div className="field">
            <label htmlFor="stay-title">{ar ? 'عنوان التقييم' : 'Review title'}</label>
            <input
              id="stay-title"
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="stay-pros">{ar ? 'ما أعجبك' : 'What you liked'}</label>
            <textarea
              id="stay-pros"
              className="input"
              rows={3}
              value={prosText}
              onChange={(event) => setProsText(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="stay-cons">{ar ? 'ما يمكن تحسينه' : 'What could be better'}</label>
            <textarea
              id="stay-cons"
              className="input"
              rows={3}
              value={consText}
              onChange={(event) => setConsText(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="stay-body">{ar ? 'تعليق إضافي' : 'Additional comment'}</label>
            <textarea
              id="stay-body"
              className="input"
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
          <div className="form-actions">
            <Button type="button" variant="quiet" disabled={busy} onClick={() => setActiveBookingId(null)}>
              {ar ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (ar ? 'جاري النشر…' : 'Publishing…') : ar ? 'نشر التقييم' : 'Publish review'}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="stay-reviews-published">
        <h3>{ar ? 'التقييمات المنشورة' : 'Published reviews'}</h3>
        {!published.length ? (
          <p className="muted">
            {ar ? 'لا توجد تقييمات إقامة بعد. كن أول ضيف يقيّم.' : 'No stay reviews yet. Be the first guest to rate.'}
          </p>
        ) : (
          <ul className="stay-reviews-timeline">
            {published.map((item) => {
              const cover = toPublicMediaSrc(item.coverImageUrl);
              const ten = Number.parseFloat(toTen(item.rating));
              return (
                <li key={item.id} className="stay-review-card stay-review-card--done">
                  <div className="stay-review-card__body">
                    <span className="stay-review-card__badge">
                      {ar ? 'تم نشر التقييم' : 'Review published'}
                    </span>
                    <p className="stay-review-card__title">
                      {item.title ||
                        (ar
                          ? `قيّمتَ ${item.propertyTitleAr ?? propertyName}`
                          : `You rated ${item.propertyTitleEn ?? propertyName}`)}
                    </p>
                    <p className="muted">
                      {new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-OM', {
                        dateStyle: 'medium',
                      }).format(new Date(item.createdAt))}
                    </p>
                    <p className="stay-review-card__score">
                      <strong dir="ltr">{ten.toFixed(1)}</strong>
                      <span>{scoreLabel(ten, ar)}</span>
                    </p>
                    {item.prosText ? (
                      <p className="stay-review-card__pros">
                        <span aria-hidden="true">☺</span> {item.prosText}
                      </p>
                    ) : null}
                    {item.consText ? (
                      <p className="stay-review-card__cons">
                        <span aria-hidden="true">☹</span> {item.consText}
                      </p>
                    ) : null}
                    {item.body ? <p>{item.body}</p> : null}
                  </div>
                  <div className="stay-review-card__thumb">
                    {cover ? (
                      <Image src={cover} alt="" fill sizes="96px" />
                    ) : (
                      <BrandMark tone="onDark" />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
