import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { GuestStayActions } from '@/components/stays/guest-stay-actions';
import { bookingStatusTone } from '@/lib/booking-priority';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { lookupPublicStayBookingOnNeon } from '@/lib/public-stays-guest-neon';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { ApiError, apiFetch, publicApiFetch } from '@/lib/server-api';
import { stayBookingModeLabel, stayStatusLabel, stayTypeLabel } from '@/lib/ui-labels';
import { getViewer } from '@/lib/viewer';
import { formatMoney } from '@/lib/format';

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
  listingSlug?: string | null;
  listingTitleAr?: string | null;
  listingTitleEn?: string | null;
  unitId?: string | null;
  stayType?: string | null;
  guestDisplayName?: string | null;
  adults?: number | null;
  children?: number | null;
  canPay?: boolean;
  canCancel?: boolean;
  canRebook?: boolean;
};

const PAID_STATUSES = new Set(['confirmed', 'paid', 'pre_arrival', 'checked_in', 'checked_out']);
const ENDED_STATUSES = new Set(['cancelled', 'expired', 'no_show', 'rejected']);

function statusMessage(status: string, ar: boolean): string {
  switch (status) {
    case 'request_pending':
      return ar
        ? 'وصل طلب حجزك إلى المالك وهو قيد المراجعة. ستتغيّر الحالة هنا فور اعتماده.'
        : 'Your request has reached the host and is under review. This page updates as soon as it is approved.';
    case 'payment_pending':
      return ar
        ? 'التواريخ محجوزة لك مؤقتاً. أكمل الدفع لتأكيد إقامتك.'
        : 'Your dates are held for you. Complete payment to confirm your stay.';
    case 'payment_failed':
      return ar
        ? 'لم يكتمل الدفع. يمكنك المحاولة مرة أخرى.'
        : 'Payment did not go through. You can try again.';
    case 'confirmed':
    case 'paid':
    case 'pre_arrival':
      return ar
        ? 'حجزك مؤكَّد، ونتطلّع لاستضافتك.'
        : 'Your stay is confirmed. We look forward to hosting you.';
    case 'checked_in':
      return ar ? 'أهلاً بك، نتمنى لك إقامة هانئة.' : 'Welcome — enjoy your stay.';
    case 'checked_out':
    case 'closed':
      return ar
        ? 'انتهت إقامتك. شكراً لاختيارك BHD R.'
        : 'Your stay has ended. Thank you for choosing BHD R.';
    case 'cancelled':
      return ar ? 'تم إلغاء هذا الحجز.' : 'This booking was cancelled.';
    case 'expired':
      return ar
        ? 'انتهت مهلة هذا الحجز قبل إتمامه.'
        : 'This booking expired before it was completed.';
    case 'no_show':
      return ar ? 'سُجّل عدم الحضور لهذا الحجز.' : 'This booking was marked as a no-show.';
    default:
      return '';
  }
}

type Step = { label: string; state: 'done' | 'current' | 'upcoming' };

