'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { BookingStepScene } from '@/components/stays/booking-step-scene';
import { GuestCountField, isValidGuestCount } from '@/components/stays/guest-count-field';
import { StayAvailabilityCalendar } from '@/components/stays/stay-availability-calendar';
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
import { greetingName, stayCheckoutGreeting } from '@/lib/booking-step-greeting';
import { bookingTermsDocument, type BookingTermsForCheckout } from '@/lib/booking-terms';
import { formatMoney } from '@/lib/format';
import { rememberStayTripAlert } from '@/lib/stay-trip-alerts';
import {
  isStayEsignRequiredClient,
  stayConfirmedReturnPath,
  stayEsignReturnPath,
} from '@/lib/stay-esign-flags';
import {
  addUtcDays,
  exclusiveCheckOutOn,
  isIsoDate,
  isSameCalendarDayStay,
  isValidGuestPhone,
  nightsBetween,
  stayDatesValid,
  stayTodayInOman,
  type StayBookingType,
} from '@/lib/stay-booking-dates';
import { formatStayDateTime, resolveStayPeriodTimes } from '@/lib/stay-period-times';
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

type StayEstimate = {
  nights: number;
  currency: string;
  rateMinor: string;
  subtotalMinor: string;
  feesMinor: string;
  totalMinor: string;
};

type AvailabilityResult = {
  available: boolean;
  reason?: string;
  nights?: number;
  maxGuests?: number;
  minNights?: number;
  maxNights?: number;
  estimate?: StayEstimate | null;
};

type EstimateState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; result: AvailabilityResult; refreshing?: boolean }
  | { status: 'error' };

/** Prices are re-checked when the quote is created, so a short-lived browser cache is safe. */
const ESTIMATE_CACHE_MS = 60_000;

type AvailabilityParams = {
  checkInOn: string;
  checkOutOn: string;
  adults: string;
  children: string;
  stayType: StayBookingType;
};

function availabilityPathFor(slug: string, unitId: string | undefined, p: AvailabilityParams) {
  const qs = new URLSearchParams({
    checkInOn: p.checkInOn,
    checkOutOn: p.checkOutOn,
    adults: p.adults,
    children: p.children,
    stayType: p.stayType,
  });
  if (unitId) qs.set('unitId', unitId);
  return `/${encodeURIComponent(slug)}/availability?${qs.toString()}`;
}

type StayType = StayBookingType;

type Step = 'stay' | 'guest' | 'review' | 'payment';
/** Sub-slides inside the stay step (public book page): one choice at a time. */
type StaySlide = 'type' | 'dates' | 'guests';

const STAY_SLIDES: StaySlide[] = ['type', 'dates', 'guests'];

/** Arrival defaults to today (Oman); a past or malformed date from the link falls back to today. */
function initialCheckIn(requested: string | undefined, today: string): string {
  return isIsoDate(requested) && requested >= today ? requested : today;
}

/** Full-day stays default to one night (leave tomorrow); same-day types leave on arrival day. */
function initialCheckOut(
  requested: string | undefined,
  checkIn: string,
  stayType: StayBookingType,
): string {
  if (isSameCalendarDayStay(stayType)) return checkIn;
  return isIsoDate(requested) && requested > checkIn ? requested : addUtcDays(checkIn, 1);
}

const MAX_STAY_NIGHTS = 90;

function nightsLabel(nights: number, ar: boolean): string {
  if (!ar) return `${nights} ${nights === 1 ? 'night' : 'nights'}`;
  if (nights === 1) return 'ليلة واحدة';
  if (nights === 2) return 'ليلتان';
  return `${nights} ${nights <= 10 ? 'ليالٍ' : 'ليلة'}`;
}

