import { cookies } from 'next/headers';
import { LiveSync } from './live-sync';
import { PortalNav } from './portal-nav';
import { NestKeepAlive } from './nest-keep-alive';
import { NavigationProgress } from './navigation-progress';
import { PortalRoutePrefetch } from './portal-route-prefetch';
import { PortalMainSlot } from './portal-main-slot';
import { canOpenSection, lawyerParty } from '@/lib/portal-access';
import { opsSectionsForPortal } from '@/lib/portal-ops-types';
import { PORTAL_NAV_COOKIE } from '@/lib/portal-nav-state';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { requirePortalShell } from '@/lib/viewer';
import type { PortalRole } from '@/lib/types';

export async function PortalShell({
  locale,
  portal,
  children,
}: {
  locale: string;
  portal: PortalRole;
  children: React.ReactNode;
}) {
  const viewer = await requirePortalShell(locale, portal);
  const loc = locale === 'en' ? 'en' : 'ar';
  const staysEnabled = (portal === 'owner' || portal === 'developer') && isStaysPlatformEnabled();
  const navCollapsed = (await cookies()).get(PORTAL_NAV_COOKIE)?.value === 'collapsed';
  const sections = opsSectionsForPortal(portal).filter((section) =>
    canOpenSection(viewer, portal, section),
  );
  return (
    <div className="portal-layout" data-portal={portal}>
      <NavigationProgress />
      <PortalRoutePrefetch portal={portal} staysEnabled={staysEnabled} sections={sections} />
      <NestKeepAlive />
      <LiveSync />
      <PortalNav
        portal={portal}
        viewer={viewer}
        staysEnabled={staysEnabled}
        initialCollapsed={navCollapsed}
      />
      <div className="portal-main">
        <PortalMainSlot
          key={`${viewer.id}:${viewer.organizationId}:${portal}:${loc}`}
          portal={portal}
          locale={loc}
          sections={sections}
          legalManage={viewer.permissions.includes('legal.manage')}
          lawyer={Boolean(lawyerParty(viewer))}
        >
          {children}
        </PortalMainSlot>
      </div>
    </div>
  );
}
