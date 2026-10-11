import { notFound, redirect } from 'next/navigation';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { lookupPublicStayBookingOnNeon } from '@/lib/public-stays-guest-neon';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';
import { publicApiFetch } from '@/lib/server-api';

type PublicBooking = { id?: string; referenceCode: string };

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

/**
 * Landing URL after booking, payment and e-sign (also linked from emails).
 * The guest stay page is the single view of a booking, so this only forwards to it.
 */
export default async function StayBookingConfirmedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isStaysPublicSurfaceEnabled()) notFound();
  const { locale: raw } = await params;
  const locale = raw === 'en' ? 'en' : 'ar';
  const query = await searchParams;
  const refRaw = query.ref;
  const ref = typeof refRaw === 'string' ? refRaw : Array.isArray(refRaw) ? refRaw[0] : undefined;
  if (!ref) notFound();

  const booking = await loadBooking(ref);
  if (!booking) notFound();

  const refQuery = encodeURIComponent(booking.referenceCode);
  if (!booking.id) redirect(`/${locale}/guest/stays?ref=${refQuery}`);
  redirect(`/${locale}/guest/stays/${encodeURIComponent(booking.id)}?ref=${refQuery}&welcome=1`);
}
