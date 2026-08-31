'use client';

import { useState, useTransition } from 'react';
import { ApiError, browserMutation, browserPublicGet } from '@/lib/api';
import { Link } from '@/i18n/navigation';

type GuestBooking = {
  id: string;
  referenceCode: string;
  checkInOn: string;
  checkOutOn: string;
  status: string;
  currency: string;
  totalMinor: string;
  nights?: number;
};

export function GuestStayLookup({
  locale,
  initialReference,
  canClaim,
}: {
  locale: string;
  initialReference?: string;
  canClaim: boolean;
}) {
  const ar = locale === 'ar';
  const [referenceCode, setReferenceCode] = useState(initialReference ?? '');
  const [result, setResult] = useState<GuestBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function lookup() {
    startTransition(async () => {
      setError(null);
      setHint(null);
      setResult(null);
      const code = referenceCode.trim().toUpperCase();
      if (code.length < 4) {
        setError(ar ? 'أدخل مرجع حجز صالحاً' : 'Enter a valid booking reference');
        return;
      }
      try {
        const booking = await browserPublicGet<GuestBooking>(
          `/v1/public/stays/bookings/lookup?referenceCode=${encodeURIComponent(code)}`,
        );
        setResult(booking);
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 404) {
          setError(
            ar
              ? 'لم يُعثر على الحجز أو المسار غير مفعّل.'
              : 'Booking not found or stays surface is disabled.',
          );
          return;
        }
        setError(caught instanceof Error ? caught.message : 'lookup_failed');
      }
    });
  }

  function claim() {
    if (!result) return;
    startTransition(async () => {
      setError(null);
      setHint(null);
      try {
        await browserMutation('/v1/guest/stays/bookings/claim', {
          method: 'POST',
          body: JSON.stringify({ referenceCode: result.referenceCode }),
        });
        setHint(ar ? 'تم ربط الحجز بحسابك.' : 'Booking linked to your account.');
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          setError(ar ? 'سجّل الدخول لربط الحجز بحسابك.' : 'Sign in to claim this booking.');
          return;
        }
        setError(caught instanceof Error ? caught.message : 'claim_failed');
      }
    });
  }

  return (
    <section className="guest-stays-lookup" aria-labelledby="guest-lookup-title">
      <h2 id="guest-lookup-title">{ar ? 'ابحث بمرجع الحجز' : 'Look up by reference'}</h2>
      <form
        className="guest-stays-lookup__form"
        onSubmit={(event) => {
          event.preventDefault();
          lookup();
        }}
      >
        <div className="field">
          <label htmlFor="guest-ref">{ar ? 'مرجع الحجز' : 'Booking reference'}</label>
          <input
            className="input"
            id="guest-ref"
            dir="ltr"
            value={referenceCode}
            onChange={(event) => setReferenceCode(event.target.value)}
            placeholder="ST-…"
            disabled={pending}
            autoComplete="off"
          />
        </div>
        <button type="submit" className="button button--primary" disabled={pending}>
          {pending ? (ar ? 'جارٍ البحث…' : 'Looking up…') : ar ? 'بحث' : 'Look up'}
        </button>
      </form>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="notice notice--info" role="status">
          {hint}
        </p>
      ) : null}

      {result ? (
        <article className="ops-panel guest-stays-lookup__result">
          <p>
            {ar ? 'المرجع' : 'Reference'}: <strong dir="ltr">{result.referenceCode}</strong>
          </p>
          <p>
            {ar ? 'الحالة' : 'Status'}: <strong dir="ltr">{result.status}</strong>
          </p>
          <p>
            {result.checkInOn} → {result.checkOutOn}
            {result.nights != null ? ` · ${result.nights} ${ar ? 'ليلة' : 'nights'}` : ''}
          </p>
          <p dir="ltr">
            {result.currency} {result.totalMinor}
          </p>
          <p>
            <Link
              className="text-link"
              href={`/guest/stays/${result.id}?ref=${encodeURIComponent(result.referenceCode)}`}
            >
              {ar ? 'تفاصيل الحجز' : 'Booking details'}
            </Link>
          </p>
          {canClaim ? (
            <button type="button" className="button" disabled={pending} onClick={() => claim()}>
              {ar ? 'اربط بحسابي' : 'Claim to my account'}
            </button>
          ) : (
            <p className="muted">
              {ar
                ? 'سجّل الدخول لربط الحجز بقائمة رحلاتك.'
                : 'Sign in to link this booking to your trips list.'}
            </p>
          )}
        </article>
      ) : null}
    </section>
  );
}
