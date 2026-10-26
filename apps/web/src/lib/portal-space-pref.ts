import type { PortalRole } from '@/lib/types';

/** Last workspace the user picked on /portal (owner / developer / tenant). */
export const PORTAL_SPACE_COOKIE = 'bhd_r_space';

const SPACE_ROLES = new Set<PortalRole>(['owner', 'developer', 'tenant']);

export function parsePortalSpacePref(value: string | undefined | null): PortalRole | null {
  if (!value || !SPACE_ROLES.has(value as PortalRole)) return null;
  return value as PortalRole;
}

export function persistPortalSpacePref(portal: PortalRole): void {
  if (!SPACE_ROLES.has(portal)) return;
  document.cookie = `${PORTAL_SPACE_COOKIE}=${portal}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** Manager portal + tenant: user should pick a space. */
export function needsPortalSpaceChooser(portals: readonly PortalRole[]): boolean {
  const manager = portals.includes('owner') || portals.includes('developer');
  return manager && portals.includes('tenant');
}

export function managerPortalOf(portals: readonly PortalRole[]): 'owner' | 'developer' | null {
  if (portals.includes('owner')) return 'owner';
  if (portals.includes('developer')) return 'developer';
  return null;
}
