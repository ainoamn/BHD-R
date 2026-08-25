import { PortalNav } from './portal-nav';
import { NestKeepAlive } from './nest-keep-alive';
import { requirePortal } from '@/lib/viewer';
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
  const viewer = await requirePortal(locale, portal);
  return (
    <div className="portal-layout">
      <NestKeepAlive />
      <PortalNav portal={portal} viewer={viewer} />
      <div className="portal-main">{children}</div>
    </div>
  );
}
