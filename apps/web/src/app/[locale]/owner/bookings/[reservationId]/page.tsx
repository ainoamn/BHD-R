import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { notFound } from 'next/navigation';
import {
  LeaseReservationDetail,
  reservationPermissions,
} from '@/components/lease-reservation-detail';
import {
  ReservationComplianceManager,
  type ReservationCompliance,
} from '@/components/reservation-compliance-manager';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readClaims } from '@/lib/portal-ops-data';
import { loadLeaseBookingForStaff } from '@/lib/public-lease-booking-neon';
import { ApiError, apiFetch } from '@/lib/server-api';
import { requirePortal } from '@/lib/viewer';

async function Page({ params }: { params: Promise<{ locale: string; reservationId: string }> }) {
  const { locale: rawLocale, reservationId } = await params;
  const locale = rawLocale === 'en' ? 'en' : 'ar';
  await requirePortal(locale, 'owner');

  const claims = hasDatabaseUrl() ? await readClaims() : null;
  const booking = claims
    ? await loadLeaseBookingForStaff(claims, reservationId).catch(() => null)
    : null;
  if (booking && claims) {
    return (
      <LeaseReservationDetail
        booking={booking}
        locale={locale}
        portal="owner"
        permissions={reservationPermissions(claims)}
      />
    );
  }

  try {
    const compliance = await apiFetch<ReservationCompliance>(
      `/v1/leasing/reservations/${encodeURIComponent(reservationId)}/compliance`,
    );
    return <ReservationComplianceManager compliance={compliance} locale={locale} portal="owner" />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    const ar = locale === 'ar';
    return (
      <div className="form-shell">
        <p className="notice notice--error" role="alert">
          {ar
            ? 'تعذّر تحميل ملف هذا الحجز الآن. أعد المحاولة بعد قليل.'
            : 'This booking could not be loaded right now. Please try again shortly.'}
        </p>
        <a className="button button--quiet" href={`/${locale}/owner/bookings`}>
          {ar ? 'العودة للحجوزات' : 'Back to bookings'}
        </a>
      </div>
    );
  }
}

export default persistentPortalPage('/owner/bookings/[reservationId]', Page);
