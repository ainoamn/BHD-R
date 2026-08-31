import { notFound } from 'next/navigation';
import {
  StayOpsBookingsTable,
  type OpsStayBooking,
} from '@/components/stays/stay-ops-bookings-table';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { apiFetch } from '@/lib/server-api';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  const bookings = await apiFetch<{ items: OpsStayBooking[] }>('/v1/stays/bookings?limit=50').catch(
    () => ({ items: [] as OpsStayBooking[] }),
  );
  const items = bookings.items ?? [];

  return (
    <StaysPortalPage locale={locale} portal="developer" section="bookings">
      <p className="muted">
        {locale === 'ar' ? 'حجوزات يومية' : 'Daily bookings'}: <strong>{items.length}</strong>
      </p>
      <StayOpsBookingsTable locale={locale} items={items} />
    </StaysPortalPage>
  );
}
