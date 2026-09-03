import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { verifySessionToken } from '@bhd-r/authz';
import { Link } from '@/i18n/navigation';
import {
  StayBookingContract,
  type StayBookingContractData,
} from '@/components/stays/stay-booking-contract';
import { StayReceiptPrintButton } from '@/components/stays/stay-receipt-print-button';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
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

export default async function OwnerStayBookingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; bookingId: string }>;
}) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale, bookingId } = await params;
  const booking = await loadContract(bookingId);
  if (!booking) notFound();
  const ar = locale === 'ar';

  return (
    <StaysPortalPage locale={locale} portal="owner" section="bookings">
      <p className="stay-contract-nav">
        <Link className="text-link" href="/owner/stays/bookings">
          {ar ? '← العودة للحجوزات' : '← Back to bookings'}
        </Link>
      </p>
      <div className="stay-contract-toolbar">
        <StayReceiptPrintButton locale={locale} />
      </div>
      <StayBookingContract booking={booking} locale={locale} portal="owner" />
    </StaysPortalPage>
  );
}
