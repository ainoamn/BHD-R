import { notFound } from 'next/navigation';
import {
  StayOpsCalendarPanel,
  type StayCalendarUnit,
} from '@/components/stays/stay-ops-calendar-panel';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { apiFetch } from '@/lib/server-api';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  const units = await apiFetch<{ items: StayCalendarUnit[] }>('/v1/stays/calendar-units').catch(
    () => ({ items: [] as StayCalendarUnit[] }),
  );

  return (
    <StaysPortalPage locale={locale} portal="developer" section="calendar">
      <StayOpsCalendarPanel locale={locale} items={units.items ?? []} />
    </StaysPortalPage>
  );
}
