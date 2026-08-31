import { PortalNav } from './portal-nav';
import { NestKeepAlive } from './nest-keep-alive';
import { NavigationProgress } from './navigation-progress';
import { PortalRoutePrefetch } from './portal-route-prefetch';
import { PortalMainSlot } from './portal-main-slot';
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
  return (
    <div className="portal-layout">
      <NavigationProgress />
      <PortalRoutePrefetch portal={portal} />
      <NestKeepAlive />
      <PortalNav portal={portal} viewer={viewer} />
      <div className="portal-main">
        <PortalMainSlot portal={portal} locale={loc}>
          {children}
        </PortalMainSlot>
      </div>
    </div>
  );
}
