import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { verifySessionToken, type SessionClaims } from '@bhd-r/authz';
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
import {
  canDecideDepositRefunds,
  canPayDepositRefunds,
} from '@/lib/stay-deposit-refund-neon';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';

async function loadPage(bookingId: string): Promise<{
  booking: StayBookingContractData;
  canRefer: boolean;
  canDecide: boolean;
} | null> {
  if (!hasDatabaseUrl()) return null;
  try {
    const token = (await cookies()).get('bhd_r_session')?.value;
    if (!token) return null;
    const claims: SessionClaims = await verifySessionToken(token, requireSessionSecret());
    const booking = await getOwnerStayBookingContractOnNeon(claims, bookingId);
    if (!booking) return null;
    return {
      booking,
      canRefer: canDecideDepositRefunds(claims),
      canDecide: canPayDepositRefunds(claims),
    };
  } catch {
    return null;
  }
}

async function DeveloperStayBookingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; bookingId: string }>;
}) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale, bookingId } = await params;
  const page = await loadPage(bookingId);
  if (!page) notFound();
  const { booking, canRefer, canDecide } = page;
  const badges = await stayBookingBadges(booking);
  const ar = locale === 'ar';

  return (
    <StaysPortalPage locale={locale} portal="developer" section="bookings">
      <div className="stay-booking-sheet">
        <div className="stay-booking-sheet__toolbar stay-booking-sheet__no-print">
          <p className="stay-contract-nav">
            <Link className="text-link" href="/developer/bookings?tab=daily">
              {ar ? '← العودة للحجوزات' : '← Back to bookings'}
            </Link>
          </p>
          <div className="stay-contract-toolbar">
            <StayReceiptPrintButton locale={locale} />
          </div>
        </div>

        <StayBookingContract booking={booking} locale={locale} portal="developer" badges={badges} />

        <div className="stay-booking-sheet__tools stay-booking-sheet__no-print">
          <h2 className="stay-booking-sheet__tools-title">
            {ar ? 'أدوات التشغيل' : 'Operations tools'}
          </h2>
          <StayBookingDetailOps
            locale={locale}
            portal="developer"
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
            depositClaims={booking.timeline?.claims ?? []}
            canReferDepositClaims={canRefer}
            canDecideDepositClaims={canDecide}
          />
        </div>
      </div>
    </StaysPortalPage>
  );
}

export default persistentPortalPage(
  '/developer/stays/bookings/[bookingId]',
  DeveloperStayBookingDetailPage,
);