function journeySteps(status: string, mode: string | undefined, ar: boolean): Step[] {
  const request = mode === 'request' || status === 'request_pending';
  const labels = request
    ? ar
      ? ['تقديم الطلب', 'اعتماد المالك', 'الوصول', 'المغادرة']
      : ['Request sent', 'Host approval', 'Check-in', 'Check-out']
    : ar
      ? ['الحجز', 'الدفع', 'الوصول', 'المغادرة']
      : ['Booked', 'Payment', 'Check-in', 'Check-out'];
  const current =
    status === 'request_pending' || status === 'payment_pending' || status === 'payment_failed'
      ? 1
      : status === 'checked_in'
        ? 3
        : status === 'checked_out' || status === 'closed'
          ? 4
          : 2;
  return labels.map((label, index) => ({
    label,
    state: index < current ? 'done' : index === current ? 'current' : 'upcoming',
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

  const viewer = await getViewer();
  let booking: GuestBooking | null = null;

  if (viewer) {
    booking = await apiFetch<GuestBooking>(
      `/v1/guest/stays/bookings/${encodeURIComponent(bookingId)}`,
    ).catch((error: unknown) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 401)) return null;
      return null;
    });
  }

  const neonRef = referenceCode ?? booking?.referenceCode;
  if (neonRef && hasDatabaseUrl()) {
    const fromNeon = await lookupPublicStayBookingOnNeon(neonRef).catch(() => null);
    if (fromNeon && fromNeon.id === bookingId) booking = { ...booking, ...fromNeon };
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
  const message = statusMessage(booking.status, ar);
  const ended = ENDED_STATUSES.has(booking.status);
  const paid = PAID_STATUSES.has(booking.status);
  const steps = ended ? [] : journeySteps(booking.status, booking.bookingMode, ar);
  const title =
    (ar ? booking.listingTitleAr : booking.listingTitleEn) ??
    booking.listingTitleAr ??
    booking.listingTitleEn ??
    (ar ? 'إقامتك في عُمان' : 'Your stay in Oman');
  const checkIn = formatStayDate(booking.checkInOn, ar);
  const checkOut = formatStayDate(booking.checkOutOn, ar);
  const nights = typeof booking.nights === 'number' ? booking.nights : null;
  const total = formatMoney(booking.totalMinor, booking.currency, locale);
  const perNight =
    nights && nights > 0
      ? formatMoney(
          (BigInt(booking.totalMinor) / BigInt(nights)).toString(),
          booking.currency,
          locale,
        )
      : null;
  const guests = [
    typeof booking.adults === 'number' && booking.adults > 0
      ? ar
        ? `${booking.adults} بالغ`
        : `${booking.adults} adult${booking.adults === 1 ? '' : 's'}`
      : null,
    typeof booking.children === 'number' && booking.children > 0
      ? ar
        ? `${booking.children} طفل`
        : `${booking.children} child${booking.children === 1 ? '' : 'ren'}`
      : null,
  ].filter(Boolean);
  const refQuery = encodeURIComponent(booking.referenceCode);

  return (
    <main className="guest-stay-detail">
      <section className="guest-stay-detail__hero">
        <img
          className="guest-stay-detail__hero-img"
          src="/brand/oman-landmark-mosque.jpg"
          alt={ar ? 'جامع السلطان قابوس الأكبر، مسقط' : 'Sultan Qaboos Grand Mosque, Muscat'}
        />
        <div className="guest-stay-detail__hero-scrim" />
        <div className="container guest-stay-detail__hero-inner">
          <Link className="guest-stay-detail__back" href="/guest/stays">
            {ar ? '→ رحلاتي' : '← My trips'}
          </Link>
          <p className="guest-stay-detail__kicker">{ar ? 'تفاصيل الإقامة' : 'Stay details'}</p>
          <h1 className="guest-stay-detail__title">{title}</h1>
          <div className="guest-stay-detail__badges">
            <span className={`guest-stay-detail__status guest-stay-detail__status--${tone}`}>
              {stayStatusLabel(booking.status, locale)}
            </span>
            <span className="guest-stay-detail__ref" dir="ltr">
              {booking.referenceCode}
            </span>
          </div>
          <p className="guest-stay-detail__caption">
            {ar ? 'جامع السلطان قابوس الأكبر · مسقط' : 'Sultan Qaboos Grand Mosque · Muscat'}
          </p>
        </div>
      </section>

      <div className="container guest-stay-detail__body">
        <div className="guest-stay-detail__main">
          {message ? (
            <section className={`guest-stay-detail__notice guest-stay-detail__notice--${tone}`}>
              <strong>{stayStatusLabel(booking.status, locale)}</strong>
              <p>{message}</p>
            </section>
          ) : null}

          {steps.length ? (
            <ol
              className="guest-stay-detail__steps"
              aria-label={ar ? 'مراحل الحجز' : 'Booking progress'}
            >
              {steps.map((step, index) => (
                <li
                  key={step.label}
                  className={`guest-stay-detail__step guest-stay-detail__step--${step.state}`}
                  aria-current={step.state === 'current' ? 'step' : undefined}
                >
                  <span className="guest-stay-detail__step-dot">
                    {step.state === 'done' ? '✓' : index + 1}
                  </span>
                  <span className="guest-stay-detail__step-label">{step.label}</span>
                </li>
              ))}
            </ol>
          ) : null}

          <section className="guest-stay-detail__card">
            <h2>{ar ? 'موعد الإقامة' : 'Your dates'}</h2>
            <div className="guest-stay-detail__dates">
              <div className="guest-stay-detail__date">
                <span className="guest-stay-detail__date-label">{ar ? 'الوصول' : 'Check-in'}</span>
                <strong>{checkIn.date}</strong>
                <span className="muted">{checkIn.weekday}</span>
              </div>
              <div className="guest-stay-detail__nights" aria-hidden={nights == null}>
                {nights != null ? <span>{nightsLabel(nights, ar)}</span> : null}
              </div>
              <div className="guest-stay-detail__date">
                <span className="guest-stay-detail__date-label">
                  {ar ? 'المغادرة' : 'Check-out'}
                </span>
                <strong>{checkOut.date}</strong>
                <span className="muted">{checkOut.weekday}</span>
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
            </dl>
          </section>
        </div>

        <aside className="guest-stay-detail__side">
          <section className="guest-stay-detail__card guest-stay-detail__price">
            <span className="guest-stay-detail__price-label">
              {ar ? 'المبلغ الإجمالي' : 'Total amount'}
            </span>
            <strong className="guest-stay-detail__price-total" dir="ltr">
              {total}
            </strong>
            {perNight && nights ? (
              <span className="muted">
                {ar
                  ? `${nightsLabel(nights, ar)} · متوسط الليلة ${perNight}`
                  : `${nightsLabel(nights, ar)} · ${perNight} per night on average`}
              </span>
            ) : null}
            <GuestStayActions booking={booking} />
            {paid ? (
              <div className="guest-stay-detail__docs">
                <Link
                  className="button button--quiet"
                  href={`/stays/booking/receipt?ref=${refQuery}&doc=payment`}
                >
                  {ar ? 'إيصال الدفع (PDF)' : 'Payment receipt (PDF)'}
                </Link>
                <Link
                  className="button button--quiet"
                  href={`/stays/booking/receipt?ref=${refQuery}&doc=confirmation`}
                >
                  {ar ? 'تأكيد الحجز (PDF)' : 'Booking confirmation (PDF)'}
                </Link>
              </div>
            ) : null}
          </section>
          <p className="guest-stay-detail__help muted">
            {ar
              ? 'احتفظ برقم الحجز للمتابعة أو عند التواصل مع المالك.'
              : 'Keep your reference handy to track this stay or when contacting the host.'}
          </p>
        </aside>
      </div>
    </main>
  );
}
