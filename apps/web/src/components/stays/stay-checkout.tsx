'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { TermsAcceptance } from '@/components/terms-acceptance';
import { Link } from '@/i18n/navigation';
import {
  ApiError,
  browserStayBookingGet,
  browserStayBookingMutation,
  fetchBrowserCsrfToken,
  humanizeBrowserError,
} from '@/lib/api';
import type { BookingContactsForViewer, BookingFor } from '@/lib/booking-contacts-neon';
import { bookingTermsDocument, type BookingTermsForCheckout } from '@/lib/booking-terms';
import { formatMoney } from '@/lib/format';
import { rememberStayTripAlert } from '@/lib/stay-trip-alerts';
import {
  isStayEsignRequiredClient,
  stayConfirmedReturnPath,
  stayEsignReturnPath,
} from '@/lib/stay-esign-flags';
import {
  exclusiveCheckOutOn,
  isSameCalendarDayStay,
  isValidGuestPhone,
  stayDatesValid,
  type StayBookingType,
} from '@/lib/stay-booking-dates';
import { stayStatusLabel } from '@/lib/ui-labels';

type ContactForm = { fullName: string; phone: string; email: string };

const EMPTY_OTHER: ContactForm = { fullName: '', phone: '', email: '' };
const NEW_CONTACT = 'new';

async function saveBookingContactBestEffort(body: Record<string, unknown>): Promise<void> {
  const send = async (csrf: string) =>
    fetch('/api/public/booking-contacts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  try {
    const response = await send(await fetchBrowserCsrfToken());
    if (response.status === 403) await send(await fetchBrowserCsrfToken(true));
  } catch {
    // Saving the contact must never block the booking.
  }
}

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

type StayType = StayBookingType;

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
  if (type === 'day_use') return ar ? 'إقامة بدون مبيت (صباحي ~11–16)' : 'Day use (morning ~11–16)';
  if (type === 'overnight_only') return ar ? 'مبيت فقط (مسائي)' : 'Overnight only (evening)';
  return ar ? 'إقامة مع مبيت (يوم كامل)' : 'Stay with overnight (full day)';
}

