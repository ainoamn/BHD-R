import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { verifySessionToken } from '@bhd-r/authz';
import {
  StayOpsBookingsTable,
  type OpsStayBooking,
} from '@/components/stays/stay-ops-bookings-table';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { listOwnerStayBookingsOnNeon } from '@/lib/owner-stays-ops-neon';
import { requireSessionSecret } from '@/lib/runtime-env';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { apiFetch } from '@/lib/server-api';

async function loadBookings(): Promise<OpsStayBooking[]> {
  if (hasDatabaseUrl()) {
    try {
      const token = (await cookies()).get('bhd_r_session')?.value;
      if (token) {
        const claims = await verifySessionToken(token, requireSessionSecret());
        return (await listOwnerStayBookingsOnNeon(claims, { limit: 50 })).items;
      }
    } catch {
      /* fall through to Nest */
    }
  }

  const bookings = await apiFetch<{ items: OpsStayBooking[] }>('/v1/stays/bookings?limit=50').catch(
    () => ({ items: [] as OpsStayBooking[] }),
  );
  return bookings.items ?? [];
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  const items = await loadBookings();

  return (
    <StaysPortalPage locale={locale} portal="developer" section="bookings">
      <p className="muted">
        {locale === 'ar' ? 'حجوزات يومية' : 'Daily bookings'}: <strong>{items.length}</strong>
      </p>
      <StayOpsBookingsTable locale={locale} items={items} />
    </StaysPortalPage>
  );
}
