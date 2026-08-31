import { PortalNav } from './portal-nav';
import { NestKeepAlive } from './nest-keep-alive';
import { NavigationProgress } from './navigation-progress';
import { PortalRoutePrefetch } from './portal-route-prefetch';
import { PortalMainSlot } from './portal-main-slot';
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
  const staysEnabled =
    (portal === 'owner' || portal === 'developer') && isStaysPlatformEnabled();
  return (
    <div className="portal-layout">
      <NavigationProgress />
      <PortalRoutePrefetch portal={portal} staysEnabled={staysEnabled} />
      <NestKeepAlive />
      <PortalNav portal={portal} viewer={viewer} staysEnabled={staysEnabled} />
      <div className="portal-main">
        <PortalMainSlot portal={portal} locale={loc}>
          {children}
        </PortalMainSlot>
      </div>
    </div>
  );
}
