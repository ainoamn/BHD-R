import { persistentPortalPage } from '@/lib/persistent-portal-page';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { verifySessionToken } from '@bhd-r/authz';
import {
  StayOpsCalendarPanel,
  type StayCalendarUnit,
} from '@/components/stays/stay-ops-calendar-panel';
import { StaysPortalPage } from '@/components/stays/stays-portal-page';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { listOwnerStayCalendarUnitsOnNeon } from '@/lib/owner-stays-ops-neon';
import { requireSessionSecret } from '@/lib/runtime-env';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { apiFetch } from '@/lib/server-api';

async function loadUnits(): Promise<StayCalendarUnit[]> {
  if (hasDatabaseUrl()) {
    try {
      const token = (await cookies()).get('bhd_r_session')?.value;
      if (token) {
        const claims = await verifySessionToken(token, requireSessionSecret());
        return (await listOwnerStayCalendarUnitsOnNeon(claims)).items;
      }
    } catch {
      /* fall through */
    }
  }

  const units = await apiFetch<{ items: StayCalendarUnit[] }>('/v1/stays/calendar-units').catch(
    () => ({ items: [] as StayCalendarUnit[] }),
  );
  return units.items ?? [];
}

async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ unitId?: string; view?: string }>;
}) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  const { unitId, view } = await searchParams;
  const items = await loadUnits();

  return (
    <StaysPortalPage locale={locale} portal="developer" section="calendar">
      <StayOpsCalendarPanel
        key={`${unitId ?? 'all'}:${view ?? ''}`}
        locale={locale}
        items={items}
        portal="developer"
        initialUnitId={unitId ?? null}
        initialView={view === 'prices' ? 'prices' : 'bookings'}
      />
    </StaysPortalPage>
  );
}

export default persistentPortalPage('/developer/stays/calendar', Page);
