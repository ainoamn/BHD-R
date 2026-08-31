'use client';

import { useState, useTransition } from 'react';
import { ApiError, browserPublicGet, browserPublicMutation } from '@/lib/api';

type QuoteResult = {
  id: string;
  nights: number;
  currency: string;
  subtotalMinor: string;
  feesMinor: string;
  taxMinor: string;
  totalMinor: string;
  expiresAt: string;
};

type HoldResult = {
  id: string;
  expiresAt: string;
  duplicate?: boolean;
};

type BookingResult = {
  bookingId: string;
  referenceCode: string;
  status: string;
  paymentIntentId: string;
  amountMinor: string;
  currency: string;
  duplicate?: boolean;
};

type AvailabilityResult = {
  available: boolean;
  reason?: string;
  nights?: number;
};

function defaultCheckIn(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

function defaultCheckOut(checkIn: string): string {
  const d = new Date(`${checkIn}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 2);
  return d.toISOString().slice(0, 10);
}

function formatMinor(amountMinor: string, currency: string): string {
  return `${currency} ${amountMinor}`;
}

export function StayCheckout({
  locale,
  slug,
  defaults,
}: {
  locale: string;
  slug: string;
  defaults?: {
    checkInOn?: string;
    checkOutOn?: string;
    adults?: string;
    children?: string;
  };
}) {
  const ar = locale === 'ar';
  const initialIn = defaults?.checkInOn || defaultCheckIn();
  const [checkInOn, setCheckInOn] = useState(initialIn);
  const [checkOutOn, setCheckOutOn] = useState(
    defaults?.checkOutOn || defaultCheckOut(initialIn),
  );
  const [adults, setAdults] = useState(defaults?.adults ?? '2');
  const [children, setChildren] = useState(defaults?.children ?? '0');
  const [guestName, setGuestName] = useState('');
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [booking, setBooking] = useState<BookingResult | null>(null);
  const [stepHint, setStepHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  function runCheckout() {
    startTransition(async () => {
      setError(null);
      setBooking(null);
      setQuote(null);
      const holdKey = `stay-hold-${slug}-${crypto.randomUUID()}`;
      const bookKey = `stay-book-${slug}-${crypto.randomUUID()}`;
      setStepHint(ar ? 'التحقق من التوافر…' : 'Checking availability…');
      try {
        const qs = new URLSearchParams({
          checkInOn,
          checkOutOn,
          adults,
          children,
        });
        const availability = await browserPublicGet<AvailabilityResult>(
          `/v1/public/stays/${encodeURIComponent(slug)}/availability?${qs.toString()}`,
        );
        if (!availability.available) {
          throw new Error(
            availability.reason === 'guests_exceed_max'
              ? ar
                ? 'عدد الضيوف يتجاوز الحد الأقصى'
                : 'Guest count exceeds the maximum'
              : availability.reason === 'nights_out_of_range'
                ? ar
                  ? 'مدة الإقامة خارج النطاق المسموح'
                  : 'Stay length is outside the allowed range'
                : ar
                  ? 'التواريخ غير متاحة'
                  : 'Selected dates are not available',
          );
        }

        setStepHint(ar ? 'إنشاء عرض السعر…' : 'Creating quote…');
        const nextQuote = await browserPublicMutation<QuoteResult>(
          `/v1/public/stays/${encodeURIComponent(slug)}/quotes`,
          {
            checkInOn,
            checkOutOn,
            adults: Number(adults),
            children: Number(children),
          },
        );
        setQuote(nextQuote);

        setStepHint(ar ? 'حجز مؤقت للمخزون…' : 'Holding inventory…');
        const hold = await browserPublicMutation<HoldResult>(
          '/v1/public/stays/holds',
          { quoteId: nextQuote.id },
          { idempotencyKey: holdKey },
        );

        setStepHint(ar ? 'إنشاء الحجز ونية الدفع…' : 'Creating booking & payment intent…');
        const nextBooking = await browserPublicMutation<BookingResult>(
          '/v1/public/stays/bookings',
          {
            holdId: hold.id,
            guestDisplayName: guestName.trim() || undefined,
          },
          { idempotencyKey: bookKey },
        );
        setBooking(nextBooking);
        setStepHint(null);
      } catch (caught) {
        setStepHint(null);
        if (caught instanceof ApiError && caught.status === 404) {
          setError(
            ar
              ? 'مسار الإقامات غير مفعّل حالياً (العلم مغلق أو الإعلان غير منشور).'
              : 'Stays booking surface is not enabled yet (flag off or listing unpublished).',
          );
          return;
        }
        setError(caught instanceof Error ? caught.message : 'checkout_failed');
      }
    });
  }

  function payNow() {
    if (!booking) return;
    setPayBusy(true);
    setError(null);
    void (async () => {
      try {
        const returnPath = `/${locale}/guest/stays?ref=${encodeURIComponent(booking.referenceCode)}`;
        const session = await browserPublicMutation<{ redirectUrl: string }>(
          '/v1/public/stays/payment-sessions',
          {
            paymentIntentId: booking.paymentIntentId,
            locale: locale === 'en' ? 'en' : 'ar',
            returnPath,
          },
          { idempotencyKey: `stay-pay-${booking.paymentIntentId}` },
        );
        const target = new URL(session.redirectUrl);
        if (
          target.protocol !== 'https:' &&
          !(target.protocol === 'http:' && target.hostname === 'localhost')
        ) {
          throw new Error('invalid_payment_redirect');
        }
        window.location.assign(target.href);
      } catch (caught) {
        setError(
          caught instanceof ApiError && caught.status === 409
            ? ar
              ? 'بوابة الدفع غير مفعّلة لهذه البيئة (sandbox / مزوّد).'
              : 'Payment gateway is not active in this environment (sandbox / provider).'
            : caught instanceof Error
              ? caught.message
              : 'payment_failed',
        );
        setPayBusy(false);
      }
    })();
  }

  return (
    <section className="stays-checkout" aria-labelledby="stays-checkout-title">
      <h2 id="stays-checkout-title">{ar ? 'احجز هذه الإقامة' : 'Book this stay'}</h2>
      <p className="muted">
        {ar
          ? 'عرض سعر → حجز مؤقت → نية دفع. تأكيد الدفع عبر مزوّد الدفع / webhook.'
          : 'Quote → hold → payment intent. Payment confirms via provider webhook.'}
      </p>

      <form
        className="stays-checkout__form"
        onSubmit={(event) => {
          event.preventDefault();
          runCheckout();
        }}
      >
        <div className="stays-checkout__grid">
          <div className="field">
            <label htmlFor="stay-book-in">{ar ? 'الوصول' : 'Check-in'}</label>
            <input
              className="input"
              id="stay-book-in"
              type="date"
              required
              value={checkInOn}
              onChange={(event) => setCheckInOn(event.target.value)}
              disabled={pending || Boolean(booking)}
            />
          </div>
          <div className="field">
            <label htmlFor="stay-book-out">{ar ? 'المغادرة' : 'Check-out'}</label>
            <input
              className="input"
              id="stay-book-out"
              type="date"
              required
              value={checkOutOn}
              onChange={(event) => setCheckOutOn(event.target.value)}
              disabled={pending || Boolean(booking)}
            />
          </div>
          <div className="field">
            <label htmlFor="stay-book-adults">{ar ? 'بالغون' : 'Adults'}</label>
            <select
              className="select"
              id="stay-book-adults"
              value={adults}
              onChange={(event) => setAdults(event.target.value)}
              disabled={pending || Boolean(booking)}
            >
              {[1, 2, 3, 4, 5, 6, 8, 10].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="stay-book-children">{ar ? 'أطفال' : 'Children'}</label>
            <select
              className="select"
              id="stay-book-children"
              value={children}
              onChange={(event) => setChildren(event.target.value)}
              disabled={pending || Boolean(booking)}
            >
              {[0, 1, 2, 3, 4, 5].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </div>
          <div className="field stays-checkout__name">
            <label htmlFor="stay-book-name">{ar ? 'اسم الضيف (اختياري)' : 'Guest name (optional)'}</label>
            <input
              className="input"
              id="stay-book-name"
              type="text"
              maxLength={160}
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              disabled={pending || Boolean(booking)}
              autoComplete="name"
            />
          </div>
        </div>

        <button type="submit" className="button button--primary" disabled={pending || Boolean(booking)}>
          {pending
            ? ar
              ? 'جارٍ الحجز…'
              : 'Booking…'
            : booking
              ? ar
                ? 'تم إنشاء الحجز'
                : 'Booking created'
              : ar
                ? 'احجز الآن'
                : 'Book now'}
        </button>
      </form>

      {stepHint ? (
        <p className="notice notice--info" role="status">
          {stepHint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {quote && !booking ? (
        <div className="stays-checkout__quote" role="status">
          <p>
            {ar ? 'عرض السعر' : 'Quote'}:{' '}
            <strong dir="ltr">{formatMinor(quote.totalMinor, quote.currency)}</strong>
            {` · ${quote.nights} ${ar ? 'ليلة' : 'nights'}`}
          </p>
        </div>
      ) : null}

      {booking ? (
        <div className="stays-checkout__result notice notice--info" role="status">
          <p>
            {ar ? 'مرجع الحجز' : 'Booking reference'}:{' '}
            <strong dir="ltr">{booking.referenceCode}</strong>
          </p>
          <p>
            {ar ? 'الحالة' : 'Status'}: <strong dir="ltr">{booking.status}</strong>
          </p>
          <p>
            {ar ? 'المبلغ' : 'Amount'}:{' '}
            <strong dir="ltr">{formatMinor(booking.amountMinor, booking.currency)}</strong>
          </p>
          <p className="muted" dir="ltr">
            paymentIntentId: {booking.paymentIntentId}
          </p>
          <p className="muted">
            {ar
              ? 'ادفع عبر بوابة المزوّد (sandbox محلياً). التأكيد يمرّ بمسار stay_booking.'
              : 'Pay via the provider redirect (sandbox locally). Confirmation uses the stay_booking path.'}
          </p>
          <div className="stays-checkout__pay-actions">
            <button
              type="button"
              className="button button--primary"
              disabled={payBusy}
              onClick={() => payNow()}
            >
              {payBusy
                ? ar
                  ? 'جارٍ التحويل…'
                  : 'Redirecting…'
                : ar
                  ? 'ادفع الآن'
                  : 'Pay now'}
            </button>
            <a
              className="text-link"
              href={`/${locale}/guest/stays?ref=${encodeURIComponent(booking.referenceCode)}`}
            >
              {ar ? 'متابعة الرحلة لاحقاً' : 'Track trip later'}
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}
