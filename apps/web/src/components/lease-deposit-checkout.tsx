'use client';

import { useEffect, useState, useTransition } from 'react';
import { ApiError, fetchBrowserCsrfToken, humanizeBrowserError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { leaseBookingTerms } from '@/lib/lease-booking-terms';
import { isValidGuestPhone } from '@/lib/stay-booking-dates';

type Mode = 'rent' | 'sale';
type Step = 'terms' | 'details' | 'review' | 'payment';

type CheckoutResult = {
  referenceCode: string;
  sessionReference: string;
  amountMinor: string;
  currency: string;
  expiresAt: string;
  alreadyPaid: boolean;
  nextPath: string;
};

async function postDepositCheckout(body: Record<string, unknown>): Promise<CheckoutResult> {
  const send = async (csrf: string) =>
    fetch('/api/public/bookings/deposit-checkout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
  let response = await send(await fetchBrowserCsrfToken());
  if (response.status === 403) response = await send(await fetchBrowserCsrfToken(true));
  const payload = (await response.json().catch(() => null)) as
    | (CheckoutResult & { error?: { code?: string; message?: string; messageAr?: string } })
    | null;
  if (!response.ok || !payload?.nextPath) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'booking_failed',
      payload?.error?.messageAr ?? payload?.error?.message ?? 'booking_failed',
    );
  }
  return payload;
}

