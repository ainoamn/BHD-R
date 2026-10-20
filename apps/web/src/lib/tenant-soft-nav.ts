export type TenantSpaceView =
  | 'overview'
  | 'bookings'
  | 'contracts'
  | 'leases'
  | 'invoices'
  | 'payments'
  | 'requests';

export const TENANT_SPACE_SECTIONS: Record<string, TenantSpaceView> = {
  reservations: 'bookings',
  contracts: 'contracts',
  leases: 'leases',
  invoices: 'invoices',
  payments: 'payments',
  requests: 'requests',
};

/** Sidebar base paths (relative to /tenant) that soft-switch without remounting. */
export const TENANT_SOFT_BASE_PATHS = new Set([
  '',
  '/reservations',
  '/contracts',
  '/leases',
  '/invoices',
  '/payments',
  '/requests',
]);

export function isTenantSoftBasePath(basePath: string): boolean {
  return TENANT_SOFT_BASE_PATHS.has(basePath);
}

/** Map a locale-stripped or full pathname to a soft tenant view (null = detail / other). */
export function tenantSoftViewFromPath(pathname: string): TenantSpaceView | null {
  const path = pathname.replace(/^\/(ar|en)(?=\/|$)/, '') || pathname;
  if (path === '/tenant' || path === '/tenant/') return 'overview';
  if (!path.startsWith('/tenant/')) return null;
  const rest = path.slice('/tenant/'.length).replace(/\/$/, '');
  if (!rest || rest.includes('/')) return null;
  if (rest === 'reservations') return 'bookings';
  return TENANT_SPACE_SECTIONS[rest] ?? null;
}

export function tenantPathForView(view: TenantSpaceView): string {
  switch (view) {
    case 'overview':
      return '/tenant';
    case 'bookings':
      return '/tenant/reservations';
    case 'contracts':
      return '/tenant/contracts';
    case 'leases':
      return '/tenant/leases';
    case 'invoices':
      return '/tenant/invoices';
    case 'payments':
      return '/tenant/payments';
    case 'requests':
      return '/tenant/requests';
  }
}
