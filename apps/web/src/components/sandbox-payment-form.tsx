'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { browserPublicMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';

async function completeStaySandboxPayment(
  sessionReference: string,
  returnPath?: string,
): Promise<{ completed: boolean; returnPath: string | null; kind?: string }> {
  const response = await fetch(
    `/api/public/stays/payment-sessions/${encodeURIComponent(sessionReference)}/sandbox-complete`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-requested-with': 'BHD-R',
      },
      body: JSON.stringify(returnPath ? { returnPath } : {}),
      signal: AbortSignal.timeout(45_000),
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    error?: { messageAr?: string; message?: string };
    completed?: boolean;
    returnPath?: string | null;
    kind?: string;
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error?.messageAr ?? payload?.error?.message ?? 'payment_failed');
  }
  return {
    completed: Boolean(payload?.completed),
    returnPath: payload?.returnPath ?? null,
    ...(payload?.kind !== undefined ? { kind: payload.kind } : {}),
  };
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function formatCardNumber(value: string): string {
  const digits = digitsOnly(value).slice(0, 19);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function formatExpiry(value: string): string {
  const digits = digitsOnly(value).slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function detectBrand(digits: string): 'visa' | 'mastercard' | 'amex' | 'other' {
  if (/^4/.test(digits)) return 'visa';
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  return 'other';
}

function luhnOk(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function expiryOk(mmYy: string): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(mmYy);
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  const exp = new Date(year, month, 0, 23, 59, 59);
  return exp >= now;
}

export function SandboxPaymentForm({
  sessionReference,
  returnPath,
  stayKind = false,
  amountMinor,
  currency,
  referenceCode,
}: {
  sessionReference: string;
  returnPath?: string;
  stayKind?: boolean;
  amountMinor?: string;
  currency?: string;
  referenceCode?: string;
}) {
  const locale = useLocale();
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [touched, setTouched] = useState(false);

  const cardDigits = digitsOnly(cardNumber);
  const brand = detectBrand(cardDigits);
  const amountLabel =
    amountMinor && currency ? formatMoney(amountMinor, currency, locale) : null;

  const errors = useMemo(() => {
    const next: Record<string, string> = {};
    if (!cardName.trim() || cardName.trim().length < 2) {
      next.name = ar ? 'أدخل الاسم كما على البطاقة' : 'Enter the name on the card';
    }
    if (!luhnOk(cardDigits)) {
      next.number = ar ? 'رقم البطاقة غير صالح' : 'Card number is invalid';
    }
    if (!expiryOk(expiry)) {
      next.expiry = ar ? 'تاريخ الانتهاء غير صالح' : 'Expiry is invalid';
    }
    const cvcLen = brand === 'amex' ? 4 : 3;
    if (digitsOnly(cvc).length !== cvcLen) {
      next.cvc = ar ? 'رمز الأمان غير صالح' : 'Security code is invalid';
    }
    return next;
  }, [ar, brand, cardDigits, cardName, cvc, expiry]);

  const maskedPreview =
    cardDigits.length === 0
      ? '•••• •••• •••• ••••'
      : formatCardNumber(cardDigits.padEnd(Math.max(16, cardDigits.length), '•'));

  async function complete() {
    setTouched(true);
    setMessage(null);
    if (Object.keys(errors).length > 0) {
      setMessage(ar ? 'تحقق من بيانات البطاقة' : 'Check your card details');
      return;
    }
    setBusy(true);
    try {
      // Realistic processing pause — card fields never leave the browser.
      await new Promise((resolve) => setTimeout(resolve, 900));
      const result = stayKind
        ? await completeStaySandboxPayment(sessionReference, returnPath)
        : await browserPublicMutation<{
            completed: boolean;
            returnPath: string | null;
            kind?: string;
          }>(`/v1/public/payment-sessions/${encodeURIComponent(sessionReference)}/sandbox-complete`, {
            ...(returnPath ? { returnPath } : {}),
          });
      const target = result.returnPath ?? returnPath ?? null;
      if (
        target &&
        (target.startsWith(`/${locale}/invoice/`) ||
          target.startsWith(`/${locale}/guest/stays`) ||
          target.startsWith(`/${locale}/stays/`))
      ) {
        window.location.assign(target);
        return;
      }
      setMessage(
        result.kind === 'stay_booking'
          ? ar
            ? 'تم الدفع بنجاح. جارٍ التحويل…'
            : 'Payment successful. Redirecting…'
          : ar
            ? 'تم الدفع بنجاح.'
            : 'Payment completed successfully.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'payment_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pay-gateway">
      <div className="pay-gateway__card-visual" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="pay-gateway__card-landmark"
          src="/brand/oman-landmark-mosque.jpg"
          alt=""
        />
        <div className="pay-gateway__card-scrim" />
        <div className="pay-gateway__card-top">
          <span className="pay-gateway__card-logo logo__product logo__product--on-dark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bhd-official-symbol.svg" alt="" width="72" height="23" />
            <i>R</i>
          </span>
          <p className="pay-gateway__card-brand">
            {brand === 'visa'
              ? 'VISA'
              : brand === 'mastercard'
                ? 'Mastercard'
                : brand === 'amex'
                  ? 'AMEX'
                  : 'CARD'}
          </p>
        </div>
        <div className="pay-gateway__card-chip" />
        <p className="pay-gateway__card-number" dir="ltr">
          {maskedPreview}
        </p>
        <div className="pay-gateway__card-meta">
          <span>{cardName.trim() || (ar ? 'اسم حامل البطاقة' : 'CARDHOLDER')}</span>
          <span dir="ltr">{expiry || 'MM/YY'}</span>
        </div>
        <p className="pay-gateway__card-place">
          {ar ? 'جامع السلطان قابوس · مسقط' : 'Sultan Qaboos Grand Mosque · Muscat'}
        </p>
      </div>

      <form
        className="pay-gateway__form"
        onSubmit={(event) => {
          event.preventDefault();
          void complete();
        }}
        autoComplete="off"
        noValidate
      >
        <div className="field">
          <label htmlFor="pay-card-name">{ar ? 'الاسم على البطاقة' : 'Name on card'}</label>
          <input
            id="pay-card-name"
            className="input"
            name="cc-name"
            autoComplete="cc-name"
            value={cardName}
            onChange={(event) => setCardName(event.target.value)}
            placeholder={ar ? 'كما هو مطبوع على البطاقة' : 'As printed on the card'}
            disabled={busy}
          />
          {touched && errors.name ? (
            <p className="field__error" role="alert">
              {errors.name}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="pay-card-number">{ar ? 'رقم البطاقة' : 'Card number'}</label>
          <input
            id="pay-card-number"
            className="input"
            name="cc-number"
            inputMode="numeric"
            autoComplete="cc-number"
            dir="ltr"
            value={cardNumber}
            onChange={(event) => setCardNumber(formatCardNumber(event.target.value))}
            placeholder="4242 4242 4242 4242"
            disabled={busy}
            maxLength={23}
          />
          {touched && errors.number ? (
            <p className="field__error" role="alert">
              {errors.number}
            </p>
          ) : null}
        </div>

        <div className="pay-gateway__row">
          <div className="field">
            <label htmlFor="pay-card-expiry">{ar ? 'الانتهاء' : 'Expiry'}</label>
            <input
              id="pay-card-expiry"
              className="input"
              name="cc-exp"
              inputMode="numeric"
              autoComplete="cc-exp"
              dir="ltr"
              value={expiry}
              onChange={(event) => setExpiry(formatExpiry(event.target.value))}
              placeholder="MM/YY"
              disabled={busy}
              maxLength={5}
            />
            {touched && errors.expiry ? (
              <p className="field__error" role="alert">
                {errors.expiry}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="pay-card-cvc">{ar ? 'رمز الأمان' : 'CVC'}</label>
            <input
              id="pay-card-cvc"
              className="input"
              name="cc-csc"
              inputMode="numeric"
              autoComplete="cc-csc"
              dir="ltr"
              value={cvc}
              onChange={(event) => setCvc(digitsOnly(event.target.value).slice(0, 4))}
              placeholder={brand === 'amex' ? '1234' : '123'}
              disabled={busy}
              maxLength={4}
            />
            {touched && errors.cvc ? (
              <p className="field__error" role="alert">
                {errors.cvc}
              </p>
            ) : null}
          </div>
        </div>

        <button type="submit" className="button button--primary pay-gateway__pay" disabled={busy}>
          {busy
            ? ar
              ? 'جارٍ معالجة الدفع…'
              : 'Processing payment…'
            : amountLabel
              ? ar
                ? `ادفع ${amountLabel}`
                : `Pay ${amountLabel}`
              : ar
                ? 'ادفع الآن'
                : 'Pay now'}
        </button>

        <p className="pay-gateway__secure muted">
          {ar
            ? 'اتصال آمن · بيانات البطاقة لا تُرسل إلى خوادم BHD في هذا الوضع التجريبي.'
            : 'Secure connection · Card details are not sent to BHD servers in this pilot mode.'}
        </p>
        {referenceCode ? (
          <p className="pay-gateway__ref muted" dir="ltr">
            Ref {referenceCode}
          </p>
        ) : null}
        {message ? (
          <p className="notice notice--info" role="status">
            {message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
