import { notFound } from 'next/navigation';
import { StayPerformancePanel, type StayPerformanceMetrics } from '@/components/stays/stay-performance-panel';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { apiFetch } from '@/lib/server-api';

function defaultRange(): { fromOn: string; toOn: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 30);
  return {
    fromOn: from.toISOString().slice(0, 10),
    toOn: to.toISOString().slice(0, 10),
  };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  const { fromOn, toOn } = defaultRange();
  const health = await apiFetch<{ ok?: boolean }>('/v1/stays/inventory/health').catch(() => null);
  const metrics = await apiFetch<StayPerformanceMetrics>(
    `/v1/stays/reports/performance?fromOn=${encodeURIComponent(fromOn)}&toOn=${encodeURIComponent(toOn)}`,
  ).catch(() => null);

  return (
    <StaysPortalPage locale={locale} portal="developer" section="dashboard">
      <ul className="stays-portal__stats">
        <li>
          <span>{locale === 'ar' ? 'حالة الواجهة' : 'API status'}</span>
          <strong dir="ltr">{health ? 'reachable' : 'offline / gated'}</strong>
        </li>
      </ul>
      <h2 className="stays-performance__title">
        {locale === 'ar' ? 'أداء 30 يوماً' : 'Last 30 days performance'}
      </h2>
      <StayPerformancePanel locale={locale} metrics={metrics} />
    </StaysPortalPage>
  );
}