function paymentErrorMessage(error: unknown, ar: boolean, canRetry: boolean): string {
  if (!(error instanceof ApiError)) return humanizeBrowserError(error, ar);
  const retry = canRetry
    ? ar
      ? ' يمكنك المحاولة من زر «ادفع الآن».'
      : ' Use Pay now to retry.'
    : '';
  switch (error.code) {
    case 'payment_gateway_inactive':
      return (
        (ar ? 'بوابة الدفع غير مفعّلة حالياً.' : 'The payment gateway is not active right now.') +
        retry
      );
    case 'booking_not_payable':
      return ar
        ? 'هذا الحجز لم يعد قابلاً للدفع (قد يكون أُلغي أو انتهت مهلته). ابدأ حجزاً جديداً.'
        : 'This booking can no longer be paid (it may be cancelled or expired). Start a new booking.';
    case 'already_paid':
      return ar ? 'تم دفع هذا الحجز مسبقاً.' : 'This booking is already paid.';
    case 'intent_not_payable':
      return ar
        ? 'انتهت صلاحية عملية الدفع لهذا الحجز. ابدأ حجزاً جديداً.'
        : 'The payment for this booking has expired. Start a new booking.';
    default:
      return humanizeBrowserError(error, ar) + retry;
  }
}

/** Public listing prices used to label the stay-type cards (the server quote stays authoritative). */
export type StayCheckoutOffer = {
  currency: string;
  nightlyMinor: string | null;
  dayUseMinor: string | null;
  overnightOnlyMinor: string | null;
  maxGuests: number | null;
  checkInFrom?: string | null;
  dayUseCheckInFrom?: string | null;
  dayUseCheckOutUntil?: string | null;
  overnightCheckOutUntil?: string | null;
  checkOutUntil?: string | null;
};

const STAY_TYPES: StayType[] = ['overnight_stay', 'day_use', 'overnight_only'];

function stayTypeTitle(type: StayType, ar: boolean): string {
  if (type === 'day_use') return ar ? 'بدون مبيت' : 'Day use';
  if (type === 'overnight_only') return ar ? 'مبيت فقط' : 'Overnight only';
  return ar ? 'يوم كامل مع مبيت' : 'Full stay';
}

function stayTypeHint(
  type: StayType,
  ar: boolean,
  times?: { checkInTime: string; checkOutTime: string },
): string {
  const clock =
    times != null ? ` · ${times.checkInTime} → ${times.checkOutTime}` : '';
  if (type === 'day_use') {
    return (ar ? 'فترة صباحية · نفس اليوم' : 'Morning slot · same day') + clock;
  }
  if (type === 'overnight_only') {
    return (ar ? 'فترة مسائية مع مبيت' : 'Evening slot with overnight') + clock;
  }
  return (ar ? 'يوم كامل · من الصباح حتى صباح المغادرة' : 'Full day · morning until next-day checkout') + clock;
}

function stayTypeUnit(type: StayType, ar: boolean): string {
  if (type === 'overnight_stay') return ar ? '/ الليلة' : '/ night';
  return ar ? '/ الفترة' : '/ slot';
}

function stayTypePrice(type: StayType, offer: StayCheckoutOffer): string | null {
  const value =
    type === 'day_use'
      ? offer.dayUseMinor
      : type === 'overnight_only'
        ? offer.overnightOnlyMinor
        : offer.nightlyMinor;
  return value && value !== '0' ? value : null;
}

function guestsLabelAr(n: number): string {
  if (n === 1) return 'ضيف واحد';
  if (n === 2) return 'ضيفين';
  return `${n} ${n <= 10 ? 'ضيوف' : 'ضيفاً'}`;
}

function StayTypeIcon({ type }: { type: StayType }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (type === 'day_use') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </svg>
    );
  }
  if (type === 'overnight_only') {
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" />
      <circle cx="7" cy="11" r="1.6" />
    </svg>
  );
}

function stayTypeLabel(type: StayType, ar: boolean): string {
  if (type === 'day_use') return ar ? 'إقامة بدون مبيت (صباحي ~11–16)' : 'Day use (morning ~11–16)';
  if (type === 'overnight_only') return ar ? 'مبيت فقط (مسائي)' : 'Overnight only (evening)';
  return ar ? 'إقامة مع مبيت (يوم كامل)' : 'Stay with overnight (full day)';
}

