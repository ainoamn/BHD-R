import type { PortalRole } from '@/lib/types';

/** Sidebar paths (relative to /{portal}) — keep in sync with portal-nav.tsx */
const PORTAL_PATHS: Record<PortalRole, string[]> = {
  platform: ['', '/organizations', '/users', '/audit', '/reports', '/settings'],
  owner: [
    '',
    '/properties',
    '/contacts',
    '/requests',
    '/bookings',
    '/leasing',
    '/sales',
    '/contracts',
    '/invoices',
    '/payments',
    '/accounting',
    '/expenses',
    '/maintenance',
    '/work-orders',
    '/tasks',
    '/legal',
    '/approvals',
    '/reports',
    '/team',
    '/api-keys',
  ],
  developer: [
    '',
    '/properties',
    '/contacts',
    '/requests',
    '/bookings',
    '/leasing',
    '/sales',
    '/contracts',
    '/invoices',
    '/payments',
    '/accounting',
    '/expenses',
    '/maintenance',
    '/work-orders',
    '/tasks',
    '/legal',
    '/approvals',
    '/reports',
    '/team',
    '/api-keys',
  ],
  tenant: [
    '',
    '/leases',
    '/reservations',
    '/contracts',
    '/invoices',
    '/payments',
    '/maintenance',
    '/requests',
  ],
};

const STAYS_PATHS = ['/stays', '/stays/calendar', '/stays/bookings', '/stays/rates', '/stays/setup'];

export function portalNavHrefs(portal: PortalRole, staysEnabled = false): string[] {
  const base = PORTAL_PATHS[portal].map((path) => `/${portal}${path}`);
  if (!staysEnabled || (portal !== 'owner' && portal !== 'developer')) return base;
  return [...base, ...STAYS_PATHS.map((path) => `/${portal}${path}`)];
}
