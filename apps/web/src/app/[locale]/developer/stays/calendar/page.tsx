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

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  if (!isStaysPlatformEnabled()) notFound();
  const { locale } = await params;
  const items = await loadUnits();

  return (
    <StaysPortalPage locale={locale} portal="developer" section="calendar">
      <StayOpsCalendarPanel locale={locale} items={items} />
    </StaysPortalPage>
  );
}