export function StayCheckout({
  locale,
  slug,
  title,
  defaults,
  embedded = false,
  bookingDates,
  unitId,
  terms,
  contacts = null,
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
  /** Owner daily-rental terms; null shows the platform defaults. */
  terms?: BookingTermsForCheckout | null;
  /** Signed-in booker's own details and saved people; null for anonymous guests. */
  contacts?: BookingContactsForViewer | null;
}) {
  const router = useRouter();
  const ar = locale === 'ar';
  const termsRef = terms?.ref ?? 'default';
  const termsBlocks = bookingTermsDocument({ mode: 'daily', blocks: terms?.blocks ?? null });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const initialIn = defaults?.checkInOn || defaultCheckIn();
  const [step, setStep] = useState<Step>('stay');
  const [checkInOn, setCheckInOn] = useState(initialIn);
  const [checkOutOn, setCheckOutOn] = useState(defaults?.checkOutOn || defaultCheckOut(initialIn));
  const [adults, setAdults] = useState(defaults?.adults ?? '2');
  const [children, setChildren] = useState(defaults?.children ?? '0');
  const [stayType, setStayType] = useState<StayType>(defaults?.stayType ?? 'overnight_stay');
  const [selfName, setSelfName] = useState(defaults?.guestName ?? contacts?.self.fullName ?? '');
  const [selfPhone, setSelfPhone] = useState(defaults?.guestPhone ?? contacts?.self.phone ?? '');
  const [selfEmail, setSelfEmail] = useState(defaults?.guestEmail ?? contacts?.self.email ?? '');
  const [bookingFor, setBookingFor] = useState<BookingFor>('self');
  const [otherForm, setOtherForm] = useState<ContactForm>(EMPTY_OTHER);
  const [savedContactId, setSavedContactId] = useState<string>(NEW_CONTACT);
  const [saveContact, setSaveContact] = useState(true);
  const forSelf = bookingFor === 'self';
  const guestName = forSelf ? selfName : otherForm.fullName;
  const guestPhone = forSelf ? selfPhone : otherForm.phone;
  const guestEmail = forSelf ? selfEmail : otherForm.email;
  const savedContacts = contacts?.saved ?? [];
  const selectedSaved = savedContacts.find((row) => row.id === savedContactId) ?? null;
  const contactChanged = forSelf
    ? selfPhone.trim() !== (contacts?.self.phone ?? '').trim()
    : !selectedSaved ||
      otherForm.fullName.trim() !== selectedSaved.fullName.trim() ||
      otherForm.phone.trim() !== (selectedSaved.phone ?? '').trim() ||
      otherForm.email.trim() !== (selectedSaved.email ?? '').trim();
  const offerSave = Boolean(contacts?.canSave) && contactChanged;
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [booking, setBooking] = useState<BookingResult | null>(null);
  const [stepHint, setStepHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!bookingDates) return;
    setCheckInOn(bookingDates.checkInOn);
    setCheckOutOn(bookingDates.checkOutOn);
  }, [bookingDates?.checkInOn, bookingDates?.checkOutOn]);

  useEffect(() => {
    if (!isSameCalendarDayStay(stayType)) return;
    if (checkOutOn !== checkInOn) setCheckOutOn(checkInOn);
  }, [stayType, checkInOn, checkOutOn]);

  const apiCheckOutOn = exclusiveCheckOutOn(stayType, checkInOn, checkOutOn);

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
        if (me.displayName?.trim()) setSelfName((prev) => prev || me.displayName!.trim());
        if (me.email?.trim()) setSelfEmail((prev) => prev || me.email!.trim());
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
    const qs = new URLSearchParams({
      checkInOn,
      checkOutOn: apiCheckOutOn,
      adults,
      children,
      stayType,
    });
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
            : availability.reason === 'slot_taken' || availability.reason === 'dates_unavailable'
              ? ar
                ? `نفد الحجز لهذا اليوم (${checkInOn}). حاول اختيار يوم أو فترة أخرى.`
                : `This day is taken (${checkInOn}). Try another day or slot.`
              : ar
                ? 'التواريخ غير متاحة — جرّب تواريخاً أخرى'
                : 'Dates not available — try different dates',
      );
    }
    return browserStayBookingMutation<QuoteResult>(
      `/${encodeURIComponent(slug)}/quotes${unitId ? `?unitId=${encodeURIComponent(unitId)}` : ''}`,
      {
        checkInOn,
        checkOutOn: apiCheckOutOn,
        adults: Number(adults),
        children: Number(children),
        stayType,
        ...(unitId ? { unitId } : {}),
      },
    );
  }

  function continueFromStay() {
    setError(null);
    if (!stayDatesValid(stayType, checkInOn, checkOutOn)) {
      setError(
        isSameCalendarDayStay(stayType)
          ? ar
            ? 'اختر تاريخ الإقامة (نفس اليوم مسموح بدون مبيت / مبيت فقط)'
            : 'Pick a stay date (same day is allowed for day use / overnight only)'
          : ar
            ? 'تحقق من التواريخ — المغادرة يجب أن تكون بعد الوصول'
            : 'Check your dates — check-out must be after check-in',
      );
      return;
    }
    setStep('guest');
  }

  function updateGuest(patch: Partial<ContactForm>) {
    setError(null);
    if (forSelf) {
      if (patch.fullName !== undefined) setSelfName(patch.fullName);
      if (patch.phone !== undefined) setSelfPhone(patch.phone);
      if (patch.email !== undefined) setSelfEmail(patch.email);
    } else {
      setOtherForm((current) => ({ ...current, ...patch }));
    }
  }

  function chooseBookingFor(next: BookingFor) {
    setError(null);
    setBookingFor(next);
    setSaveContact(next === 'self');
  }

  function chooseSavedContact(id: string) {
    setError(null);
    setSavedContactId(id);
    const row = savedContacts.find((item) => item.id === id);
    setOtherForm(
      row
        ? { fullName: row.fullName, phone: row.phone ?? '', email: row.email ?? '' }
        : EMPTY_OTHER,
    );
    setSaveContact(false);
  }

  function continueFromGuest() {
    setError(null);
    if (!guestName.trim() || guestName.trim().length < 2) {
      setError(
        ar ? 'أدخل اسم الضيف (حرفان على الأقل)' : 'Enter guest name (at least 2 characters)',
      );
      return;
    }
    if (!isValidGuestPhone(guestPhone)) {
      setError(
        ar
          ? 'رقم الهاتف إلزامي (٨–١٥ رقماً) — سيُستخدم لاحقاً لتأكيد واتساب'
          : 'Phone is required (8–15 digits) — used later for WhatsApp confirmation',
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
    const returnPath = isStayEsignRequiredClient()
      ? stayEsignReturnPath(locale, nextBooking.referenceCode)
      : stayConfirmedReturnPath(locale, nextBooking.referenceCode);
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

  function openConfirmModal() {
    if (!quote) return;
    if (!termsAccepted) {
      setError(
        ar
          ? 'اقرأ الشروط والأحكام حتى النهاية ووافق عليها للمتابعة.'
          : 'Read the terms to the end and accept them to continue.',
      );
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  function confirmBooking() {
    if (!quote) return;
    setConfirmOpen(false);
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
            guestPhone: guestPhone.trim(),
            ...(guestEmail.trim() ? { guestEmail: guestEmail.trim() } : {}),
            ...(contacts ? { bookingFor } : {}),
            termsRef,
          },
          { idempotencyKey: bookKey },
        );
        setBooking(nextBooking);
        if (offerSave && saveContact) {
          await saveBookingContactBestEffort({
            bookingFor,
            fullName: guestName.trim(),
            phone: guestPhone.trim(),
            email: guestEmail.trim(),
            ...(!forSelf && selectedSaved ? { savedContactId: selectedSaved.id } : {}),
          });
        }
        rememberStayTripAlert({
          id: nextBooking.bookingId,
          referenceCode: nextBooking.referenceCode,
          status: nextBooking.status,
          checkInOn,
          checkOutOn: apiCheckOutOn,
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
        if (caught instanceof ApiError && caught.code === 'terms_changed') {
          setTermsAccepted(false);
          router.refresh();
          setError(
            ar
              ? 'حدّث المالك الشروط والأحكام — راجعها حتى النهاية ووافق عليها مجدداً.'
              : 'The owner updated the terms — read them to the end and accept again.',
          );
          return;
        }
        if (caught instanceof ApiError && caught.status === 404) {
          setError(ar ? 'مسار الإقامات غير مفعّل حالياً.' : 'Stays booking is not enabled yet.');
          return;
        }
        if (caught instanceof ApiError && caught.status === 409) {
          setError(
            ar
              ? `نفد الحجز لهذا اليوم (${checkInOn}). يرجى اختيار يوم آخر.`
              : `This day is taken (${checkInOn}). Please choose another day.`,
          );
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
                <label htmlFor="stay-book-in">
                  {isSameCalendarDayStay(stayType)
                    ? ar
                      ? 'تاريخ الإقامة'
                      : 'Stay date'
                    : ar
                      ? 'الوصول'
                      : 'Check-in'}
                </label>
                <input
                  className="input"
                  id="stay-book-in"
                  type="date"
                  required
                  value={checkInOn}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCheckInOn(next);
                    if (isSameCalendarDayStay(stayType)) setCheckOutOn(next);
                  }}
                />
              </div>
              {!isSameCalendarDayStay(stayType) ? (
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
              ) : (
                <div className="field stays-checkout__tone stays-checkout__tone--check-out">
                  <label>{ar ? 'الفترة' : 'Period'}</label>
                  <p className="stays-checkout__period-note" dir="ltr">
                    {stayType === 'day_use'
                      ? ar
                        ? 'صباحي تقريباً 11:00–16:00 · نفس اليوم'
                        : 'Morning ≈ 11:00–16:00 · same day'
                      : ar
                        ? 'مسائي / مبيت · نفس اليوم'
                        : 'Evening / overnight · same day'}
                  </p>
                </div>
              )}
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
          <h3>{ar ? 'بياناتك' : 'Your details'}</h3>
          {contacts ? (
            <>
              <p className="lease-checkout__question" id="stay-book-for-label">
                {ar ? 'هل الحجز لك؟' : 'Is this booking for you?'}
              </p>
              <div
                className="lease-checkout__modes"
                role="radiogroup"
                aria-labelledby="stay-book-for-label"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={forSelf}
                  className={`button ${forSelf ? 'button--primary' : 'button--quiet'}`}
                  onClick={() => chooseBookingFor('self')}
                >
                  {ar ? 'نعم، الحجز لي' : 'Yes, for me'}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!forSelf}
                  className={`button ${!forSelf ? 'button--primary' : 'button--quiet'}`}
                  onClick={() => chooseBookingFor('other')}
                >
                  {ar ? 'لا، لشخص آخر' : 'No, for someone else'}
                </button>
              </div>
            </>
          ) : null}

          {forSelf ? (
            <p className="muted stays-checkout__hint">
              {contacts
                ? ar
                  ? 'جلبنا بياناتك من ملفك — راجعها وأكمل ما ينقص قبل المتابعة.'
                  : 'We loaded your details from your profile — review them and fill anything missing.'
                : ar
                  ? 'أدخل بيانات الضيف الذي سيتم الحجز باسمه.'
                  : 'Enter the details of the guest the booking is for.'}
            </p>
          ) : savedContacts.length ? (
            <div className="field">
              <label htmlFor="stay-book-saved">
                {ar ? 'اختر من الأشخاص المحفوظين في ملفك' : 'Choose a saved person'}
              </label>
              <select
                className="select"
                id="stay-book-saved"
                value={savedContactId}
                onChange={(event) => chooseSavedContact(event.target.value)}
              >
                <option value={NEW_CONTACT}>{ar ? '+ شخص جديد' : '+ New person'}</option>
                {savedContacts.map((row) => (
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
              <label htmlFor="stay-book-name">
                {forSelf
                  ? ar
                    ? 'الاسم الكامل'
                    : 'Full name'
                  : ar
                    ? 'اسم الضيف الكامل'
                    : "Guest's full name"}
              </label>
              <input
                className="input"
                id="stay-book-name"
                type="text"
                required
                minLength={2}
                maxLength={160}
                value={guestName}
                onChange={(event) => updateGuest({ fullName: event.target.value })}
                autoComplete={forSelf ? 'name' : 'off'}
              />
            </div>
            <div className="field">
              <label htmlFor="stay-book-phone">{ar ? 'الهاتف (إلزامي)' : 'Phone (required)'}</label>
              <input
                className="input"
                id="stay-book-phone"
                type="tel"
                required
                value={guestPhone}
                onChange={(event) => updateGuest({ phone: event.target.value })}
                autoComplete={forSelf ? 'tel' : 'off'}
                dir="ltr"
                placeholder={ar ? 'مثال: 9689xxxxxxx' : 'e.g. 9689xxxxxxx'}
              />
              <p className="muted stays-checkout__hint">
                {ar
                  ? 'سيُستخدم لاحقاً لتأكيد واتساب / OTP.'
                  : 'Used later for WhatsApp / OTP confirmation.'}
              </p>
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
                onChange={(event) => updateGuest({ email: event.target.value })}
                autoComplete={forSelf ? 'email' : 'off'}
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
                {forSelf
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
            {contacts ? (
              <div>
                <dt>{ar ? 'الحجز لـ' : 'Booking for'}</dt>
                <dd>{forSelf ? (ar ? 'لي شخصيًا' : 'Myself') : ar ? 'شخص آخر' : 'Someone else'}</dd>
              </div>
            ) : null}
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
              ? 'شامل الرسوم والضريبة حسب العرض. يجب دفع الحجز فوراً ليُعتبر مؤكّداً.'
              : 'Includes fees and tax per quote. Payment is required immediately for confirmation.'}
          </p>
          <h4 className="stays-checkout__terms-title">
            {ar ? 'الشروط والأحكام' : 'Terms & conditions'}
          </h4>
          <TermsAcceptance
            ar={ar}
            blocks={termsBlocks}
            letterhead={terms?.letterhead ?? null}
            printTitle={{
              ar: 'الشروط والأحكام — الإيجار اليومي',
              en: 'Terms & conditions — daily rental',
            }}
            accepted={termsAccepted}
            onAcceptedChange={setTermsAccepted}
            resetKey={`daily:${termsRef}`}
            id="stay-booking-terms"
          />
          <div className="stays-checkout__nav">
            <button type="button" className="button button--quiet" onClick={() => setStep('guest')}>
              {ar ? 'رجوع' : 'Back'}
            </button>
            {!quote && !pending ? (
              <button type="button" className="button button--primary" onClick={continueFromGuest}>
                {ar ? 'إعادة المحاولة' : 'Retry'}
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary"
                disabled={pending || !quote || payBusy || !termsAccepted}
                onClick={openConfirmModal}
              >
                {pending || payBusy
                  ? ar
                    ? 'جارٍ الحجز والدفع…'
                    : 'Booking & paying…'
                  : ar
                    ? 'تأكيد الحجز'
                    : 'Confirm booking'}
              </button>
            )}
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

      {confirmOpen ? (
        <div
          className="stays-checkout__modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stay-pay-confirm-title"
        >
          <div className="stays-checkout__modal-card">
            <h3 id="stay-pay-confirm-title">
              {ar ? 'تأكيد الدفع مطلوب' : 'Payment required to confirm'}
            </h3>
            <p>
              {ar
                ? 'للحفاظ على التواريخ، يجب دفع الحجز مباشرة. يُعتبر الحجز مؤكّداً فقط بعد إتمام الدفع بنجاح. بالموافقة ستُفتح بوابة الدفع الآمنة.'
                : 'To keep these dates, you must pay now. The booking is confirmed only after successful payment. Agreeing opens the secure payment gateway.'}
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
                onClick={confirmBooking}
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
