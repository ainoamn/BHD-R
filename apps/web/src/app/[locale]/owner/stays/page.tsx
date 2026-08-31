import { notFound } from 'next/navigation';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { apiFetch } from '@/lib/server-api';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  const health = await apiFetch<{ ok?: boolean }>('/v1/stays/inventory/health').catch(() => null);

  return (
    <StaysPortalPage locale={locale} portal="owner" section="dashboard">
      <ul className="stays-portal__stats">
        <li>
          <span>{locale === 'ar' ? 'حالة الواجهة' : 'API status'}</span>
          <strong dir="ltr">{health ? 'reachable' : 'offline / gated'}</strong>
        </li>
        <li>
          <span>{locale === 'ar' ? 'الحجوزات' : 'Bookings'}</span>
          <strong>—</strong>
        </li>
        <li>
          <span>{locale === 'ar' ? 'الإشغال اليوم' : 'Today occupancy'}</span>
          <strong>—</strong>
        </li>
      </ul>
    </StaysPortalPage>
  );
}
