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

async function loadBookings(propertyId?: string): Promise<OpsStayBooking[]> {
  if (hasDatabaseUrl()) {
    try {
      const token = (await cookies()).get('bhd_r_session')?.value;
      if (token) {
        const claims = await verifySessionToken(token, requireSessionSecret());
        return (
          await listOwnerStayBookingsOnNeon(claims, {
            limit: 50,
            ...(propertyId ? { propertyId } : {}),
          })
        ).items;
      }
    } catch {
      /* fall through to Nest */
    }
  }

  const qs = new URLSearchParams({ limit: '50' });
  if (propertyId) qs.set('propertyId', propertyId);
  const bookings = await apiFetch<{ items: OpsStayBooking[] }>(
    `/v1/stays/bookings?${qs.toString()}`,
  ).catch(() => ({ items: [] as OpsStayBooking[] }));
  return bookings.items ?? [];
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ propertyId?: string | string[] }>;
}) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  const query = await searchParams;
  const propertyId = typeof query.propertyId === 'string' ? query.propertyId : undefined;
  const items = await loadBookings(propertyId);
  const ar = locale === 'ar';

  return (
    <StaysPortalPage locale={locale} portal="developer" section="bookings">
      <div className="stays-bookings-intro">
        <div>
          <h2 className="stays-bookings-intro__title">{ar ? 'لوحة الحجوزات' : 'Bookings desk'}</h2>
          <p className="muted">
            {propertyId
              ? ar
                ? 'حجوزات هذا العقار فقط — راجع الطلبات وافتح عقد كل حجز.'
                : 'Bookings for this property only — review requests and open each contract.'
              : ar
                ? 'راجع الطلبات، تابع الوصول والمغادرة، وافتح عقد كل حجز من مكان واحد.'
                : 'Review requests, track arrivals and departures, and open each booking contract from one place.'}
          </p>
        </div>
      </div>
      <StayOpsBookingsTable locale={locale} portal="developer" items={items} />
    </StaysPortalPage>
  );
}
