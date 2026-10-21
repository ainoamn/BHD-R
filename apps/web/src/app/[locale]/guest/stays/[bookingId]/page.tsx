import { Fragment } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { GuestStayActions } from '@/components/stays/guest-stay-actions';
import { StayCheckinPass } from '@/components/stays/stay-checkin-pass';
import { bookingStatusTone } from '@/lib/booking-priority';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadGuestReviewState } from '@/lib/booking-reviews-neon';
import { lookupPublicStayBookingOnNeon } from '@/lib/public-stays-guest-neon';
import { stayPaymentKindLabel } from '@/lib/stay-booking-payment-labels';
import type { StayBookingPaymentLine } from '@/lib/stay-booking-payments';
import { StayGuestReview } from '@/components/stays/stay-guest-review';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { ApiError, apiFetch, publicApiFetch } from '@/lib/server-api';
import { stayBookingModeLabel, stayStatusLabel, stayTypeLabel } from '@/lib/ui-labels';
import { getViewer } from '@/lib/viewer';
import { formatMoney } from '@/lib/format';
import { LiveSync } from '@/components/live-sync';
import {
  displayStayCheckoutOn,
  isHalfDayStayType,
} from '@/lib/stay-period-times';
import {
  StayJourneyCard,
  StayJourneyProvider,
  StayJourneySteps,
} from '@/components/stays/stay-journey';
import {
  stayGuestGreeting,
  stayJourneyCurrent,
  stayJourneyInitialStep,
  stayJourneyScreens,
} from '@/lib/stay-guest-greeting';
import { RememberStayTripAlert } from '@/components/stays/remember-stay-trip-alert';
import { isStayEsignRequiredServer } from '@/lib/stay-esign-flags';
import type { StayStamp } from '@/lib/stay-arrival-neon';
import { StayRefundNotices } from '@/components/stays/stay-refund-notices';
import { hasDeposit, refundNotices, type GuestDepositRefund } from '@/lib/stay-deposit-refund';
import type { StayRefundMoment } from '@/lib/stay-guest-greeting';
import { StayDepositClaims } from '@/components/stays/stay-deposit-claims';
import type { DepositClaimView } from '@/lib/stay-deposit-claims';
import { loadComplaintWhatsapp } from '@/lib/stay-deposit-claims-neon';
import { loadStayBookingLocation } from '@/lib/stay-booking-location-neon';
import { PropertyLocationMap } from '@/components/property-location-map';

type GuestBooking = {
  id: string;
  referenceCode: string;
  checkInOn: string;
  checkOutOn: string;
  status: string;
  currency: string;
  totalMinor: string;
  nights?: number;
  bookingMode?: string;
  timezone?: string;
  paymentIntentId?: string | null;
  payments?: StayBookingPaymentLine[];
  listingSlug?: string | null;
  listingTitleAr?: string | null;
  listingTitleEn?: string | null;
  unitId?: string | null;
  stayType?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  guestDisplayName?: string | null;
  adults?: number | null;
  children?: number | null;
  canPay?: boolean;
  canCancel?: boolean;
  canRebook?: boolean;
  canReschedule?: boolean;
  pendingReschedule?: {
    status: 'awaiting_owner' | 'awaiting_guest_payment' | 'awaiting_payment';
    checkInOn: string;
    checkOutOn: string;
    stayType: string;
    extraDueMinor: string;
    quotedTotalMinor: string;
    chargedTotalMinor: string;
    paymentRedirectUrl?: string | null;
  } | null;
  guestEmail?: string | null;
  esignCompleted?: boolean;
  checkIn?: StayStamp | null;
  checkOut?: StayStamp | null;
  depositMinor?: string | null;
  depositRefund?: GuestDepositRefund | null;
  canRequestDepositRefund?: boolean;
  depositClaims?: DepositClaimView[];
  cancelOutcome?: {
    note: string | null;
    refundDecision: 'refund' | 'keep' | null;
    paidAmountMinor: string | null;
    currency: string | null;
    fromRequest: boolean;
  } | null;
  rescheduleRejection?: {
    note: string | null;
    at: string;
  } | null;
  contract?: { id: string; reference: string; status: string } | null;
  amendmentContract?: { id: string; reference: string; status: string } | null;
};

