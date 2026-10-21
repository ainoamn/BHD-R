import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { verifySessionToken } from '@bhd-r/authz';
import { Link } from '@/i18n/navigation';
import {
  StayBookingContract,
  type StayBookingContractData,
} from '@/components/stays/stay-booking-contract';
import { StayBookingDetailOps } from '@/components/stays/stay-booking-detail-ops';
import { StayReceiptPrintButton } from '@/components/stays/stay-receipt-print-button';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { stayBookingBadges } from '@/lib/badge-chips-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { getOwnerStayBookingContractOnNeon } from '@/lib/owner-stays-ops-neon';
import { requireSessionSecret } from '@/lib/runtime-env';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';

async function loadContract(bookingId: string): Promise<StayBookingContractData | null> {
  if (!hasDatabaseUrl()) return null;
  try {
    const token = (await cookies()).get('bhd_r_session')?.value;
    if (!token) return null;
    const claims = await verifySessionToken(token, requireSessionSecret());
    return await getOwnerStayBookingContractOnNeon(claims, bookingId);
  } catch {
    return null;
  }
}

async function OwnerStayBookingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; bookingId: string }>;
}) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale, bookingId } = await params;
  const booking = await loadContract(bookingId);
  if (!booking) notFound();
  const badges = await stayBookingBadges(booking);
  const ar = locale === 'ar';

  return (
    <StaysPortalPage locale={locale} portal="owner" section="bookings">
      <div className="stay-booking-sheet">
        <div className="stay-booking-sheet__toolbar stay-booking-sheet__no-print">
          <p className="stay-contract-nav">
            <Link className="text-link" href="/owner/bookings?tab=daily">
              {ar ? '← العودة للحجوزات' : '← Back to bookings'}
            </Link>
          </p>
          <div className="stay-contract-toolbar">
            <StayReceiptPrintButton locale={locale} />
          </div>
        </div>

        <StayBookingContract booking={booking} locale={locale} portal="owner" badges={badges} />

        <div className="stay-booking-sheet__tools stay-booking-sheet__no-print">
          <h2 className="stay-booking-sheet__tools-title">
            {ar ? 'أدوات التشغيل' : 'Operations tools'}
          </h2>
          <StayBookingDetailOps
            locale={locale}
            portal="owner"
            bookingId={booking.id}
            unitId={booking.unitId}
            propertyId={booking.propertyId}
            status={booking.status}
            checkInOn={booking.checkInOn}
            checkOutOn={booking.checkOutOn}
            stayListingSlug={booking.stayListingSlug}
            paidAmountMinor={booking.paidAmountMinor ?? booking.totalMinor}
            paidCurrency={booking.paidCurrency ?? booking.currency}
            paymentSucceeded={
              booking.paymentStatus === 'succeeded' || booking.paymentStatus === 'offline'
            }
            pendingReschedule={booking.pendingReschedule}
            currency={booking.currency}
            stayType={booking.stayType}
          />
        </div>
      </div>
    </StaysPortalPage>
  );
}

export default persistentPortalPage(
  '/owner/stays/bookings/[bookingId]',
  OwnerStayBookingDetailPage,
);
