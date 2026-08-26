import { PortalNav } from './portal-nav';
import { NestKeepAlive } from './nest-keep-alive';
import { NavigationProgress } from './navigation-progress';
import { PortalRoutePrefetch } from './portal-route-prefetch';
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
  return (
    <div className="portal-layout">
      <NavigationProgress />
      <PortalRoutePrefetch portal={portal} />
      <NestKeepAlive />
      <PortalNav portal={portal} viewer={viewer} />
      <div className="portal-main">{children}</div>
    </div>
  );
}
