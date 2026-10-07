'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { TermsAcceptance } from '@/components/terms-acceptance';
import { ApiError, fetchBrowserCsrfToken, humanizeBrowserError } from '@/lib/api';
import type { BookingContactsForViewer, BookingFor } from '@/lib/booking-contacts-neon';
import { bookingTermsDocument, type BookingTermsForCheckout } from '@/lib/booking-terms';
import { formatMoney } from '@/lib/format';
import { isValidGuestPhone } from '@/lib/stay-booking-dates';

type Mode = 'rent' | 'sale';
type Step = 'terms' | 'details' | 'review' | 'payment';
type ContactForm = { fullName: string; phone: string; email: string };

const EMPTY_CONTACT: ContactForm = { fullName: '', phone: '', email: '' };
const NEW_CONTACT = 'new';

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
    (CheckoutResult & { error?: { code?: string; message?: string; messageAr?: string } }) | null;
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
  termsByMode,
  contacts,
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
  termsByMode: Partial<Record<Mode, BookingTermsForCheckout>>;
  contacts: BookingContactsForViewer;
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const [step, setStep] = useState<Step>('terms');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [accepted, setAccepted] = useState(false);
  const [bookingFor, setBookingFor] = useState<BookingFor>('self');
  const [selfForm, setSelfForm] = useState<ContactForm>({
    fullName: contacts.self.fullName,
    phone: contacts.self.phone ?? '',
    email: contacts.self.email ?? '',
  });
  const [otherForm, setOtherForm] = useState<ContactForm>(EMPTY_CONTACT);
  const [savedContactId, setSavedContactId] = useState<string>(NEW_CONTACT);
  const [saveContact, setSaveContact] = useState(true);
  const form = bookingFor === 'self' ? selfForm : otherForm;
  const { fullName, phone, email } = form;
  const selectedSaved = contacts.saved.find((row) => row.id === savedContactId) ?? null;
  const formChanged =
    bookingFor === 'self'
      ? phone.trim() !== (contacts.self.phone ?? '').trim()
      : !selectedSaved ||
        fullName.trim() !== selectedSaved.fullName.trim() ||
        phone.trim() !== (selectedSaved.phone ?? '').trim() ||
        email.trim() !== (selectedSaved.email ?? '').trim();
  const offerSave = contacts.canSave && formChanged;
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
  const modeTerms = termsByMode[mode] ?? null;
  const termsRef = modeTerms?.ref ?? 'default';
  const termsBlocks = bookingTermsDocument({
    mode,
    depositAr: formatMoney(depositMinor, currency, 'ar'),
    depositEn: formatMoney(depositMinor, currency, 'en'),
    blocks: modeTerms?.blocks ?? null,
  });
  const modeLabel =
    mode === 'sale'
      ? ar
        ? 'حجز للشراء'
        : 'Reserve to buy'
      : ar
        ? 'حجز للإيجار'
        : 'Reserve to rent';
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

  function updateForm(patch: Partial<ContactForm>) {
    setError(null);
    if (bookingFor === 'self') setSelfForm((current) => ({ ...current, ...patch }));
    else setOtherForm((current) => ({ ...current, ...patch }));
  }

  function chooseBookingFor(next: BookingFor) {
    setError(null);
    setBookingFor(next);
    setSaveContact(next === 'self');
  }

  function chooseSavedContact(id: string) {
    setError(null);
    setSavedContactId(id);
    const row = contacts.saved.find((item) => item.id === id);
    setOtherForm(
      row
        ? { fullName: row.fullName, phone: row.phone ?? '', email: row.email ?? '' }
        : EMPTY_CONTACT,
    );
    setSaveContact(false);
  }

  function continueFromDetails() {
    if (fullName.trim().length < 2) {
      setError(
        ar ? 'أدخل الاسم الكامل (حرفان على الأقل)' : 'Enter your full name (at least 2 characters)',
      );
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
          termsRef,
          bookingFor,
          saveContact: offerSave && saveContact,
          ...(bookingFor === 'other' && selectedSaved ? { savedContactId: selectedSaved.id } : {}),
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
        if (caught instanceof ApiError && caught.code === 'terms_changed') {
          setAccepted(false);
          setStep('terms');
          router.refresh();
          setError(
            ar
              ? 'حدّث المالك الشروط والأحكام — راجعها حتى النهاية ووافق عليها مجدداً.'
              : 'The owner updated the terms — read them to the end and accept again.',
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
          <TermsAcceptance
            ar={ar}
            blocks={termsBlocks}
            letterhead={modeTerms?.letterhead ?? null}
            printTitle={
              mode === 'sale'
                ? {
                    ar: 'الشروط والأحكام — حجز للشراء',
                    en: 'Terms & conditions — purchase reservation',
                  }
                : {
                    ar: 'الشروط والأحكام — حجز للإيجار',
                    en: 'Terms & conditions — rental reservation',
                  }
            }
            accepted={accepted}
            onAcceptedChange={setAccepted}
            resetKey={`${mode}:${termsRef}`}
            id="lease-booking-terms"
          />
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
          <p className="lease-checkout__question" id="lease-book-for-label">
            {ar ? 'هل الحجز لك؟' : 'Is this booking for you?'}
          </p>
          <div
            className="lease-checkout__modes"
            role="radiogroup"
            aria-labelledby="lease-book-for-label"
          >
            <button
              type="button"
              role="radio"
              aria-checked={bookingFor === 'self'}
              className={`button ${bookingFor === 'self' ? 'button--primary' : 'button--quiet'}`}
              onClick={() => chooseBookingFor('self')}
            >
              {ar ? 'نعم، الحجز لي' : 'Yes, for me'}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={bookingFor === 'other'}
              className={`button ${bookingFor === 'other' ? 'button--primary' : 'button--quiet'}`}
              onClick={() => chooseBookingFor('other')}
            >
              {ar ? 'لا، لشخص آخر' : 'No, for someone else'}
            </button>
          </div>

          {bookingFor === 'self' ? (
            <p className="muted stays-checkout__hint">
              {ar
                ? 'جلبنا بياناتك من ملفك — راجعها وأكمل ما ينقص قبل المتابعة.'
                : 'We loaded your details from your profile — review them and fill anything missing.'}
            </p>
          ) : contacts.saved.length ? (
            <div className="field">
              <label htmlFor="lease-book-saved">
                {ar ? 'اختر من الأشخاص المحفوظين في ملفك' : 'Choose a saved person'}
              </label>
              <select
                className="select"
                id="lease-book-saved"
                value={savedContactId}
                onChange={(event) => chooseSavedContact(event.target.value)}
              >
                <option value={NEW_CONTACT}>{ar ? '+ شخص جديد' : '+ New person'}</option>
                {contacts.saved.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.fullName}
                    {row.phone ? ` — ${row.phone}` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="muted stays-checkout__hint">
              {ar
                ? 'أدخل بيانات الشخص الذي سيتم الحجز باسمه.'
                : 'Enter the details of the person the booking is for.'}
            </p>
          )}

          <div className="stays-checkout__grid">
            <div className="field stays-checkout__name">
              <label htmlFor="lease-book-name">
                {bookingFor === 'self'
                  ? ar
                    ? 'الاسم الكامل (كما في البطاقة)'
                    : 'Full name (as on ID)'
                  : ar
                    ? 'اسم الشخص الكامل (كما في البطاقة)'
                    : 'Their full name (as on ID)'}
              </label>
              <input
                className="input"
                id="lease-book-name"
                type="text"
                required
                minLength={2}
                maxLength={160}
                value={fullName}
                onChange={(event) => updateForm({ fullName: event.target.value })}
                autoComplete={bookingFor === 'self' ? 'name' : 'off'}
              />
            </div>
            <div className="field">
              <label htmlFor="lease-book-phone">
                {ar ? 'الهاتف (إلزامي)' : 'Phone (required)'}
              </label>
              <input
                className="input"
                id="lease-book-phone"
                type="tel"
                required
                value={phone}
                onChange={(event) => updateForm({ phone: event.target.value })}
                autoComplete={bookingFor === 'self' ? 'tel' : 'off'}
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
                onChange={(event) => updateForm({ email: event.target.value })}
                autoComplete={bookingFor === 'self' ? 'email' : 'off'}
                dir="ltr"
              />
            </div>
          </div>

          {offerSave ? (
            <label className="checkbox-row lease-checkout__accept">
              <input
                type="checkbox"
                checked={saveContact}
                onChange={(event) => setSaveContact(event.target.checked)}
              />
              <span>
                {bookingFor === 'self'
                  ? ar
                    ? 'حفظ رقم هاتفي في ملفي لاستخدامه في الحجوزات القادمة'
                    : 'Save my phone number to my profile for future bookings'
                  : selectedSaved
                    ? ar
                      ? 'تحديث بيانات هذا الشخص المحفوظة في ملفي'
                      : 'Update this saved person in my profile'
                    : ar
                      ? 'حفظ بيانات هذا الشخص في ملفي لحجز آخر'
                      : 'Save this person to my profile for another booking'}
              </span>
            </label>
          ) : null}
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
              <dt>{ar ? 'الحجز لـ' : 'Booking for'}</dt>
              <dd>
                {bookingFor === 'self'
                  ? ar
                    ? 'لي شخصياً'
                    : 'Myself'
                  : ar
                    ? 'شخص آخر'
                    : 'Someone else'}
              </dd>
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
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setStep('details')}
            >
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
