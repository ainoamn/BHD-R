'use client';

import { useEffect, useState, useTransition } from 'react';
import { ApiError, browserNextMutation, humanizeBrowserError } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { GuestStayActions, type GuestStayActionBooking } from '@/components/stays/guest-stay-actions';
import { rememberStayTripAlert, stayStatusLabel } from '@/lib/stay-trip-alerts';
import { formatMoney } from '@/lib/format';

type GuestBooking = GuestStayActionBooking & {
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
  const [autoTried, setAutoTried] = useState(false);

  async function runLookup(codeRaw: string) {
    setError(null);
    setHint(null);
    setResult(null);
    const code = codeRaw.trim().toUpperCase();
    if (code.length < 4) {
      setError(ar ? 'أدخل مرجع حجز صالحاً' : 'Enter a valid booking reference');
      return;
    }
    try {
      const response = await fetch(
        `/api/public/stays/guest/lookup?referenceCode=${encodeURIComponent(code)}`,
        {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(20_000),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | GuestBooking
        | { error?: { code?: string; messageAr?: string; message?: string } }
        | null;
      if (!response.ok) {
        const err = payload && 'error' in payload ? payload.error : null;
        throw new ApiError(
          response.status,
          err?.code ?? 'api_error',
          err?.messageAr ??
            err?.message ??
            (ar ? 'تعذر البحث عن الحجز.' : 'Could not look up booking.'),
        );
      }
      const booking = payload as GuestBooking;
      setResult(booking);
      rememberStayTripAlert({
        id: booking.id,
        referenceCode: booking.referenceCode,
        status: booking.status,
        checkInOn: booking.checkInOn,
        checkOutOn: booking.checkOutOn,
        ...(booking.currency ? { currency: booking.currency } : {}),
        ...(booking.totalMinor ? { totalMinor: booking.totalMinor } : {}),
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setError(
          ar
            ? 'لم يُعثر على الحجز أو المسار غير مفعّل.'
            : 'Booking not found or stays surface is disabled.',
        );
        return;
      }
      setError(humanizeBrowserError(caught, ar));
    }
  }

  function lookup() {
    startTransition(async () => {
      await runLookup(referenceCode);
    });
  }

  useEffect(() => {
    if (!initialReference || autoTried) return;
    setAutoTried(true);
    startTransition(async () => {
      await runLookup(initialReference);
    });
    // Auto-run once when arriving from confirmation with ?ref=
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReference, autoTried]);

  function claim() {
    if (!result) return;
    startTransition(async () => {
      setError(null);
      setHint(null);
      try {
        await browserNextMutation('/api/public/stays/guest/claim', {
          method: 'POST',
          body: JSON.stringify({ referenceCode: result.referenceCode }),
        });
        setHint(ar ? 'تم ربط الحجز بحسابك.' : 'Booking linked to your account.');
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          setError(ar ? 'سجّل الدخول لربط الحجز بحسابك.' : 'Sign in to claim this booking.');
          return;
        }
        setError(humanizeBrowserError(caught, ar));
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
            {ar ? 'الحالة' : 'Status'}: <strong>{stayStatusLabel(result.status, ar)}</strong>
          </p>
          <p>
            {result.checkInOn} → {result.checkOutOn}
            {result.nights != null ? ` · ${result.nights} ${ar ? 'ليلة' : 'nights'}` : ''}
          </p>
          {result.totalMinor && result.currency ? (
            <p dir="ltr">{formatMoney(result.totalMinor, result.currency, locale)}</p>
          ) : null}
          <div className="guest-stays-lookup__links">
            <Link
              className="text-link"
              href={`/guest/stays/${result.id}?ref=${encodeURIComponent(result.referenceCode)}`}
            >
              {ar ? 'تفاصيل الحجز' : 'Booking details'}
            </Link>
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
          </div>
          <GuestStayActions
            booking={result}
            onUpdated={(next) => setResult((prev) => (prev ? { ...prev, ...next } : next))}
          />
        </article>
      ) : null}
    </section>
  );
}
