import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './server-api';
import type { PortalRole, Viewer } from './types';

export async function getViewer(): Promise<Viewer | null> {
  try {
    const user = await apiFetch<Omit<Viewer, 'portals'> & { portals?: PortalRole[] }>('/v1/me');
    const portalSet = new Set<PortalRole>(user.portals ?? []);
    if (user.roles.some((role) => role === 'platform_admin' || role === 'platform_support'))
      portalSet.add('platform');
    if (user.roles.includes('developer_admin')) portalSet.add('developer');
    if (user.roles.includes('tenant')) portalSet.add('tenant');
    if (
      user.roles.some((role) =>
        [
          'organization_owner',
          'organization_admin',
          'property_manager',
          'finance_manager',
          'maintenance_agent',
          'auditor',
        ].includes(role),
      )
    )
      portalSet.add('owner');
    return { ...user, portals: [...portalSet] };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function requirePortal(locale: string, portal: PortalRole): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/${locale}/login`);
  if (!viewer.portals.includes(portal)) redirect(`/${locale}/portal?denied=${portal}`);
  return viewer;
}
