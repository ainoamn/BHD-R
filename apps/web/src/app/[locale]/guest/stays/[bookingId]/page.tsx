import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { ApiError, apiFetch, publicApiFetch } from '@/lib/server-api';
import { getViewer } from '@/lib/viewer';

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
};

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

  if (!booking && referenceCode) {
    booking = await publicApiFetch<GuestBooking>(
      `/v1/public/stays/bookings/lookup?referenceCode=${encodeURIComponent(referenceCode)}`,
      8,
    ).catch(() => null);
    if (booking && booking.id !== bookingId) booking = null;
  }

  if (!booking) notFound();

  return (
    <main className="section guest-stays guest-stays--detail">
      <div className="container">
        <p>
          <Link className="text-link" href="/guest/stays">
            {ar ? '← رحلاتي' : '← My trips'}
          </Link>
        </p>
        <header className="section-heading">
          <div>
            <span className="section-kicker">BHD R</span>
            <h1 dir="ltr">{booking.referenceCode}</h1>
            <p className="muted">
              {ar ? 'حالة الحجز' : 'Booking status'}:{' '}
              <strong dir="ltr">{booking.status}</strong>
            </p>
          </div>
        </header>
        <article className="ops-panel">
          <p>
            {ar ? 'الوصول' : 'Check-in'}: <strong dir="ltr">{booking.checkInOn}</strong>
          </p>
          <p>
            {ar ? 'المغادرة' : 'Check-out'}: <strong dir="ltr">{booking.checkOutOn}</strong>
          </p>
          {booking.nights != null ? (
            <p>
              {ar ? 'الليالي' : 'Nights'}: <strong>{booking.nights}</strong>
            </p>
          ) : null}
          <p>
            {ar ? 'المبلغ' : 'Total'}:{' '}
            <strong dir="ltr">
              {booking.currency} {booking.totalMinor}
            </strong>
          </p>
          {booking.bookingMode ? (
            <p>
              {ar ? 'نمط الحجز' : 'Mode'}: <strong dir="ltr">{booking.bookingMode}</strong>
            </p>
          ) : null}
          {booking.timezone ? (
            <p className="muted" dir="ltr">
              {booking.timezone}
            </p>
          ) : null}
        </article>
      </div>
    </main>
  );
}