function StayEstimateCard({
  ar,
  locale,
  stayType,
  state,
  unavailableMessage,
}: {
  ar: boolean;
  locale: string;
  stayType: StayType;
  state: EstimateState;
  unavailableMessage: (result: AvailabilityResult) => string;
}) {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return (
      <div className="stays-estimate stays-estimate--loading" aria-live="polite">
        {ar ? 'جاري حساب مبلغ التأجير…' : 'Calculating the rental amount…'}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="stays-estimate stays-estimate--muted" aria-live="polite">
        {ar
          ? 'تعذر حساب المبلغ الآن — سيظهر في خطوة المراجعة.'
          : 'Could not calculate the amount now — it will show at review.'}
      </div>
    );
  }
  const { result } = state;
  const refreshing = state.refreshing === true;
  const estimate = result.estimate ?? null;
  const rateLabel =
    stayType === 'day_use'
      ? ar
        ? 'سعر الإقامة بدون مبيت'
        : 'Day-use price'
      : stayType === 'overnight_only'
        ? ar
          ? 'سعر المبيت فقط'
          : 'Overnight-only price'
        : ar
          ? 'سعر الليلة الأساسي'
          : 'Base nightly rate';
  const unitsLabel =
    stayType === 'overnight_stay'
      ? `${ar ? 'الإيجار' : 'Rent'} (${nightsLabel(estimate?.nights ?? 0, ar)})`
      : ar
        ? 'الإيجار (فترة واحدة)'
        : 'Rent (one slot)';
  return (
    <div
      className={[
        'stays-estimate',
        result.available ? '' : 'stays-estimate--unavailable',
        refreshing ? 'is-refreshing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-live="polite"
      aria-busy={refreshing}
    >
      {estimate ? (
        <dl className="stays-estimate__rows">
          <div>
            <dt>{rateLabel}</dt>
            <dd dir="ltr">{formatMoney(estimate.rateMinor, estimate.currency, locale)}</dd>
          </div>
          <div>
            <dt>{unitsLabel}</dt>
            <dd dir="ltr">{formatMoney(estimate.subtotalMinor, estimate.currency, locale)}</dd>
          </div>
          {estimate.feesMinor !== '0' ? (
            <div>
              <dt>{ar ? 'رسوم التنظيف' : 'Cleaning fee'}</dt>
              <dd dir="ltr">{formatMoney(estimate.feesMinor, estimate.currency, locale)}</dd>
            </div>
          ) : null}
          <div className="stays-estimate__total">
            <dt>{ar ? 'مبلغ التأجير الإجمالي' : 'Total rental amount'}</dt>
            <dd dir="ltr">
              <strong>{formatMoney(estimate.totalMinor, estimate.currency, locale)}</strong>
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="stays-estimate__status">
        {result.available
          ? ar
            ? '✓ متاح للحجز بهذه الاختيارات. المبلغ النهائي يُثبَّت في خطوة المراجعة.'
            : '✓ Available with these choices. The final amount is locked at review.'
          : `✗ ${unavailableMessage(result)}`}
      </p>
    </div>
  );
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
  offer = null,
}: {
  locale: string;
  slug: string;
  title?: string;
  offer?: StayCheckoutOffer | null;
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
  const [today] = useState(() => stayTodayInOman());
  const initialType: StayType = defaults?.stayType ?? 'overnight_stay';
  const initialIn = initialCheckIn(defaults?.checkInOn, today);
  const [step, setStep] = useState<Step>('stay');
  const [staySlide, setStaySlide] = useState<StaySlide>(() => {
    if (defaults?.stayType && defaults?.checkInOn) return 'guests';
    if (defaults?.stayType) return 'dates';
    return 'type';
  });
  const [staySlideDir, setStaySlideDir] = useState<'forward' | 'back'>('forward');
  const stayAdvanceTimer = useRef<number | undefined>(undefined);
  const [checkInOn, setCheckInOn] = useState(initialIn);
  const [checkOutOn, setCheckOutOn] = useState(() =>
    initialCheckOut(defaults?.checkOutOn, initialIn, initialType),
  );
  const [adults, setAdults] = useState(defaults?.adults ?? '2');
  const [children, setChildren] = useState(defaults?.children ?? '0');
  const [stayType, setStayType] = useState<StayType>(initialType);
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
  const [estimate, setEstimate] = useState<EstimateState>({ status: 'idle' });
  const estimateCache = useRef(new Map<string, { at: number; result: AvailabilityResult }>());
  const estimateInflight = useRef(new Map<string, Promise<AvailabilityResult>>());
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
    if (isSameCalendarDayStay(stayType)) {
      if (checkOutOn !== checkInOn) setCheckOutOn(checkInOn);
      return;
    }
    if (isIsoDate(checkInOn) && !(checkOutOn > checkInOn)) {
      setCheckOutOn(addUtcDays(checkInOn, 1));
    }
  }, [stayType, checkInOn, checkOutOn]);

  const stayNights = isSameCalendarDayStay(stayType) ? 0 : nightsBetween(checkInOn, checkOutOn);

  function changeCheckIn(next: string) {
    setCheckInOn(next);
    if (!isIsoDate(next)) return;
    if (isSameCalendarDayStay(stayType)) {
      setCheckOutOn(next);
      return;
    }
    if (!(checkOutOn > next)) setCheckOutOn(addUtcDays(next, Math.max(1, stayNights)));
  }

  function changeNights(delta: number) {
    if (!isIsoDate(checkInOn)) return;
    const next = Math.min(MAX_STAY_NIGHTS, Math.max(1, stayNights + delta));
    setCheckOutOn(addUtcDays(checkInOn, next));
  }

  const apiCheckOutOn = exclusiveCheckOutOn(stayType, checkInOn, checkOutOn);
  const periodTimes = resolveStayPeriodTimes(stayType, offer ?? {});
  const checkInLabel = formatStayDateTime(checkInOn, periodTimes.checkInTime);
  const checkOutLabel = formatStayDateTime(
    isSameCalendarDayStay(stayType) ? checkInOn : checkOutOn,
    periodTimes.checkOutTime,
  );

  useEffect(() => {
    setError(null);
  }, [step, staySlide]);

  useEffect(() => {
    return () => {
      if (stayAdvanceTimer.current !== undefined) window.clearTimeout(stayAdvanceTimer.current);
    };
  }, []);

  function goStaySlide(next: StaySlide, dir: 'forward' | 'back') {
    if (stayAdvanceTimer.current !== undefined) {
      window.clearTimeout(stayAdvanceTimer.current);
      stayAdvanceTimer.current = undefined;
    }
    setStaySlideDir(dir);
    setStaySlide(next);
    setError(null);
  }

  function scheduleStayAdvance(next: StaySlide, delayMs = 200) {
    if (stayAdvanceTimer.current !== undefined) window.clearTimeout(stayAdvanceTimer.current);
    stayAdvanceTimer.current = window.setTimeout(() => {
      stayAdvanceTimer.current = undefined;
      goStaySlide(next, 'forward');
    }, delayMs);
  }

  function pickStayType(type: StayType) {
    setStayType(type);
    if (embedded) return;
    scheduleStayAdvance('dates', 180);
  }

  function applyDateRange(nextIn: string, nextOut: string, halfDay?: StayType) {
    // Never auto-advance from the calendar — guest confirms with «Continue».
    if (halfDay) {
      setStayType(halfDay);
      setCheckInOn(nextIn);
      setCheckOutOn(nextIn);
      return;
    }
    setCheckInOn(nextIn);
    if (isSameCalendarDayStay(stayType)) {
      setCheckOutOn(nextIn);
      return;
    }
    if (nextOut > nextIn) {
      setCheckOutOn(nextOut);
      return;
    }
    setCheckOutOn(addUtcDays(nextIn, Math.max(1, stayNights || 1)));
  }

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

  function availabilityPath(): string {
    return availabilityPathFor(slug, unitId, {
      checkInOn,
      checkOutOn: apiCheckOutOn,
      adults,
      children,
      stayType,
    });
  }

  function cachedEstimate(path: string): AvailabilityResult | null {
    const hit = estimateCache.current.get(path);
    if (!hit) return null;
    if (Date.now() - hit.at > ESTIMATE_CACHE_MS) {
      estimateCache.current.delete(path);
      return null;
    }
    return hit.result;
  }

  /** One request per path: a click reuses the prefetch already in flight instead of starting over. */
  function fetchEstimate(path: string): Promise<AvailabilityResult> {
    const cached = cachedEstimate(path);
    if (cached) return Promise.resolve(cached);
    const inflight = estimateInflight.current.get(path);
    if (inflight) return inflight;
    const request = browserStayBookingGet<AvailabilityResult>(path)
      .then((result) => {
        estimateCache.current.set(path, { at: Date.now(), result });
        return result;
      })
      .finally(() => {
        estimateInflight.current.delete(path);
      });
    estimateInflight.current.set(path, request);
    return request;
  }

  /** Warm the cache for the next two nights and one night less so − / + update instantly. */
  function prefetchNeighbourNights() {
    if (stayType !== 'overnight_stay' || !isIsoDate(checkInOn)) return;
    for (const nights of [stayNights + 1, stayNights - 1, stayNights + 2]) {
      if (nights < 1 || nights > MAX_STAY_NIGHTS) continue;
      const path = availabilityPathFor(slug, unitId, {
        checkInOn,
        checkOutOn: addUtcDays(checkInOn, nights),
        adults,
        children,
        stayType,
      });
      void fetchEstimate(path).catch(() => undefined);
    }
  }

  function unavailableMessage(availability: AvailabilityResult): string {
    if (availability.reason === 'guests_exceed_max') {
      return availability.maxGuests
        ? ar
          ? `عدد الضيوف يتجاوز الحد الأقصى لهذه الإقامة (${availability.maxGuests}).`
          : `Guest count exceeds this stay's maximum (${availability.maxGuests}).`
        : ar
          ? 'عدد الضيوف يتجاوز الحد الأقصى'
          : 'Guest count exceeds the maximum';
    }
    if (availability.reason === 'nights_out_of_range') {
      return availability.minNights && availability.maxNights
        ? ar
          ? `مدة الإقامة يجب أن تكون بين ${availability.minNights} و${availability.maxNights} ليلة.`
          : `Stay length must be between ${availability.minNights} and ${availability.maxNights} nights.`
        : ar
          ? 'مدة الإقامة خارج النطاق المسموح'
          : 'Stay length is outside the allowed range';
    }
    if (availability.reason === 'slot_taken' || availability.reason === 'dates_unavailable') {
      return ar
        ? `نفد الحجز لهذا اليوم (${checkInOn}). حاول اختيار يوم أو فترة أخرى.`
        : `This day is taken (${checkInOn}). Try another day or slot.`;
    }
    return ar
      ? 'التواريخ غير متاحة — جرّب تواريخاً أخرى'
      : 'Dates not available — try different dates';
  }

  const guestsValid = isValidGuestCount(adults, 1) && isValidGuestCount(children, 0);
  const datesValid = stayDatesValid(stayType, checkInOn, checkOutOn);

  useEffect(() => {
    if (step !== 'stay' || !guestsValid || !datesValid) {
      setEstimate({ status: 'idle' });
      return;
    }
    const path = availabilityPath();
    const cached = cachedEstimate(path);
    if (cached) {
      setEstimate({ status: 'ready', result: cached });
      prefetchNeighbourNights();
      return;
    }
    let cancelled = false;
    setEstimate((current) =>
      current.status === 'ready' ? { ...current, refreshing: true } : { status: 'loading' },
    );
    const timer = window.setTimeout(
      () => {
        fetchEstimate(path)
          .then((result) => {
            if (cancelled) return;
            setEstimate({ status: 'ready', result });
            prefetchNeighbourNights();
          })
          .catch(() => {
            if (!cancelled) setEstimate({ status: 'error' });
          });
      },
      estimateInflight.current.has(path) ? 0 : 150,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    step,
    guestsValid,
    datesValid,
    checkInOn,
    apiCheckOutOn,
    stayType,
    adults,
    children,
    slug,
    unitId,
  ]);

  async function loadQuote(): Promise<QuoteResult> {
    const availability = await browserStayBookingGet<AvailabilityResult>(availabilityPath());
    if (!availability.available) {
      throw new Error(unavailableMessage(availability));
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
      if (!embedded) goStaySlide('dates', 'back');
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
    if (!guestsValid) {
      if (!embedded) goStaySlide('guests', 'forward');
      setError(
        ar
          ? 'أدخل العدد الإجمالي للبالغين (1 أو أكثر) والأطفال (0 أو أكثر) حتى 999.'
          : 'Enter the total adults (1 or more) and children (0 or more), up to 999.',
      );
      return;
    }
    setStep('guest');
  }

  function continueStayDates() {
    setError(null);
    if (!stayDatesValid(stayType, checkInOn, checkOutOn)) {
      setError(
        isSameCalendarDayStay(stayType)
          ? ar
            ? 'اختر تاريخ الإقامة من الأيام الشاغرة.'
            : 'Pick a stay date from the free days.'
          : ar
            ? 'اختر يوم الوصول ثم يوم المغادرة.'
            : 'Pick check-in then check-out.',
      );
      return;
    }
    goStaySlide('guests', 'forward');
  }

  const staySlideLabels: Record<StaySlide, string> = {
    type: ar ? 'النوع' : 'Type',
    dates: ar ? 'التواريخ' : 'Dates',
    guests: ar ? 'الضيوف' : 'Guests',
  };

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
          setError(paymentErrorMessage(payError, ar, true));
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
        setError(paymentErrorMessage(caught, ar, false));
        setPayBusy(false);
        setStepHint(null);
      }
    })();
  }

  const stayGreeting = stayCheckoutGreeting(step, {
    ar,
    title: title ?? '',
    name: greetingName(selfName),
  });
  /** Full illustrated scene only on the first stay-type slide — frees the calendar/guests viewport. */
  const showStayScene = !embedded && step === 'stay' && staySlide === 'type';
  const denseChrome = !embedded && !(step === 'stay' && staySlide === 'type');

  return (
    <section
      className={[
        embedded
          ? 'stays-checkout stays-checkout--wizard'
          : 'stays-checkout stays-checkout--wizard stays-checkout--page',
        denseChrome ? 'stays-checkout--dense' : '',
        !embedded && step === 'stay' && staySlide === 'dates' ? 'stays-checkout--dates' : '',
        !embedded && step === 'stay' && staySlide === 'guests' ? 'stays-checkout--guests' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby="stays-checkout-title"
    >
      <h2 id="stays-checkout-title" className={denseChrome ? 'stays-checkout__title--sr' : undefined}>
        {ar ? 'إكمال الحجز' : 'Complete your booking'}
      </h2>
      {title && !denseChrome ? <p className="stays-checkout__property muted">{title}</p> : null}

      {step === 'stay' && (staySlide === 'dates' || staySlide === 'guests') ? null : (
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
      )}

      {showStayScene ? (
        <BookingStepScene
          greeting={stayGreeting}
          label={steps[stepIndex(step)]!.label}
          stepNo={stepIndex(step) + 1}
          stepCount={steps.length}
          ar={ar}
        />
      ) : denseChrome && step !== 'stay' ? (
        <div className="stays-checkout__compact-head">
          <p className="stays-checkout__compact-meta">
            <span>{steps[stepIndex(step)]!.label}</span>
            <span dir="ltr">
              {stepIndex(step) + 1} / {steps.length}
            </span>
          </p>
          <h3>{stayGreeting.heading}</h3>
        </div>
      ) : null}

      {step === 'stay' ? (
        <div
          className={
            embedded
              ? 'stays-checkout__panel stays-checkout__panel--stay'
              : 'stays-checkout__panel stays-checkout__panel--stay stays-checkout__panel--slides'
          }
        >
          {embedded ? null : (
            <>
              <ol
                className="stays-checkout__slides"
                aria-label={ar ? 'شرائح اختيار الإقامة' : 'Stay selection slides'}
              >
                {STAY_SLIDES.map((id, index) => {
                  const current = STAY_SLIDES.indexOf(staySlide);
                  const done = index < current;
                  const active = id === staySlide;
                  return (
                    <li
                      key={id}
                      className={
                        active
                          ? 'stays-checkout__slide is-active'
                          : done
                            ? 'stays-checkout__slide is-done'
                            : 'stays-checkout__slide'
                      }
                    >
                      <button
                        type="button"
                        disabled={!done && !active}
                        onClick={() => {
                          if (done) goStaySlide(id, 'back');
                        }}
                      >
                        <span aria-hidden="true">{index + 1}</span>
                        {staySlideLabels[id]}
                      </button>
                    </li>
                  );
                })}
              </ol>
              {staySlide !== 'type' ? (
                <div className="stays-checkout__picked" aria-live="polite">
                  <button
                    type="button"
                    className="stays-checkout__picked-chip"
                    onClick={() => goStaySlide('type', 'back')}
                  >
                    <span>{ar ? 'النوع' : 'Type'}</span>
                    <strong>{stayTypeTitle(stayType, ar)}</strong>
                  </button>
                  {staySlide === 'guests' && datesValid ? (
                    <button
                      type="button"
                      className="stays-checkout__picked-chip"
                      onClick={() => goStaySlide('dates', 'back')}
                    >
                      <span>{ar ? 'الموعد' : 'Dates'}</span>
                      <strong dir="ltr">
                        {isSameCalendarDayStay(stayType)
                          ? checkInOn
                          : `${checkInOn} → ${checkOutOn}`}
                      </strong>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          <div
            key={embedded ? 'all' : staySlide}
            className={
              embedded ? undefined : `wizard-pane wizard-pane--${staySlideDir} stays-checkout__slide-pane`
            }
          >
            {embedded || staySlide === 'type' ? (
              <section className="stays-checkout__section" aria-labelledby="stay-book-type-title">
                <h3 className="stays-checkout__section-title" id="stay-book-type-title">
                  {ar ? 'نوع الإقامة' : 'Stay type'}
                </h3>
                <div
                  className="stays-checkout__types"
                  role="radiogroup"
                  aria-labelledby="stay-book-type-title"
                >
                  {STAY_TYPES.map((type) => {
                    const selected = type === stayType;
                    const price = offer ? stayTypePrice(type, offer) : null;
                    return (
                      <button
                        key={type}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={
                          selected ? 'stays-checkout__type is-selected' : 'stays-checkout__type'
                        }
                        onClick={() => pickStayType(type)}
                      >
                        <span className="stays-checkout__type-icon" aria-hidden="true">
                          <StayTypeIcon type={type} />
                        </span>
                        <span className="stays-checkout__type-text">
                          <strong>{stayTypeTitle(type, ar)}</strong>
                          <small>
                            {stayTypeHint(type, ar, resolveStayPeriodTimes(type, offer ?? {}))}
                          </small>
                        </span>
                        {price && offer ? (
                          <span className="stays-checkout__type-price">
                            <b dir="ltr">{formatMoney(price, offer.currency, locale)}</b>
                            <small>{stayTypeUnit(type, ar)}</small>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {embedded || staySlide === 'dates' ? (
              <section className="stays-checkout__section" aria-labelledby="stay-book-dates-title">
                <h3 className="stays-checkout__section-title" id="stay-book-dates-title">
                  {isSameCalendarDayStay(stayType)
                    ? ar
                      ? 'تاريخ الإقامة'
                      : 'Stay date'
                    : ar
                      ? 'التواريخ'
                      : 'Dates'}
                </h3>
                {embedded ? (
                  <dl className="stays-checkout__summary stays-checkout__summary--inline">
                    <div>
                      <dt>{ar ? 'الوصول' : 'Check-in'}</dt>
                      <dd className="stays-checkout__chip stays-checkout__chip--check-in" dir="ltr">
                        {checkInLabel}
                      </dd>
                    </div>
                    <div>
                      <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
                      <dd className="stays-checkout__chip stays-checkout__chip--check-out" dir="ltr">
                        {checkOutLabel}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <>
                    <p className="stays-checkout__hint stays-checkout__calendar-hint">
                      {ar
                        ? isSameCalendarDayStay(stayType)
                          ? `${periodTimes.checkInTime} → ${periodTimes.checkOutTime} · اختر يوماً ثم متابعة`
                          : 'اختر الوصول ثم المغادرة، ثم متابعة'
                        : isSameCalendarDayStay(stayType)
                          ? `${periodTimes.checkInTime} → ${periodTimes.checkOutTime} · pick a day, then Continue`
                          : 'Pick check-in then check-out, then Continue'}
                    </p>
                    <StayAvailabilityCalendar
                      locale={locale}
                      mode="public"
                      slug={slug}
                      {...(unitId ? { unitId } : {})}
                      monthCount={1}
                      size="compact"
                      dense
                      selectedCheckIn={checkInOn}
                      selectedCheckOut={isSameCalendarDayStay(stayType) ? '' : checkOutOn}
                      onRangeChange={(nextIn, nextOut, halfDay) => {
                        applyDateRange(nextIn, nextOut, halfDay);
                      }}
                    />
                    {!isSameCalendarDayStay(stayType) ? (
                      <div className="stays-checkout__nights stays-checkout__nights--inline">
                        <span className="stays-checkout__nights-label">
                          {ar ? 'المدة' : 'Length'}
                        </span>
                        <div className="stays-checkout__nights-stepper">
                          <button
                            type="button"
                            onClick={() => changeNights(-1)}
                            disabled={stayNights <= 1}
                            aria-label={ar ? 'إنقاص ليلة' : 'One night less'}
                          >
                            −
                          </button>
                          <output aria-live="polite">
                            {stayNights > 0 ? nightsLabel(stayNights, ar) : '—'}
                          </output>
                          <button
                            type="button"
                            onClick={() => changeNights(1)}
                            disabled={stayNights >= MAX_STAY_NIGHTS}
                            aria-label={ar ? 'تمديد ليلة' : 'Add a night'}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ) : checkInOn ? (
                      <p className="stays-checkout__period-note stays-checkout__period-note--inline">
                        {`${checkInOn} · ${periodTimes.checkInTime} → ${periodTimes.checkOutTime}`}
                      </p>
                    ) : null}
                  </>
                )}
                {!embedded ? (
                  <div className="stays-checkout__nav stays-checkout__nav--sticky">
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => goStaySlide('type', 'back')}
                    >
                      {ar ? 'رجوع' : 'Back'}
                    </button>
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={continueStayDates}
                    >
                      {ar ? 'متابعة إلى الضيوف' : 'Continue to guests'}
                      <span aria-hidden="true">{ar ? '←' : '→'}</span>
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}

            {embedded || staySlide === 'guests' ? (
              <section className="stays-checkout__section" aria-labelledby="stay-book-guests-title">
                <h3 className="stays-checkout__section-title" id="stay-book-guests-title">
                  {ar ? 'الضيوف' : 'Guests'}
                </h3>
                <div className="stays-checkout__guests">
                  <GuestCountField
                    id="stay-book-adults"
                    label={ar ? 'بالغون' : 'Adults'}
                    value={adults}
                    onChange={setAdults}
                    min={1}
                    ar={ar}
                  />
                  <GuestCountField
                    id="stay-book-children"
                    label={ar ? 'أطفال' : 'Children'}
                    value={children}
                    onChange={setChildren}
                    min={0}
                    ar={ar}
                  />
                </div>
                {offer?.maxGuests ? (
                  <p className="stays-checkout__hint">
                    {ar
                      ? `تتسع هذه الإقامة حتى ${guestsLabelAr(offer.maxGuests)} (بالغون وأطفال).`
                      : `This stay fits up to ${offer.maxGuests} guests (adults and children).`}
                  </p>
                ) : null}
                {!embedded ? (
                  <>
                    <StayEstimateCard
                      ar={ar}
                      locale={locale}
                      stayType={stayType}
                      state={estimate}
                      unavailableMessage={unavailableMessage}
                    />
                    <div className="stays-checkout__nav stays-checkout__nav--sticky">
                      <button
                        type="button"
                        className="button button--quiet"
                        onClick={() => goStaySlide('dates', 'back')}
                      >
                        {ar ? 'رجوع' : 'Back'}
                      </button>
                      <button
                        type="button"
                        className="button button--primary stays-checkout__submit"
                        onClick={continueFromStay}
                      >
                        {ar ? 'متابعة إلى بياناتك' : 'Continue to your details'}
                        <span aria-hidden="true">{ar ? '←' : '→'}</span>
                      </button>
                    </div>
                  </>
                ) : null}
              </section>
            ) : null}
          </div>

          {embedded ? (
            <>
              <StayEstimateCard
                ar={ar}
                locale={locale}
                stayType={stayType}
                state={estimate}
                unavailableMessage={unavailableMessage}
              />
              <button
                type="button"
                className="button button--primary stays-checkout__submit"
                onClick={continueFromStay}
              >
                {ar ? 'متابعة إلى بياناتك' : 'Continue to your details'}
                <span aria-hidden="true">{ar ? '←' : '→'}</span>
              </button>
            </>
          ) : null}
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
          <div className="stays-checkout__nav stays-checkout__nav--sticky">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                if (!embedded) {
                  setStaySlideDir('back');
                  setStaySlide('guests');
                }
                setStep('stay');
              }}
            >
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
                {checkInLabel}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--check-out" dir="ltr">
                {checkOutLabel}
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
          <div className="stays-checkout__nav stays-checkout__nav--sticky">
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
                {checkInLabel}
              </dd>
            </div>
            <div>
              <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--check-out" dir="ltr">
                {checkOutLabel}
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
