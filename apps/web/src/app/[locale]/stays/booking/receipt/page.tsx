import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { StayReceiptPrintButton } from '@/components/stays/stay-receipt-print-button';
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
  guestEmail?: string | null;
  adults?: number | null;
  children?: number | null;
  stayType?: string | null;
};

function stayTypeLabel(type: string | null | undefined, ar: boolean): string {
  if (type === 'day_use') return ar ? 'إقامة بدون مبيت' : 'Day use';
  if (type === 'overnight_only') return ar ? 'مبيت فقط' : 'Overnight only';
  if (type === 'overnight_stay') return ar ? 'إقامة مع مبيت' : 'Stay with overnight';
  return type ?? '—';
}

async function loadBooking(ref: string): Promise<PublicBooking | null> {
  if (hasDatabaseUrl()) {
    try {
      return await lookupPublicStayBookingOnNeon(ref);
    } catch {
      /* fall through */
    }
  }
  return publicApiFetch<PublicBooking>(
    `/v1/public/stays/bookings/lookup?referenceCode=${encodeURIComponent(ref)}`,
    8,
  ).catch(() => null);
}

export default async function StayBookingReceiptPage({
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

  const stayTone =
    booking.stayType === 'day_use' || booking.stayType === 'overnight_only'
      ? booking.stayType
      : 'overnight_stay';

  return (
    <div className="container section stays-booking-receipt">
      <div className="stays-booking-receipt__actions">
        <StayReceiptPrintButton locale={locale} />
        <Link
          className="button button--quiet"
          href={`/stays/booking/confirmed?ref=${encodeURIComponent(ref)}`}
        >
          {ar ? 'العودة للتأكيد' : 'Back to confirmation'}
        </Link>
      </div>

      <article className="stays-booking-receipt__sheet stays-checkout__panel" id="stay-receipt">
        <p className="muted" style={{ margin: 0 }}>
          BHD R — A BHD Product
        </p>
        <h1>{ar ? 'إيصال دفع حجز إقامة' : 'Stay booking payment receipt'}</h1>
        <p className="muted stays-checkout__hint">
          {booking.status === 'confirmed' || booking.status === 'paid'
            ? ar
              ? 'تم استلام الدفع وتأكيد الحجز.'
              : 'Payment received and booking confirmed.'
            : ar
              ? 'الحجز مسجّل — بانتظار اكتمال الدفع.'
              : 'Booking registered — awaiting payment completion.'}
        </p>

        <dl className="stays-checkout__summary">
          <div>
            <dt>{ar ? 'مرجع الحجز' : 'Reference'}</dt>
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
          {booking.guestEmail ? (
            <div>
              <dt>{ar ? 'البريد' : 'Email'}</dt>
              <dd dir="ltr">{booking.guestEmail}</dd>
            </div>
          ) : null}
          {booking.checkInOn ? (
            <div>
              <dt>{ar ? 'الوصول' : 'Check-in'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--check-in" dir="ltr">
                {booking.checkInOn}
              </dd>
            </div>
          ) : null}
          {booking.checkOutOn ? (
            <div>
              <dt>{ar ? 'المغادرة' : 'Check-out'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--check-out" dir="ltr">
                {booking.checkOutOn}
              </dd>
            </div>
          ) : null}
          {booking.stayType ? (
            <div>
              <dt>{ar ? 'نوع الحجز' : 'Stay type'}</dt>
              <dd className={`stays-checkout__chip stays-checkout__chip--stay-${stayTone}`}>
                {stayTypeLabel(booking.stayType, ar)}
              </dd>
            </div>
          ) : null}
          {typeof booking.adults === 'number' ? (
            <div>
              <dt>{ar ? 'بالغون' : 'Adults'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--adults">{booking.adults}</dd>
            </div>
          ) : null}
          {typeof booking.children === 'number' ? (
            <div>
              <dt>{ar ? 'أطفال' : 'Children'}</dt>
              <dd className="stays-checkout__chip stays-checkout__chip--children">
                {booking.children}
              </dd>
            </div>
          ) : null}
          {typeof booking.nights === 'number' ? (
            <div>
              <dt>{ar ? 'الليالي' : 'Nights'}</dt>
              <dd>
                {booking.nights} {ar ? 'ليلة' : 'nights'}
              </dd>
            </div>
          ) : null}
          {booking.totalMinor && booking.currency ? (
            <div>
              <dt>{ar ? 'المبلغ المدفوع' : 'Amount paid'}</dt>
              <dd dir="ltr">
                <strong>{formatMoney(booking.totalMinor, booking.currency, locale)}</strong>
              </dd>
            </div>
          ) : null}
        </dl>
      </article>
    </div>
  );
}
