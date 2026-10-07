import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { StayEsignWizard } from '@/components/stays/stay-esign-wizard';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { buildLeaseContractHtml, leaseContractTitle } from '@/lib/lease-booking-contract';
import { leaseConfirmedPath, leaseSignPath } from '@/lib/lease-booking-paths';
import { loadLeaseBookingForViewer, leasePaymentPath } from '@/lib/public-lease-booking-neon';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign contract | توقيع العقد',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function LeaseBookingSignPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  setRequestLocale(locale);
  const query = await searchParams;
  const refRaw = query.ref;
  const referenceCode =
    typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  if (!referenceCode || !hasDatabaseUrl()) notFound();

  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/${locale}/login?next=${encodeURIComponent(leaseSignPath(locale, referenceCode))}`);
  }

  const booking = await loadLeaseBookingForViewer(viewer.id, referenceCode).catch(() => null);
  if (!booking) notFound();
  if (!booking.depositPaidAt) {
    if (booking.status === 'pending') {
      redirect(leasePaymentPath(locale, booking.sessionReference, booking.referenceCode));
    }
    notFound();
  }

  return (
    <main className="stay-esign-shell">
      <StayEsignWizard
        locale={locale}
        referenceCode={booking.referenceCode}
        contractHtml={buildLeaseContractHtml(booking, locale)}
        initiallyComplete={Boolean(booking.esignSignedAt)}
        submitUrl={`/api/public/bookings/deposits/${encodeURIComponent(booking.referenceCode)}/esign`}
        continuePath={leaseConfirmedPath(locale, booking.referenceCode)}
        contractTitle={leaseContractTitle(booking.mode)}
        requireCsrf
      />
    </main>
  );
}
