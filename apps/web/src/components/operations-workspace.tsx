import { getLocale } from 'next-intl/server';
import type { PortalRole } from '@/lib/types';
import type { OperationsSection } from '@/lib/portal-ops-types';
import { OperationsWorkspaceClient } from './operations-workspace-client';

export type { OperationsSection } from '@/lib/portal-ops-types';

/**
 * Ops pages no longer await Nest/Neon in the RSC tree — the client paints from
 * memory cache (warmed on portal idle) so soft nav feels SPA-like.
 */
export async function OperationsWorkspace({
  portal,
  section,
}: {
  portal: PortalRole;
  section: OperationsSection;
}) {
  const locale = (await getLocale()) === 'en' ? 'en' : 'ar';
  return <OperationsWorkspaceClient portal={portal} section={section} locale={locale} />;
}