const REFUND_STATE: Record<GuestDepositRefund['status'], StayRefundMoment['state']> = {
  requested: 'requested',
  approved: 'approved',
  rejected: 'rejected',
  executed: 'paid',
};

const PAID_STATUSES = new Set(['confirmed', 'paid', 'pre_arrival', 'checked_in', 'checked_out']);
const DEPARTED_STATUSES = new Set(['checked_out', 'closed']);
const ENDED_STATUSES = new Set(['cancelled', 'expired', 'no_show', 'rejected']);

type Step = { label: string; state: 'done' | 'current' | 'upcoming'; detail?: string | null };

function formatStamp(value: string, ar: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

function journeySteps(
  status: string,
  mode: string | undefined,
  ar: boolean,
  stamps: { checkIn?: StayStamp | null; checkOut?: StayStamp | null },
  refund: StayRefundMoment | undefined,
): Step[] {
  const request = mode === 'request' || status === 'request_pending';
  const labels = request
    ? ar
      ? ['تقديم الطلب', 'اعتماد المالك', 'الوصول', 'المغادرة']
      : ['Request sent', 'Host approval', 'Check-in', 'Check-out']
    : ar
      ? ['الحجز', 'الدفع', 'الوصول', 'المغادرة']
      : ['Booked', 'Payment', 'Check-in', 'Check-out'];
  if (refund) labels.push(ar ? 'استرداد التأمين' : 'Deposit refund');
  const current = stayJourneyCurrent(status, refund);
  const details: Array<string | null | undefined> = [
    null,
    null,
    stamps.checkIn?.at ? formatStamp(stamps.checkIn.at, ar) : null,
    stamps.checkOut?.at ? formatStamp(stamps.checkOut.at, ar) : null,
    refund
      ? refund.state === 'open'
        ? null
        : refund.state === 'paid'
          ? (refund.paidAt ?? (ar ? 'حُوّل' : 'Transferred'))
          : refund.state === 'rejected'
            ? ar
              ? 'مرفوض'
              : 'Declined'
            : ar
              ? 'قيد الإجراء'
              : 'In progress'
      : null,
  ];
  return labels.map((label, index) => ({
    label,
    state: index < current ? 'done' : index === current ? 'current' : 'upcoming',
    detail: details[index] ?? null,
  }));
}

function formatStayDate(value: string, ar: boolean): { weekday: string; date: string } {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return { weekday: '', date: value };
  const locale = ar ? 'ar-OM-u-nu-latn' : 'en-GB';
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(parsed),
    date: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(parsed),
  };
}

function nightsLabel(nights: number, ar: boolean): string {
  if (!ar) return `${nights} ${nights === 1 ? 'night' : 'nights'}`;
  if (nights === 1) return 'ليلة واحدة';
  if (nights === 2) return 'ليلتان';
  return `${nights} ${nights <= 10 ? 'ليالٍ' : 'ليلة'}`;
}

