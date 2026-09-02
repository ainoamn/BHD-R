import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { RememberStayTripAlert } from '@/components/stays/remember-stay-trip-alert';
import { formatMoney } from '@/lib/format';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { lookupPublicStayBookingOnNeon } from '@/lib/public-stays-guest-neon';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { publicApiFetch } from '@/lib/server-api';

type PublicBooking = {
  id?: string;
  referenceCode: string;
  status: string;
  checkInOn?: string;
  checkOutOn?: string;
  currency?: string;
  totalMinor?: string;
  nights?: number;
  guestDisplayName?: string | null;
};

async function loadBooking(ref: string): Promise<PublicBooking | null> {
  if (hasDatabaseUrl()) {
    try {
      return await lookupPublicStayBookingOnNeon(ref);
    } catch {
      // fall through to Nest rewrite
    }
  }
  return publicApiFetch<PublicBooking>(
    `/v1/public/stays/bookings/lookup?referenceCode=${encodeURIComponent(ref)}`,
    8,
  ).catch(() => null);
}

export default async function StayBookingConfirmedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isStaysPublicSurfaceEnabled()) notFound();
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const ar = locale === 'ar';

  const refRaw = query.ref;
  const ref =
    typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  if (!ref) notFound();

  const booking = await loadBooking(ref);
  if (!booking) notFound();

  return (
    <div className="container section stays-booking-confirmed">
      <RememberStayTripAlert
        id={booking.id ?? booking.referenceCode}
        referenceCode={booking.referenceCode}
        status={booking.status}
        {...(booking.checkInOn ? { checkInOn: booking.checkInOn } : {})}
        {...(booking.checkOutOn ? { checkOutOn: booking.checkOutOn } : {})}
        {...(booking.currency ? { currency: booking.currency } : {})}
        {...(booking.totalMinor ? { totalMinor: booking.totalMinor } : {})}
      />
      <section className="stays-checkout stays-checkout--wizard stays-booking-confirmed__shell">
        <h1 id="stays-booking-confirmed-title">
          {ar ? 'تم استلام حجزك' : 'Your booking is received'}
        </h1>
        <p className="muted stays-checkout__hint">
          {booking.status === 'confirmed' || booking.status === 'paid'
            ? ar
              ? 'تم تأكيد الحجز والدفع.'
              : 'Booking and payment are confirmed.'
            : ar
              ? 'الحجز مسجّل. أكمل الدفع لتأكيد الإقامة.'
              : 'Booking is registered. Complete payment to confirm your stay.'}
        </p>

        <div className="stays-checkout__panel">
          <dl className="stays-checkout__summary">
            <div>
              <dt>{ar ? 'مرجع الحجز' : 'Booking reference'}</dt>
              <dd dir="ltr">
                <strong>{booking.referenceCode}</strong>
              </dd>
            </div>
            {booking.guestDisplayName ? (
              <div>
                <dt>{ar ? 'الضيف' : 'Guest'}</dt>
                <dd>{booking.guestDisplayName}</dd>
              </div>
            ) : null}
            {booking.checkInOn ? (
              <div>
                <dt>{ar ? 'الوصول' : 'Check-in'}</dt>
                <dd dir="ltr">{booking.checkInOn}</dd>
              </div>
            ) : null}
            {booking.checkOutOn ? (
              <div>
                <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
                <dd dir="ltr">{booking.checkOutOn}</dd>
              </div>
            ) : null}
            {booking.totalMinor && booking.currency ? (
              <div>
                <dt>{ar ? 'المجموع' : 'Total'}</dt>
                <dd dir="ltr">
                  <strong>{formatMoney(booking.totalMinor, booking.currency, locale)}</strong>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>{ar ? 'الحالة' : 'Status'}</dt>
              <dd>
                {booking.status === 'payment_pending' || booking.status === 'request_pending'
                  ? ar
                    ? 'بانتظار الدفع'
                    : 'Awaiting payment'
                  : booking.status === 'confirmed' || booking.status === 'paid'
                    ? ar
                      ? 'مؤكّد'
                      : 'Confirmed'
                    : booking.status}
              </dd>
            </div>
          </dl>

          <div className="stays-checkout__nav">
            <Link className="button button--quiet" href={`/guest/stays?ref=${encodeURIComponent(ref)}`}>
              {ar ? 'متابعة رحلتي' : 'Track my trip'}
            </Link>
            <Link className="button button--primary" href="/stays">
              {ar ? 'ابحث عن إقامة أخرى' : 'Search another stay'}
            </Link>
          </div>
          <p className="muted stays-booking-confirmed__review-hint">
            {ar
              ? 'بعد انتهاء الإقامة سيظهر لك طلب تقييم بأسلوب Booking.com من صفحة رحلاتي وصفحة الإقامة.'
              : 'After checkout ends, a Booking.com-style review invite appears on My trips and the stay page.'}
          </p>
        </div>
      </section>
    </div>
  );
}
