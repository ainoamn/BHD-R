import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { leaseBookingDocumentPath, leaseSignPath } from '@/lib/lease-booking-paths';
import { readClaims } from '@/lib/portal-ops-data';
import {
  leaseReservationIdForStaff,
  loadLeaseBookingForViewer,
} from '@/lib/public-lease-booking-neon';
import { getViewer } from '@/lib/viewer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Booking document | مستند الحجز',
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Where the booking QR printed on a contract leads: the customer to their signed booking
 * agreement, the landlord's staff to the booking in their portal; anyone else sees nothing.
 */
export default async function LeaseBookingDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const query = await searchParams;
  const refRaw = query.ref;
  const ref = typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  if (!ref || !hasDatabaseUrl()) notFound();

  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/${locale}/login?next=${encodeURIComponent(leaseBookingDocumentPath(locale, ref))}`);
  }

  const own = await loadLeaseBookingForViewer(viewer.id, ref).catch(() => null);
  if (own) redirect(leaseSignPath(locale, own.referenceCode));

  const claims = await readClaims();
  const reservationId = claims
    ? await leaseReservationIdForStaff(claims, ref).catch(() => null)
    : null;
  if (reservationId) redirect(`/${locale}/owner/bookings/${encodeURIComponent(reservationId)}`);
  notFound();
}
