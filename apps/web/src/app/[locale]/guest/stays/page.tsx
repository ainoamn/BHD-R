import type { Metadata } from 'next';
import { EmptyState } from '@bhd-r/ui';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { GuestStayLookup } from '@/components/stays/guest-stay-lookup';
import { GuestPendingStayReviews } from '@/components/stays/guest-pending-stay-reviews';
import { Link } from '@/i18n/navigation';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { listGuestStayBookingsOnNeon } from '@/lib/public-stays-guest-neon';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { ApiError, apiFetch } from '@/lib/server-api';
import { getViewer } from '@/lib/viewer';
import { formatMoney } from '@/lib/format';
import { stayStatusLabel } from '@/lib/stay-trip-alerts';

type GuestBooking = {
  id: string;
  referenceCode: string;
  checkInOn: string;
  checkOutOn: string;
  status: string;
  currency: string;
  totalMinor: string;
  nights?: number;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: locale === 'ar' ? 'رحلاتي' : 'My trips',
    robots: { index: false, follow: false },
  };
}

/** Guest trips — list claimed bookings + public reference lookup. */
export default async function GuestStaysPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  if (!isStaysPlatformEnabled()) notFound();
  const ar = locale === 'ar';
  const query = await searchParams;
  const refRaw = query.ref;
  const initialReference =
    typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;

  const viewer = await getViewer();
  let items: GuestBooking[] = [];
  if (viewer) {
    if (hasDatabaseUrl()) {
      try {
        const listed = await listGuestStayBookingsOnNeon(viewer.id);
        items = listed.items ?? [];
      } catch {
        items = [];
      }
    } else {
      const listed = await apiFetch<{ items: GuestBooking[] }>('/v1/guest/stays/bookings').catch(
        (error: unknown) => {
          if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
            return { items: [] as GuestBooking[] };
          }
          return { items: [] as GuestBooking[] };
        },
      );
      items = listed.items ?? [];
    }
  }

  return (
    <main className="section guest-stays">
      <div className="container">
        <header className="section-heading">
          <div>
            <span className="section-kicker">BHD R</span>
            <h1>{ar ? 'رحلاتي / إقاماتي' : 'My trips / stays'}</h1>
            <p className="muted">
              {ar
                ? 'ابحث بمرجع الحجز من صفحة الإعلان، أو اعرض الحجوزات المرتبطة بحسابك.'
                : 'Look up a booking reference from the listing checkout, or view trips linked to your account.'}
            </p>
          </div>
        </header>

        <GuestStayLookup
          locale={locale}
          {...(initialReference ? { initialReference } : {})}
          canClaim={Boolean(viewer)}
        />

        {viewer ? (
          <GuestPendingStayReviews locale={locale} />
        ) : null}

        <section className="guest-stays__list" aria-labelledby="guest-trips-title">
          <h2 id="guest-trips-title">{ar ? 'حجوزاتي' : 'My bookings'}</h2>
          {!viewer ? (
            <p className="muted">
              {ar ? 'سجّل الدخول لعرض الحجوزات المرتبطة بحسابك.' : 'Sign in to see bookings linked to your account.'}
            </p>
          ) : items.length ? (
            <div className="ops-panel data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{ar ? 'المرجع' : 'Reference'}</th>
                    <th>{ar ? 'التواريخ' : 'Dates'}</th>
                    <th>{ar ? 'الحالة' : 'Status'}</th>
                    <th>{ar ? 'المبلغ' : 'Amount'}</th>
                    <th>{ar ? 'تفاصيل' : 'Details'}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((booking) => (
                    <tr key={booking.id}>
                      <td dir="ltr">{booking.referenceCode}</td>
                      <td dir="ltr">
                        {booking.checkInOn} → {booking.checkOutOn}
                      </td>
                      <td>{stayStatusLabel(booking.status, ar)}</td>
                      <td dir="ltr">{formatMoney(booking.totalMinor, booking.currency, locale)}</td>
                      <td>
                        <Link
                          className="ops-action"
                          href={`/guest/stays/${booking.id}?ref=${encodeURIComponent(booking.referenceCode)}`}
                        >
                          {ar ? 'عرض' : 'View'}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title={ar ? 'لا حجوزات مرتبطة بعد' : 'No linked bookings yet'}
              description={
                ar
                  ? 'بعد الحجز العام، ابحث بالمرجع ثم اربط الحجز بحسابك.'
                  : 'After a public booking, look up the reference and claim it to your account.'
              }
            />
          )}
        </section>
      </div>
    </main>
  );
}
