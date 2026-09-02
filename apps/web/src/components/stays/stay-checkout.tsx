'use client';

import { useEffect, useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import {
  ApiError,
  browserStayBookingGet,
  browserStayBookingMutation,
  humanizeBrowserError,
} from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { rememberStayTripAlert } from '@/lib/stay-trip-alerts';
import { stayStatusLabel } from '@/lib/ui-labels';

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

type StayType = 'overnight_stay' | 'day_use' | 'overnight_only';

type Step = 'stay' | 'guest' | 'review' | 'payment';

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

function stayTypeLabel(type: StayType, ar: boolean): string {
  if (type === 'day_use') return ar ? 'إقامة بدون مبيت' : 'Day use (no overnight)';
  if (type === 'overnight_only') return ar ? 'مبيت فقط' : 'Overnight only';
  return ar ? 'إقامة مع مبيت' : 'Stay with overnight';
}

export function StayCheckout({
  locale,
  slug,
  title,
  defaults,
  embedded = false,
  bookingDates,
  unitId,
}: {
  locale: string;
  slug: string;
  title?: string;
  defaults?: {
    checkInOn?: string;
    checkOutOn?: string;
    adults?: string;
    children?: string;
    stayType?: StayType;
    guestName?: string;
    guestEmail?: string;
    guestPhone?: string;
  };
  /** Sidebar on Property 360 — calendar lives in the main column. */
  embedded?: boolean;
  bookingDates?: {
    checkInOn: string;
    checkOutOn: string;
  };
  /** Pin booking to a published unit when several share one listing slug. */
  unitId?: string;
}) {
  const ar = locale === 'ar';
  const initialIn = defaults?.checkInOn || defaultCheckIn();
  const [step, setStep] = useState<Step>('stay');
  const [checkInOn, setCheckInOn] = useState(initialIn);
  const [checkOutOn, setCheckOutOn] = useState(defaults?.checkOutOn || defaultCheckOut(initialIn));
  const [adults, setAdults] = useState(defaults?.adults ?? '2');
  const [children, setChildren] = useState(defaults?.children ?? '0');
  const [stayType, setStayType] = useState<StayType>(defaults?.stayType ?? 'overnight_stay');
  const [guestName, setGuestName] = useState(defaults?.guestName ?? '');
  const [guestPhone, setGuestPhone] = useState(defaults?.guestPhone ?? '');
  const [guestEmail, setGuestEmail] = useState(defaults?.guestEmail ?? '');
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [booking, setBooking] = useState<BookingResult | null>(null);
  const [stepHint, setStepHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!bookingDates) return;
    setCheckInOn(bookingDates.checkInOn);
    setCheckOutOn(bookingDates.checkOutOn);
  }, [bookingDates?.checkInOn, bookingDates?.checkOutOn]);

  useEffect(() => {
    setError(null);
  }, [step]);

  useEffect(() => {
    if (defaults?.guestName || defaults?.guestEmail) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (!response.ok || cancelled) return;
        const me = (await response.json()) as {
          authenticated?: boolean;
          displayName?: string;
          email?: string;
        };
        if (!me.authenticated || cancelled) return;
        if (me.displayName?.trim()) setGuestName((prev) => prev || me.displayName!.trim());
        if (me.email?.trim()) setGuestEmail((prev) => prev || me.email!.trim());
      } catch {
        /* anonymous guest — leave blank */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [defaults?.guestName, defaults?.guestEmail]);

  const steps: { id: Step; label: string }[] = [
    { id: 'stay', label: ar ? 'الإقامة' : 'Your stay' },
    { id: 'guest', label: ar ? 'بياناتك' : 'Your details' },
    { id: 'review', label: ar ? 'المراجعة' : 'Review' },
    { id: 'payment', label: ar ? 'الدفع' : 'Payment' },
  ];

  function stepIndex(id: Step): number {
    return steps.findIndex((item) => item.id === id);
  }

  async function loadQuote(): Promise<QuoteResult> {
    const qs = new URLSearchParams({ checkInOn, checkOutOn, adults, children });
    if (unitId) qs.set('unitId', unitId);
    const availability = await browserStayBookingGet<AvailabilityResult>(
      `/${encodeURIComponent(slug)}/availability?${qs.toString()}`,
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
              ? 'التواريخ غير متاحة — جرّب تواريخاً أخرى'
              : 'Dates not available — try different dates',
      );
    }
    return browserStayBookingMutation<QuoteResult>(
      `/${encodeURIComponent(slug)}/quotes${unitId ? `?unitId=${encodeURIComponent(unitId)}` : ''}`,
      {
        checkInOn,
        checkOutOn,
        adults: Number(adults),
        children: Number(children),
        stayType,
        ...(unitId ? { unitId } : {}),
      },
    );
  }

  function continueFromStay() {
    setError(null);
    if (!checkInOn || !checkOutOn || checkOutOn <= checkInOn) {
      setError(ar ? 'تحقق من التواريخ' : 'Check your dates');
      return;
    }
    setStep('guest');
  }

  function continueFromGuest() {
    setError(null);
    if (!guestName.trim() || guestName.trim().length < 2) {
      setError(
        ar ? 'أدخل اسم الضيف (حرفان على الأقل)' : 'Enter guest name (at least 2 characters)',
      );
      return;
    }
    setStep('review');
    setQuote(null);
    startTransition(async () => {
      setStepHint(ar ? 'التحقق من التوافر وعرض السعر…' : 'Checking availability and pricing…');
      try {
        const nextQuote = await loadQuote();
        setQuote(nextQuote);
        setStepHint(null);
      } catch (caught) {
        setStepHint(null);
        setError(humanizeBrowserError(caught, ar));
      }
    });
  }

  async function redirectToPayment(nextBooking: BookingResult) {
    setPayBusy(true);
    setStepHint(ar ? 'التحويل إلى بوابة الدفع…' : 'Redirecting to payment gateway…');
    const returnPath = `/${locale}/stays/booking/confirmed?ref=${encodeURIComponent(nextBooking.referenceCode)}`;
    const session = await browserStayBookingMutation<{ redirectUrl: string }>(
      '/payment-sessions',
      {
        paymentIntentId: nextBooking.paymentIntentId,
        locale: locale === 'en' ? 'en' : 'ar',
        returnPath,
      },
      { idempotencyKey: `stay-pay-${nextBooking.paymentIntentId}` },
    );
    const target = new URL(session.redirectUrl);
    if (
      target.protocol !== 'https:' &&
      !(target.protocol === 'http:' && target.hostname === 'localhost')
    ) {
      throw new Error('invalid_payment_redirect');
    }
    window.location.assign(target.href);
  }

  function confirmBooking() {
    if (!quote) return;
    startTransition(async () => {
      setError(null);
      setBooking(null);
      const holdKey = `stay-hold-${slug}-${crypto.randomUUID()}`;
      const bookKey = `stay-book-${slug}-${crypto.randomUUID()}`;
      setStepHint(ar ? 'حجز مؤقت…' : 'Holding inventory…');
      try {
        const hold = await browserStayBookingMutation<HoldResult>(
          '/holds',
          { quoteId: quote.id },
          { idempotencyKey: holdKey },
        );
        setStepHint(ar ? 'إنشاء الحجز…' : 'Creating booking…');
        const nextBooking = await browserStayBookingMutation<BookingResult>(
          '/bookings',
          {
            holdId: hold.id,
            guestDisplayName: guestName.trim(),
            ...(guestEmail.trim() ? { guestEmail: guestEmail.trim() } : {}),
            ...(guestPhone.trim() ? { guestPhone: guestPhone.trim() } : {}),
          },
          { idempotencyKey: bookKey },
        );
        setBooking(nextBooking);
        rememberStayTripAlert({
          id: nextBooking.bookingId,
          referenceCode: nextBooking.referenceCode,
          status: nextBooking.status,
          checkInOn,
          checkOutOn,
          currency: nextBooking.currency,
          totalMinor: nextBooking.amountMinor,
        });
        setStep('payment');
        try {
          await redirectToPayment(nextBooking);
        } catch (payError) {
          setStepHint(null);
          setPayBusy(false);
          setError(
            payError instanceof ApiError && payError.status === 409
              ? ar
                ? 'بوابة الدفع غير مفعّلة في هذه البيئة. يمكنك المحاولة من زر ادفع الآن.'
                : 'Payment gateway is not active. Use Pay now to retry.'
              : humanizeBrowserError(payError, ar),
          );
        }
      } catch (caught) {
        setStepHint(null);
        if (caught instanceof ApiError && caught.status === 404) {
          setError(ar ? 'مسار الإقامات غير مفعّل حالياً.' : 'Stays booking is not enabled yet.');
          return;
        }
        setError(humanizeBrowserError(caught, ar));
      }
    });
  }

  function payNow() {
    if (!booking) return;
    setError(null);
    void (async () => {
      try {
        await redirectToPayment(booking);
      } catch (caught) {
        setError(
          caught instanceof ApiError && caught.status === 409
            ? ar
              ? 'بوابة الدفع غير مفعّلة في هذه البيئة.'
              : 'Payment gateway is not active in this environment.'
            : humanizeBrowserError(caught, ar),
        );
        setPayBusy(false);
        setStepHint(null);
      }
    })();
  }

  return (
    <section
      className={
        embedded
          ? 'stays-checkout stays-checkout--wizard'
          : 'stays-checkout stays-checkout--wizard stays-checkout--page'
      }
      aria-labelledby="stays-checkout-title"
    >
      <h2 id="stays-checkout-title">{ar ? 'إكمال الحجز' : 'Complete your booking'}</h2>
      {title ? <p className="stays-checkout__property muted">{title}</p> : null}

      <ol className="stays-checkout__steps" aria-label={ar ? 'خطوات الحجز' : 'Booking steps'}>
        {steps.map((item, index) => {
          const current = stepIndex(step);
          const done = index < current || (step === 'payment' && item.id !== 'payment');
          const active = item.id === step;
          return (
            <li
              key={item.id}
              className={
                active
                  ? 'stays-checkout__step is-active'
                  : done
                    ? 'stays-checkout__step is-done'
                    : 'stays-checkout__step'
              }
            >
              <span aria-hidden="true">{index + 1}</span>
              {item.label}
            </li>
          );
        })}
      </ol>

      {step === 'stay' ? (
        <div className="stays-checkout__panel">
          <h3>{ar ? 'تواريخ الإقامة' : 'Stay dates'}</h3>
          {embedded ? (
            <dl className="stays-checkout__summary stays-checkout__summary--inline">
              <div>
                <dt>{ar ? 'الوصول' : 'Check-in'}</dt>
                <dd className="stays-checkout__chip stays-checkout__chip--check-in" dir="ltr">
                  {checkInOn}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
                <dd className="stays-checkout__chip stays-checkout__chip--check-out" dir="ltr">
                  {checkOutOn}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="stays-checkout__grid stays-checkout__grid--compact">
              <div className="field stays-checkout__tone stays-checkout__tone--check-in">
                <label htmlFor="stay-book-in">{ar ? 'الوصول' : 'Check-in'}</label>
                <input
                  className="input"
                  id="stay-book-in"
                  type="date"
                  required
                  value={checkInOn}
                  onChange={(event) => setCheckInOn(event.target.value)}
                />
              </div>
              <div className="field stays-checkout__tone stays-checkout__tone--check-out">
                <label htmlFor="stay-book-out">{ar ? 'المغادرة' : 'Check-out'}</label>
                <input
                  className="input"
                  id="stay-book-out"
                  type="date"
                  required
                  value={checkOutOn}
                  onChange={(event) => setCheckOutOn(event.target.value)}
                />
              </div>
            </div>
          )}
          <div className={`field stays-checkout__tone stays-checkout__tone--stay-${stayType}`}>
            <label htmlFor="stay-book-type">{ar ? 'نوع الحجز' : 'Stay type'}</label>
            <select
              className="select"
              id="stay-book-type"
              value={stayType}
              onChange={(event) => setStayType(event.target.value as StayType)}
            >
              <option value="overnight_stay">{stayTypeLabel('overnight_stay', ar)}</option>
              <option value="day_use">{stayTypeLabel('day_use', ar)}</option>
              <option value="overnight_only">{stayTypeLabel('overnight_only', ar)}</option>
            </select>
          </div>
          <div className="stays-checkout__grid stays-checkout__grid--compact">
            <div className="field stays-checkout__tone stays-checkout__tone--adults">
              <label htmlFor="stay-book-adults">{ar ? 'بالغون' : 'Adults'}</label>
              <select
                className="select"
                id="stay-book-adults"
                value={adults}
                onChange={(event) => setAdults(event.target.value)}
              >
                {[1, 2, 3, 4, 5, 6, 8, 10].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </div>
            <div className="field stays-checkout__tone stays-checkout__tone--children">
              <label htmlFor="stay-book-children">{ar ? 'أطفال' : 'Children'}</label>
              <select
                className="select"
                id="stay-book-children"
                value={children}
                onChange={(event) => setChildren(event.target.value)}
              >
                {[0, 1, 2, 3, 4, 5].map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="button" className="button button--primary" onClick={continueFromStay}>
            {ar ? 'متابعة' : 'Continue'}
          </button>
        </div>
      ) : null}

      {step === 'guest' ? (
        <div className="stays-checkout__panel">
          <h3>{ar ? 'بيانات الضيف' : 'Guest details'}</h3>
          <p className="muted stays-checkout__hint">
            {ar
              ? 'تم تعبئة بياناتك من حسابك إن وُجدت — يمكنك تعديلها قبل المتابعة.'
              : 'We prefilled your account details when available — you can edit before continuing.'}
          </p>
          <div className="stays-checkout__grid">
            <div className="field stays-checkout__name">
              <label htmlFor="stay-book-name">{ar ? 'الاسم الكامل' : 'Full name'}</label>
              <input
                className="input"
                id="stay-book-name"
                type="text"
                required
                minLength={2}
                maxLength={160}
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                autoComplete="name"
              />
            </div>
            <div className="field">
              <label htmlFor="stay-book-phone">
                {ar ? 'الهاتف (اختياري)' : 'Phone (optional)'}
              </label>
              <input
                className="input"
                id="stay-book-phone"
                type="tel"
                value={guestPhone}
                onChange={(event) => setGuestPhone(event.target.value)}
                autoComplete="tel"
                dir="ltr"
              />
            </div>
            <div className="field stays-checkout__name">
              <label htmlFor="stay-book-email">
                {ar ? 'البريد (لإيصال التأكيد)' : 'Email (for confirmation receipt)'}
              </label>
              <input
                className="input"
                id="stay-book-email"
                type="email"
                value={guestEmail}
                onChange={(event) => setGuestEmail(event.target.value)}
                autoComplete="email"
                dir="ltr"
              />
            </div>
          </div>
          <div className="stays-checkout__nav">
            <button type="button" className="button button--quiet" onClick={() => setStep('stay')}>
              {ar ? 'رجوع' : 'Back'}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={pending}
              onClick={continueFromGuest}
            >
              {pending ? (ar ? 'جارٍ التحقق…' : 'Checking…') : ar ? 'متابعة' : 'Continue'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="stays-checkout__panel">
          <h3>{ar ? 'مراجعة الحجز' : 'Review your booking'}</h3>
          <dl className="stays-checkout__summary">
            <div>
              <dt>{ar ? 'الضيف' : 'Guest'}</dt>
              <dd>{guestName}</dd>
            </div>
            <div>
              <dt>{ar ? 'الوصول' : 'Check-in'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--check-in" dir="ltr">
                {checkInOn}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--check-out" dir="ltr">
                {checkOutOn}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'نوع الحجز' : 'Stay type'}</dt>
              <dd className={`stays-checkout__chip stays-checkout__chip--stay-${stayType}`}>
                {stayTypeLabel(stayType, ar)}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'بالغون' : 'Adults'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--adults">{adults}</dd>
            </div>
            <div>
              <dt>{ar ? 'أطفال' : 'Children'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--children">{children}</dd>
            </div>
          </dl>
          {quote ? (
            <dl className="stays-checkout__summary">
              <div>
                <dt>{ar ? 'الليالي' : 'Nights'}</dt>
                <dd>
                  {quote.nights} {ar ? 'ليلة' : 'nights'}
                </dd>
              </div>
              <div>
                <dt>{ar ? 'المجموع' : 'Total'}</dt>
                <dd dir="ltr">
                  <strong>{formatMoney(quote.totalMinor, quote.currency, locale)}</strong>
                </dd>
              </div>
            </dl>
          ) : null}
          <p className="muted stays-checkout__hint">
            {ar
              ? 'شامل الرسوم والضريبة حسب العرض. بعد التأكيد ستنتقل مباشرة لبوابة الدفع.'
              : 'Includes fees and tax per quote. After confirm you go straight to the payment gateway.'}
          </p>
          <div className="stays-checkout__nav">
            <button type="button" className="button button--quiet" onClick={() => setStep('guest')}>
              {ar ? 'رجوع' : 'Back'}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={pending || !quote || payBusy}
              onClick={confirmBooking}
            >
              {pending || payBusy
                ? ar
                  ? 'جارٍ الحجز والدفع…'
                  : 'Booking & paying…'
                : ar
                  ? 'تأكيد الحجز'
                  : 'Confirm booking'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'payment' && booking ? (
        <div className="stays-checkout__panel">
          <h3>{ar ? 'تم إنشاء الحجز — أكمل الدفع' : 'Booking created — complete payment'}</h3>
          <dl className="stays-checkout__summary">
            <div>
              <dt>{ar ? 'مرجع الحجز' : 'Reference'}</dt>
              <dd dir="ltr">
                <strong>{booking.referenceCode}</strong>
              </dd>
            </div>
            <div>
              <dt>{ar ? 'الضيف' : 'Guest'}</dt>
              <dd>{guestName}</dd>
            </div>
            <div>
              <dt>{ar ? 'الوصول' : 'Check-in'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--check-in" dir="ltr">
                {checkInOn}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--check-out" dir="ltr">
                {checkOutOn}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'نوع الحجز' : 'Stay type'}</dt>
              <dd className={`stays-checkout__chip stays-checkout__chip--stay-${stayType}`}>
                {stayTypeLabel(stayType, ar)}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'بالغون' : 'Adults'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--adults">{adults}</dd>
            </div>
            <div>
              <dt>{ar ? 'أطفال' : 'Children'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--children">{children}</dd>
            </div>
            <div>
              <dt>{ar ? 'المبلغ' : 'Amount'}</dt>
              <dd dir="ltr">
                <strong>{formatMoney(booking.amountMinor, booking.currency, locale)}</strong>
              </dd>
            </div>
            <div>
              <dt>{ar ? 'الحالة' : 'Status'}</dt>
              <dd>{stayStatusLabel(booking.status, locale)}</dd>
            </div>
          </dl>
          <p className="muted stays-checkout__hint">
            {ar
              ? 'أكمل الدفع لتأكيد الحجز. بعد الدفع سيظهر إيصال PDF ويُرسل إلى بريدك.'
              : 'Complete payment to confirm. After payment a PDF receipt appears and is emailed to you.'}
          </p>
          <div className="stays-checkout__nav">
            <Link
              className="button button--quiet"
              href={`/stays/booking/confirmed?ref=${encodeURIComponent(booking.referenceCode)}`}
            >
              {ar ? 'عرض التأكيد' : 'View confirmation'}
            </Link>
            <button
              type="button"
              className="button button--primary"
              disabled={payBusy}
              onClick={() => payNow()}
            >
              {payBusy ? (ar ? 'جارٍ التحويل…' : 'Redirecting…') : ar ? 'ادفع الآن' : 'Pay now'}
            </button>
          </div>
        </div>
      ) : null}

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
    </section>
  );
}
