import { PortalNav } from './portal-nav';
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
      <PortalNav portal={portal} displayName={viewer.displayName} />
      <div className="portal-main">{children}</div>
    </div>
  );
}