export function LeaseDepositCheckout({
  locale,
  unitId,
  title,
  initialMode,
  allowedModes,
  depositMinor,
  currency,
  rentMinor,
  salePriceMinor,
  defaults,
}: {
  locale: 'ar' | 'en';
  unitId: string;
  title: string;
  initialMode: Mode;
  allowedModes: Mode[];
  depositMinor: string;
  currency: string;
  rentMinor: string | null;
  salePriceMinor: string | null;
  defaults?: { fullName?: string; email?: string };
}) {
  const ar = locale === 'ar';
  const [step, setStep] = useState<Step>('terms');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [accepted, setAccepted] = useState(false);
  const [fullName, setFullName] = useState(defaults?.fullName ?? '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(defaults?.email ?? '');
  const [checkout, setCheckout] = useState<CheckoutResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stepHint, setStepHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setError(null);
  }, [step]);

  const deposit = formatMoney(depositMinor, currency, locale);
  const priceMinor = mode === 'sale' ? salePriceMinor : rentMinor;
  const price = priceMinor && priceMinor !== '0' ? formatMoney(priceMinor, currency, locale) : null;
  const terms = leaseBookingTerms({ mode, ar, deposit, price });
  const modeLabel =
    mode === 'sale' ? (ar ? 'حجز للشراء' : 'Reserve to buy') : ar ? 'حجز للإيجار' : 'Reserve to rent';
  const priceLabel =
    mode === 'sale' ? (ar ? 'سعر البيع' : 'Sale price') : ar ? 'الإيجار الشهري' : 'Monthly rent';

  const steps: { id: Step; label: string }[] = [
    { id: 'terms', label: ar ? 'الشروط' : 'Terms' },
    { id: 'details', label: ar ? 'بياناتك' : 'Your details' },
    { id: 'review', label: ar ? 'المراجعة' : 'Review' },
    { id: 'payment', label: ar ? 'الدفع' : 'Payment' },
  ];
  const currentIndex = steps.findIndex((item) => item.id === step);

  function continueFromTerms() {
    if (!accepted) {
      setError(ar ? 'يجب الإقرار بالموافقة على الشروط للمتابعة.' : 'Accept the terms to continue.');
      return;
    }
    setStep('details');
  }

  function continueFromDetails() {
    if (fullName.trim().length < 2) {
      setError(ar ? 'أدخل الاسم الكامل (حرفان على الأقل)' : 'Enter your full name (at least 2 characters)');
      return;
    }
    if (!isValidGuestPhone(phone)) {
      setError(ar ? 'رقم الهاتف إلزامي (٨–١٥ رقماً)' : 'Phone is required (8–15 digits)');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(ar ? 'البريد الإلكتروني غير صالح' : 'Email is invalid');
      return;
    }
    setStep('review');
  }

  function goTo(path: string) {
    if (!path.startsWith(`/${locale}/`)) throw new Error('invalid_redirect');
    window.location.assign(path);
  }

  function confirmAndPay() {
    setConfirmOpen(false);
    startTransition(async () => {
      setError(null);
      setStepHint(ar ? 'حجز الوحدة مؤقتاً…' : 'Holding the unit…');
      try {
        const result = await postDepositCheckout({
          unitId,
          mode,
          locale,
          fullName: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          termsAccepted: true,
        });
        setCheckout(result);
        setStep('payment');
        setPayBusy(true);
        setStepHint(
          result.alreadyPaid
            ? ar
              ? 'تم دفع مبلغ الضمان مسبقاً — جارٍ فتح العقد…'
              : 'Deposit already paid — opening the contract…'
            : ar
              ? 'التحويل إلى بوابة الدفع…'
              : 'Redirecting to payment gateway…',
        );
        goTo(result.nextPath);
      } catch (caught) {
        setStepHint(null);
        setPayBusy(false);
        if (caught instanceof ApiError && caught.status === 401) {
          window.location.assign(
            `/${locale}/login?next=${encodeURIComponent(`/${locale}/book/${unitId}?mode=${mode}`)}`,
          );
          return;
        }
        setError(humanizeBrowserError(caught, ar));
      }
    });
  }

  function payNow() {
    if (!checkout) return;
    setPayBusy(true);
    try {
      goTo(checkout.nextPath);
    } catch (caught) {
      setPayBusy(false);
      setError(humanizeBrowserError(caught, ar));
    }
  }

  return (
    <section
      className="stays-checkout stays-checkout--wizard stays-checkout--page"
      aria-labelledby="lease-checkout-title"
    >
      <h2 id="lease-checkout-title">{ar ? 'إكمال الحجز' : 'Complete your booking'}</h2>
      <p className="stays-checkout__property muted">{title}</p>

      <ol className="stays-checkout__steps" aria-label={ar ? 'خطوات الحجز' : 'Booking steps'}>
        {steps.map((item, index) => {
          const active = item.id === step;
          const done = index < currentIndex;
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

      {step === 'terms' ? (
        <div className="stays-checkout__panel">
          <h3>{ar ? 'الشروط والأحكام' : 'Terms & conditions'}</h3>
          {allowedModes.length > 1 ? (
            <div
              className="lease-checkout__modes"
              role="group"
              aria-label={ar ? 'نوع الحجز' : 'Booking type'}
            >
              {allowedModes.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`button ${mode === option ? 'button--primary' : 'button--quiet'}`}
                  aria-pressed={mode === option}
                  onClick={() => {
                    setMode(option);
                    setAccepted(false);
                  }}
                >
                  {option === 'sale'
                    ? ar
                      ? 'أريد الشراء'
                      : 'I want to buy'
                    : ar
                      ? 'أريد التأجير'
                      : 'I want to rent'}
                </button>
              ))}
            </div>
          ) : null}
          <dl className="stays-checkout__summary">
            <div>
              <dt>{ar ? 'نوع الحجز' : 'Booking type'}</dt>
              <dd>{modeLabel}</dd>
            </div>
            <div>
              <dt>{priceLabel}</dt>
              <dd dir="ltr">{price ?? '—'}</dd>
            </div>
            <div>
              <dt>{ar ? 'مبلغ الضمان المطلوب' : 'Deposit due now'}</dt>
              <dd dir="ltr">
                <strong>{deposit}</strong>
              </dd>
            </div>
          </dl>
          <ol className="lease-checkout__terms">
            {terms.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <label className="checkbox-row lease-checkout__accept">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            <span>
              {ar
                ? 'أقر بأنني قرأت الشروط والأحكام أعلاه وأوافق عليها.'
                : 'I confirm I have read and agree to the terms above.'}
            </span>
          </label>
          <button
            type="button"
            className="button button--primary"
            disabled={!accepted}
            onClick={continueFromTerms}
          >
            {ar ? 'متابعة' : 'Continue'}
          </button>
        </div>
      ) : null}

      {step === 'details' ? (
        <div className="stays-checkout__panel">
          <h3>{ar ? 'بياناتك' : 'Your details'}</h3>
          <p className="muted stays-checkout__hint">
            {ar
              ? 'تم تعبئة بياناتك من حسابك إن وُجدت — يمكنك تعديلها قبل المتابعة.'
              : 'We prefilled your account details when available — you can edit before continuing.'}
          </p>
          <div className="stays-checkout__grid">
            <div className="field stays-checkout__name">
              <label htmlFor="lease-book-name">{ar ? 'الاسم الكامل (كما في البطاقة)' : 'Full name (as on ID)'}</label>
              <input
                className="input"
                id="lease-book-name"
                type="text"
                required
                minLength={2}
                maxLength={160}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </div>
            <div className="field">
              <label htmlFor="lease-book-phone">{ar ? 'الهاتف (إلزامي)' : 'Phone (required)'}</label>
              <input
                className="input"
                id="lease-book-phone"
                type="tel"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                autoComplete="tel"
                dir="ltr"
                placeholder={ar ? 'مثال: 9689xxxxxxx' : 'e.g. 9689xxxxxxx'}
              />
            </div>
            <div className="field stays-checkout__name">
              <label htmlFor="lease-book-email">{ar ? 'البريد الإلكتروني' : 'Email'}</label>
              <input
                className="input"
                id="lease-book-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                dir="ltr"
              />
            </div>
          </div>
          <div className="stays-checkout__nav">
            <button type="button" className="button button--quiet" onClick={() => setStep('terms')}>
              {ar ? 'رجوع' : 'Back'}
            </button>
            <button type="button" className="button button--primary" onClick={continueFromDetails}>
              {ar ? 'متابعة' : 'Continue'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 'review' ? (
        <div className="stays-checkout__panel">
          <h3>{ar ? 'مراجعة الحجز' : 'Review your booking'}</h3>
          <dl className="stays-checkout__summary">
            <div>
              <dt>{ar ? 'العقار' : 'Property'}</dt>
              <dd>{title}</dd>
            </div>
            <div>
              <dt>{ar ? 'نوع الحجز' : 'Booking type'}</dt>
              <dd>{modeLabel}</dd>
            </div>
            <div>
              <dt>{ar ? 'الاسم' : 'Name'}</dt>
              <dd>{fullName}</dd>
            </div>
            <div>
              <dt>{ar ? 'الهاتف' : 'Phone'}</dt>
              <dd dir="ltr">{phone}</dd>
            </div>
            <div>
              <dt>{priceLabel}</dt>
              <dd dir="ltr">{price ?? '—'}</dd>
            </div>
            <div>
              <dt>{ar ? 'مبلغ الضمان' : 'Deposit'}</dt>
              <dd dir="ltr">
                <strong>{deposit}</strong>
              </dd>
            </div>
          </dl>
          <p className="muted stays-checkout__hint">
            {ar
              ? 'يُحجز العقار باسمك فقط بعد دفع مبلغ الضمان بنجاح، ثم تنتقل مباشرة لتوقيع العقد وإرفاق المستندات.'
              : 'The property is reserved for you only after the deposit is paid; you then sign the contract and attach documents.'}
          </p>
          <div className="stays-checkout__nav">
            <button type="button" className="button button--quiet" onClick={() => setStep('details')}>
              {ar ? 'رجوع' : 'Back'}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={pending || payBusy}
              onClick={() => setConfirmOpen(true)}
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

      {step === 'payment' && checkout ? (
        <div className="stays-checkout__panel">
          <h3>{ar ? 'تم إنشاء الحجز — أكمل الدفع' : 'Booking created — complete payment'}</h3>
          <dl className="stays-checkout__summary">
            <div>
              <dt>{ar ? 'مرجع الحجز' : 'Reference'}</dt>
              <dd dir="ltr">
                <strong>{checkout.referenceCode}</strong>
              </dd>
            </div>
            <div>
              <dt>{ar ? 'نوع الحجز' : 'Booking type'}</dt>
              <dd>{modeLabel}</dd>
            </div>
            <div>
              <dt>{ar ? 'مبلغ الضمان' : 'Deposit'}</dt>
              <dd dir="ltr">
                <strong>{formatMoney(checkout.amountMinor, checkout.currency, locale)}</strong>
              </dd>
            </div>
          </dl>
          <p className="muted stays-checkout__hint">
            {ar
              ? 'أكمل الدفع خلال 30 دقيقة للاحتفاظ بالحجز، وبعده يُفتح العقد للتوقيع.'
              : 'Pay within 30 minutes to keep the booking; the contract opens for signing right after.'}
          </p>
          <div className="stays-checkout__nav">
            <button
              type="button"
              className="button button--primary"
              disabled={payBusy}
              onClick={payNow}
            >
              {payBusy
                ? ar
                  ? 'جارٍ التحويل…'
                  : 'Redirecting…'
                : checkout.alreadyPaid
                  ? ar
                    ? 'متابعة لتوقيع العقد'
                    : 'Continue to sign'
                  : ar
                    ? 'ادفع الآن'
                    : 'Pay now'}
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

      {confirmOpen ? (
        <div
          className="stays-checkout__modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lease-pay-confirm-title"
        >
          <div className="stays-checkout__modal-card">
            <h3 id="lease-pay-confirm-title">
              {ar ? 'تأكيد الدفع مطلوب' : 'Payment required to confirm'}
            </h3>
            <p>
              {ar
                ? `للاحتفاظ بالعقار، يجب دفع مبلغ الضمان (${deposit}) الآن. يُعتبر الحجز مؤكّداً فقط بعد إتمام الدفع بنجاح. بالموافقة ستُفتح بوابة الدفع الآمنة.`
                : `To keep this property, pay the deposit (${deposit}) now. The booking is confirmed only after successful payment. Agreeing opens the secure payment gateway.`}
            </p>
            <div className="stays-checkout__nav">
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setConfirmOpen(false)}
              >
                {ar ? 'رجوع' : 'Back'}
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={pending || payBusy}
                onClick={confirmAndPay}
              >
                {ar ? 'موافق — متابعة للدفع' : 'Agree — continue to pay'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