/** Arabic counted noun: واحد / مثنى / 3–10 جمع / 11+ مفرد منصوب. */
function arCount(count: number, forms: [string, string, string, string]): string {
  if (count === 1) return forms[0];
  if (count === 2) return forms[1];
  return `${count} ${count <= 10 ? forms[2] : forms[3]}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'ar' ? 'تفاصيل الإقامة' : 'Stay booking',
    robots: { index: false, follow: false },
  };
}

export default async function GuestStayDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; bookingId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw, bookingId } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  if (!isStaysPlatformEnabled()) notFound();
  const ar = locale === 'ar';
  const query = await searchParams;
  const refRaw = query.ref;
  const referenceCode =
    typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  const welcome = query.welcome === '1';

  let booking: GuestBooking | null = null;
  const fromNeonByRef = async (ref: string) => {
    const found = await lookupPublicStayBookingOnNeon(ref).catch(() => null);
    return found && found.id === bookingId ? found : null;
  };

  // The reference code is the guest's key: read Neon directly, so a refresh
  // never waits on the (possibly cold) API.
  if (referenceCode && hasDatabaseUrl()) booking = await fromNeonByRef(referenceCode);

  if (!booking && (await getViewer())) {
    booking = await apiFetch<GuestBooking>(
      `/v1/guest/stays/bookings/${encodeURIComponent(bookingId)}`,
    ).catch((error: unknown) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 401)) return null;
      return null;
    });
    if (booking && hasDatabaseUrl()) {
      const fromNeon = await fromNeonByRef(booking.referenceCode);
      if (fromNeon) booking = { ...booking, ...fromNeon };
    }
  }

  if (!booking && referenceCode) {
    booking = await publicApiFetch<GuestBooking>(
      `/v1/public/stays/bookings/lookup?referenceCode=${encodeURIComponent(referenceCode)}`,
      8,
    ).catch(() => null);
    if (booking && booking.id !== bookingId) booking = null;
  }

  if (!booking) notFound();

  const tone = bookingStatusTone(booking.status, 'stay_booking');
  const ended = ENDED_STATUSES.has(booking.status);
  const paid = PAID_STATUSES.has(booking.status);
  const review =
    DEPARTED_STATUSES.has(booking.status) && hasDatabaseUrl()
      ? await loadGuestReviewState(booking.id).catch(() => null)
      : null;
  const location = hasDatabaseUrl()
    ? await loadStayBookingLocation(booking.id).catch(() => null)
    : null;
  const refund = booking.depositRefund ?? null;
  const depositClaims = booking.depositClaims ?? [];
  const escalated = depositClaims.find((claim) => claim.status === 'escalated');
  const complaintWhatsapp =
    escalated && hasDatabaseUrl()
      ? await loadComplaintWhatsapp(booking.referenceCode, escalated).catch(() => [])
      : [];
  const refundMoment: StayRefundMoment | undefined =
    hasDeposit(booking.depositMinor) && (refund || booking.canRequestDepositRefund)
      ? {
          reviewRequired: !refund && Boolean(review?.required),
          state: refund ? REFUND_STATE[refund.status] : 'open',
          referenceCode: booking.referenceCode,
          deposit: formatMoney(booking.depositMinor ?? '0', booking.currency, locale),
          amount: refund ? formatMoney(refund.amountMinor, refund.currency, locale) : null,
          requestedAt: refund ? formatStamp(refund.requestedAt, ar) : null,
          decidedAt: refund?.decidedAt ? formatStamp(refund.decidedAt, ar) : null,
          note: refund?.decisionNote ?? null,
          paidAt: refund?.paidAt ? formatStamp(refund.paidAt, ar) : null,
          paidTo: refund?.paidTo ?? null,
        }
      : undefined;
  const notices = refund
    ? refundNotices(refund, ar, {
        money: (minor) => formatMoney(minor, refund.currency, locale),
        stamp: (iso) => formatStamp(iso, ar),
      })
    : [];
  const steps = ended
    ? []
    : journeySteps(
        booking.status,
        booking.bookingMode,
        ar,
        {
          checkIn: booking.checkIn ?? null,
          checkOut: booking.checkOut ?? null,
        },
        refundMoment,
      );
  const esignRequired = isStayEsignRequiredServer();
  const accepted = booking.status === 'confirmed' || booking.status === 'pre_arrival';
  const needsEsign = esignRequired && accepted && !booking.esignCompleted;
  const stayLog = [
    booking.checkIn
      ? {
          key: 'in',
          label: ar ? 'وقت الدخول والاستلام' : 'Checked in at',
          notesLabel: ar ? 'ملاحظات الدخول' : 'Check-in notes',
          stamp: booking.checkIn,
        }
      : null,
    booking.checkOut
      ? {
          key: 'out',
          label: ar ? 'وقت المغادرة' : 'Checked out at',
          notesLabel: ar ? 'ملاحظات المغادرة' : 'Check-out notes',
          stamp: booking.checkOut,
        }
      : null,
  ].filter((entry) => entry !== null);
  const title =
    (ar ? booking.listingTitleAr : booking.listingTitleEn) ??
    booking.listingTitleAr ??
    booking.listingTitleEn ??
    (ar ? 'إقامتك في عُمان' : 'Your stay in Oman');
  const displayCheckoutOn = displayStayCheckoutOn(
    booking.stayType,
    booking.checkInOn,
    booking.checkOutOn,
  );
  const checkIn = formatStayDate(booking.checkInOn, ar);
  const checkOut = formatStayDate(displayCheckoutOn, ar);
  const muscatToday = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
  const relativeDay = (value: string) =>
    value.slice(0, 10) > muscatToday
      ? ('upcoming' as const)
      : value.slice(0, 10) === muscatToday
        ? ('today' as const)
        : ('due' as const);
  const cancelOutcome = booking.cancelOutcome ?? null;
  const paidAmountLabel =
    cancelOutcome?.paidAmountMinor && cancelOutcome.currency
      ? formatMoney(cancelOutcome.paidAmountMinor, cancelOutcome.currency, locale)
      : null;
  const greetingInput = {
    status: booking.status,
    ar,
    welcome,
    guestName: booking.guestDisplayName,
    checkInDate: [checkIn.weekday, checkIn.date].filter(Boolean).join(' '),
    arrival: relativeDay(booking.checkInOn),
    departure: relativeDay(displayCheckoutOn),
    needsEsign,
    cancelOutcome,
    paidAmountLabel,
  };
  const otherLocale = ar ? 'en' : 'ar';
  const samePageHref = `/guest/stays/${encodeURIComponent(bookingId)}${
    referenceCode ? `?ref=${encodeURIComponent(referenceCode)}${welcome ? '&welcome=1' : ''}` : ''
  }`;
  const stampText = (stamp: StayStamp | null | undefined) =>
    stamp ? { at: formatStamp(stamp.at, ar), notes: stamp.notes } : null;
  const greeting = ended ? stayGuestGreeting(greetingInput) : null;
  const screens = ended
    ? []
    : stayJourneyScreens({
        ...greetingInput,
        mode: booking.bookingMode,
        checkOutDate: [checkOut.weekday, checkOut.date].filter(Boolean).join(' '),
        checkIn: stampText(booking.checkIn),
        checkOut: stampText(booking.checkOut),
        refund: refundMoment,
      });
  const initialStep = stayJourneyInitialStep(booking.status, welcome, refundMoment);
  const rebookHref = booking.listingSlug
    ? `/stays/${encodeURIComponent(booking.listingSlug)}`
    : '/stays';
  const halfDay = isHalfDayStayType(booking.stayType);
  const nights = typeof booking.nights === 'number' ? booking.nights : null;
  const total = formatMoney(booking.totalMinor, booking.currency, locale);
  const perNight =
    !halfDay && nights && nights > 0
      ? formatMoney(
          (BigInt(booking.totalMinor) / BigInt(nights)).toString(),
          booking.currency,
          locale,
        )
      : null;
  const staySpanLabel = halfDay
    ? booking.stayType
      ? stayTypeLabel(booking.stayType, locale)
      : null
    : nights != null
      ? nightsLabel(nights, ar)
      : null;
  const guests = [
    typeof booking.adults === 'number' && booking.adults > 0
      ? ar
        ? arCount(booking.adults, ['بالغ واحد', 'بالغان', 'بالغين', 'بالغاً'])
        : `${booking.adults} adult${booking.adults === 1 ? '' : 's'}`
      : null,
    typeof booking.children === 'number' && booking.children > 0
      ? ar
        ? arCount(booking.children, ['طفل واحد', 'طفلان', 'أطفال', 'طفلاً'])
        : `${booking.children} child${booking.children === 1 ? '' : 'ren'}`
      : null,
  ].filter(Boolean);
  const refQuery = encodeURIComponent(booking.referenceCode);

  return (
    <main className="guest-stay-detail">
      <RememberStayTripAlert
        id={booking.id}
        referenceCode={booking.referenceCode}
        status={booking.status}
        checkInOn={booking.checkInOn}
        checkOutOn={booking.checkOutOn}
        currency={booking.currency}
        totalMinor={booking.totalMinor}
      />
      <LiveSync booking={booking.id} reference={booking.referenceCode} />
      <StayJourneyProvider
        key={`${booking.status}:${refundMoment?.state ?? ''}:${review?.required ? 'review' : ''}:${initialStep}`}
        initial={initialStep}
      >
        <section className="guest-stay-detail__hero" aria-labelledby="guest-stay-title">
          <img
            className="guest-stay-detail__hero-img"
            src="/brand/oman-landmark-mosque.jpg"
            alt={ar ? 'جامع السلطان قابوس الأكبر، مسقط' : 'Sultan Qaboos Grand Mosque, Muscat'}
          />
          <div className="guest-stay-detail__hero-scrim" />
          <div className="guest-stay-detail__hero-top">
            <Link className="guest-stay-detail__back" href="/guest/stays">
              {ar ? '→ رحلاتي' : '← My trips'}
            </Link>
            <Link
              className="guest-stay-detail__back guest-stay-detail__lang"
              href={samePageHref}
              locale={otherLocale}
              hrefLang={otherLocale}
              lang={otherLocale}
              title={ar ? 'View this page in English' : 'اعرض الصفحة بالعربية'}
            >
              {ar ? 'English' : 'العربية'}
            </Link>
            <Link
              className="guest-stay-detail__logo logo__product logo__product--on-dark"
              href="/"
              aria-label="BHD R"
            >
              <img src="/brand/bhd-official-symbol.svg" alt="" width="84" height="26" />
              <i>R</i>
            </Link>
          </div>
          <div className="guest-stay-detail__hero-content">
            <p className="guest-stay-detail__kicker">{ar ? 'تفاصيل الإقامة' : 'Stay details'}</p>
            <h1 id="guest-stay-title" className="guest-stay-detail__title">
              {title}
            </h1>
            <div className="guest-stay-detail__badges">
              <span className={`guest-stay-detail__status guest-stay-detail__status--${tone}`}>
                {stayStatusLabel(booking.status, locale)}
              </span>
              <span className="guest-stay-detail__ref" dir="ltr">
                {booking.referenceCode}
              </span>
            </div>
            {steps.length ? (
              <StayJourneySteps
                steps={steps}
                reachable={screens.map((screen) => screen !== null)}
                ar={ar}
              />
            ) : null}
          </div>
          <p className="guest-stay-detail__caption">
            {ar ? 'جامع السلطان قابوس الأكبر · مسقط' : 'Sultan Qaboos Grand Mosque · Muscat'}
          </p>
        </section>

        <section className="guest-stay-detail__panel">
          <div className="guest-stay-detail__panel-body">
            {greeting ? (
              <section
                className={`guest-stay-detail__greeting guest-stay-detail__greeting--${greeting.stage}`}
                aria-live="polite"
              >
                <h2>{greeting.headline}</h2>
                <p>{greeting.body}</p>
                {greeting.guide ? (
                  <ol className="guest-stay-detail__guide">
                    {greeting.guide.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                ) : null}
                {greeting.rebook ? (
                  <Link
                    className="button button--primary guest-stay-detail__rebook"
                    href={rebookHref}
                  >
                    {greeting.stage === 'checked_out'
                      ? ar
                        ? 'احجز إقامتك القادمة'
                        : 'Book your next stay'
                      : ar
                        ? 'تصفّح الإقامات'
                        : 'Browse stays'}
                  </Link>
                ) : null}
              </section>
            ) : null}
            {notices.length ? (
              <StayRefundNotices notices={notices} referenceCode={booking.referenceCode} ar={ar} />
            ) : null}
            {review ? (
              <StayGuestReview
                referenceCode={booking.referenceCode}
                propertyName={title}
                state={review}
                depositWaiting={Boolean(refundMoment?.reviewRequired)}
                ar={ar}
              />
            ) : null}
            {refund ? (
              <StayDepositClaims
                referenceCode={booking.referenceCode}
                refund={refund}
                claims={depositClaims}
                depositMinor={booking.depositMinor ?? null}
                whatsapp={complaintWhatsapp}
                ar={ar}
              />
            ) : null}
            {screens.length ? (
              <StayJourneyCard
                screens={screens}
                steps={steps}
                rebookHref={rebookHref}
                plateNo={booking.referenceCode}
                ar={ar}
              />
            ) : null}
            {paid &&
            !ENDED_STATUSES.has(booking.status) &&
            booking.status !== 'checked_out' &&
            booking.status !== 'closed' ? (
              <StayCheckinPass locale={locale} referenceCode={booking.referenceCode} />
            ) : null}
            <section className="guest-stay-detail__card">
              <h2>{ar ? 'موعد الإقامة' : 'Your dates'}</h2>
              <div className="guest-stay-detail__dates">
                <div className="guest-stay-detail__date">
                  <span className="guest-stay-detail__date-label">
                    {ar ? 'الوصول' : 'Check-in'}
                  </span>
                  <strong>{checkIn.date}</strong>
                  <span className="muted">
                    {checkIn.weekday}
                    {booking.checkInTime ? ` · ${booking.checkInTime}` : ''}
                  </span>
                </div>
                <div
                  className="guest-stay-detail__nights"
                  aria-hidden={staySpanLabel == null}
                >
                  {staySpanLabel ? <span>{staySpanLabel}</span> : null}
                </div>
                <div className="guest-stay-detail__date">
                  <span className="guest-stay-detail__date-label">
                    {ar ? 'المغادرة' : 'Check-out'}
                  </span>
                  <strong>{checkOut.date}</strong>
                  <span className="muted">
                    {checkOut.weekday}
                    {booking.checkOutTime ? ` · ${booking.checkOutTime}` : ''}
                  </span>
                </div>
              </div>
            </section>

            <section className="guest-stay-detail__card">
              <h2>{ar ? 'تفاصيل الحجز' : 'Booking details'}</h2>
              <dl className="guest-stay-detail__facts">
                {booking.guestDisplayName ? (
                  <div>
                    <dt>{ar ? 'الضيف' : 'Guest'}</dt>
                    <dd>{booking.guestDisplayName}</dd>
                  </div>
                ) : null}
                {guests.length ? (
                  <div>
                    <dt>{ar ? 'عدد الضيوف' : 'Guests'}</dt>
                    <dd>{guests.join(ar ? ' و' : ', ')}</dd>
                  </div>
                ) : null}
                {booking.stayType ? (
                  <div>
                    <dt>{ar ? 'نوع الإقامة' : 'Stay type'}</dt>
                    <dd>{stayTypeLabel(booking.stayType, locale)}</dd>
                  </div>
                ) : null}
                {booking.bookingMode ? (
                  <div>
                    <dt>{ar ? 'نمط الحجز' : 'Booking mode'}</dt>
                    <dd>{stayBookingModeLabel(booking.bookingMode, locale)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{ar ? 'رقم الحجز' : 'Reference'}</dt>
                  <dd dir="ltr">{booking.referenceCode}</dd>
                </div>
                {booking.timezone ? (
                  <div>
                    <dt>{ar ? 'المنطقة الزمنية' : 'Time zone'}</dt>
                    <dd dir="ltr">{booking.timezone}</dd>
                  </div>
                ) : null}
                {stayLog.map((entry) => (
                  <Fragment key={entry.key}>
                    <div>
                      <dt>{entry.label}</dt>
                      <dd>{formatStamp(entry.stamp.at, ar)}</dd>
                    </div>
                    {entry.stamp.notes ? (
                      <div className="guest-stay-detail__fact--wide">
                        <dt>{entry.notesLabel}</dt>
                        <dd className="guest-stay-detail__notes">{entry.stamp.notes}</dd>
                      </div>
                    ) : null}
                  </Fragment>
                ))}
                {refundMoment ? (
                  <div>
                    <dt>{ar ? 'مبلغ التأمين' : 'Security deposit'}</dt>
                    <dd>
                      <bdi dir="ltr">{refundMoment.deposit}</bdi>
                      {' · '}
                      {
                        {
                          open: ar ? 'لم يُطلب استرداده بعد' : 'Refund not requested yet',
                          requested: ar ? 'طلب الاسترداد قيد المراجعة' : 'Refund under review',
                          approved: ar ? 'الاسترداد قيد الإجراء' : 'Refund in progress',
                          rejected: ar ? 'رُفض الاسترداد' : 'Refund declined',
                          paid: ar ? 'حُوّل إليك' : 'Transferred to you',
                        }[refundMoment.state]
                      }
                    </dd>
                  </div>
                ) : null}
                {booking.contract ? (
                  <div>
                    <dt>{ar ? 'عقد الإقامة' : 'Stay contract'}</dt>
                    <dd>
                      <Link href={`/tenant/contracts/${booking.contract.id}`}>
                        <bdi dir="ltr">{booking.contract.reference}</bdi>
                      </Link>
                      {esignRequired && accepted && !needsEsign
                        ? ar
                          ? ' · موقّع إلكترونياً'
                          : ' · Signed electronically'
                        : needsEsign
                          ? ar
                            ? ' · بانتظار توقيعك'
                            : ' · Awaiting your signature'
                          : null}
                    </dd>
                  </div>
                ) : esignRequired && accepted ? (
                  <div>
                    <dt>{ar ? 'عقد الإقامة' : 'Stay contract'}</dt>
                    <dd>
                      {needsEsign
                        ? ar
                          ? 'بانتظار توقيعك'
                          : 'Awaiting your signature'
                        : ar
                          ? 'موقّع إلكترونياً'
                          : 'Signed electronically'}
                    </dd>
                  </div>
                ) : null}
                {booking.amendmentContract ? (
                  <div>
                    <dt>{ar ? 'ملحق تعديل التواريخ' : 'Date-change addendum'}</dt>
                    <dd>
                      <Link href={`/tenant/contracts/${booking.amendmentContract.id}`}>
                        <bdi dir="ltr">{booking.amendmentContract.reference}</bdi>
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
            {location ? (
              <section className="guest-stay-detail__card">
                <h2>{ar ? 'موقع العقار' : 'Property location'}</h2>
                <PropertyLocationMap location={location} locale={locale} />
              </section>
            ) : null}
            {needsEsign ? (
              <Link
                className="button button--primary guest-stay-detail__esign"
                href={`/stays/booking/sign?ref=${refQuery}`}
              >
                {ar ? 'توقيع عقد الإقامة' : 'Sign stay contract'}
              </Link>
            ) : null}
            {paid ? (
              <div className="guest-stay-detail__docs">
                {(booking.payments?.length ?? 0) > 0 ? (
                  booking.payments!.map((line) => (
                    <Link
                      key={line.id}
                      className="button button--quiet"
                      href={`/stays/booking/receipt?ref=${refQuery}&doc=payment&pay=${encodeURIComponent(line.id)}`}
                    >
                      {ar
                        ? `إيصال ${stayPaymentKindLabel(line.kind, true)} (${formatMoney(line.amountMinor, line.currency, locale)})`
                        : `${stayPaymentKindLabel(line.kind, false)} receipt (${formatMoney(line.amountMinor, line.currency, locale)})`}
                    </Link>
                  ))
                ) : (
                  <Link
                    className="button button--quiet"
                    href={`/stays/booking/receipt?ref=${refQuery}&doc=payment`}
                  >
                    {ar ? 'إيصال الدفع (PDF)' : 'Payment receipt (PDF)'}
                  </Link>
                )}
                <Link
                  className="button button--quiet"
                  href={`/stays/booking/receipt?ref=${refQuery}&doc=confirmation`}
                >
                  {ar ? 'تأكيد الحجز (PDF)' : 'Booking confirmation (PDF)'}
                </Link>
                {booking.contract ? (
                  <Link
                    className="button button--quiet"
                    href={`/tenant/contracts/${booking.contract.id}`}
                  >
                    {ar
                      ? `عقد الإقامة (${booking.contract.reference})`
                      : `Stay contract (${booking.contract.reference})`}
                  </Link>
                ) : null}
                {booking.amendmentContract ? (
                  <Link
                    className="button button--quiet"
                    href={`/tenant/contracts/${booking.amendmentContract.id}`}
                  >
                    {ar
                      ? `ملحق التعديل (${booking.amendmentContract.reference})`
                      : `Amendment (${booking.amendmentContract.reference})`}
                  </Link>
                ) : null}
              </div>
            ) : null}
            {welcome && paid && booking.guestEmail ? (
              <p className="guest-stay-detail__help muted">
                {ar
                  ? `أرسلنا رسالة التأكيد ورابط الإيصال إلى ${booking.guestEmail}، فألقِ نظرة على بريدك.`
                  : `A confirmation email with the receipt link was sent to ${booking.guestEmail}.`}
              </p>
            ) : null}
            <p className="guest-stay-detail__help muted">
              {ar
                ? 'احتفظ برقم حجزك في متناول يدك؛ فهو مفتاحك لمتابعة الحجز والتواصل مع المالك.'
                : 'Keep your booking reference handy — it is your key to tracking this stay and reaching the host.'}
            </p>
          </div>

          <footer className="guest-stay-detail__footer">
            <div className="guest-stay-detail__price">
              <span className="guest-stay-detail__price-label">
                {ar ? 'المبلغ الإجمالي' : 'Total amount'}
              </span>
              <strong className="guest-stay-detail__price-total" dir="ltr">
                {total}
              </strong>
              {staySpanLabel ? (
                <span className="guest-stay-detail__price-meta">
                  {perNight
                    ? ar
                      ? `${staySpanLabel} · متوسط سعر الليلة ${perNight}`
                      : `${staySpanLabel} · ${perNight} per night on average`
                    : staySpanLabel}
                </span>
              ) : null}
            </div>
            <GuestStayActions booking={booking} compact />
          </footer>
        </section>
      </StayJourneyProvider>
    </main>
  );
}
