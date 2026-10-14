/**
 * Who opens which portal and section. Shared by the viewer, the ops routes, the sidebar and the
 * ops loaders so a role added to the team is recognised everywhere at once.
 */
import type { OperationsSection } from '@/lib/portal-ops-types';
import type { PortalRole } from '@/lib/types';

export type PortalAccess = {
  roles: readonly string[];
  permissions: readonly string[];
  partyId: string | null;
};

/** Organization staff who work in the owner portal. */
export const OWNER_PORTAL_ROLES: readonly string[] = [
  'organization_owner',
  'organization_admin',
  'property_manager',
  'finance_manager',
  'maintenance_agent',
  'auditor',
  'admin_staff',
  'building_guard',
  'legal_counsel',
  'custom_member',
  'property_owner',
  'lawyer',
];

/** Roles that see the whole organization; everyone else with a party sees only that party's. */
export const ORG_WIDE_ROLES: ReadonlySet<string> = new Set([
  'organization_owner',
  'organization_admin',
  'property_manager',
  'finance_manager',
  'maintenance_agent',
  'auditor',
  'platform_admin',
  'platform_support',
  'developer_admin',
  'admin_staff',
  'building_guard',
  'legal_counsel',
  'custom_member',
]);

export function portalsForRoles(
  roles: readonly string[],
  { tenantForEveryone = false }: { tenantForEveryone?: boolean } = {},
): PortalRole[] {
  const portalSet = new Set<PortalRole>();
  if (roles.some((role) => role === 'platform_admin' || role === 'platform_support'))
    portalSet.add('platform');
  if (roles.includes('developer_admin')) portalSet.add('developer');
  if (tenantForEveryone || roles.includes('tenant')) portalSet.add('tenant');
  if (roles.some((role) => OWNER_PORTAL_ROLES.includes(role))) portalSet.add('owner');
  return [...portalSet];
}

/** The owner party a building owner is limited to, or null for organization-wide staff. */
export function scopedOwnerParty(access: PortalAccess): string | null {
  if (!access.partyId) return null;
  if (access.roles.some((role) => ORG_WIDE_ROLES.has(role))) return null;
  return access.partyId;
}

/**
 * The lawyer party an external lawyer is limited to: their legal cases are the ones whose lawyer
 * party is this. Null for organization-wide staff and for building owners.
 */
export function lawyerParty(access: PortalAccess): string | null {
  if (!access.roles.includes('lawyer') || access.roles.includes('property_owner')) return null;
  return scopedOwnerParty(access);
}

/** Sections a building owner may open; every one of them filters by their owner party. */
const SCOPED_OWNER_SECTIONS: ReadonlySet<OperationsSection> = new Set(['properties', 'bookings']);

/** Holding any one of these permissions opens the section. */
const SECTION_PERMISSIONS: Readonly<Record<OperationsSection, readonly string[]>> = {
  properties: ['property.read'],
  contacts: ['party.read'],
  requests: ['request.read'],
  bookings: ['stay.booking.read', 'reservation.read', 'viewing.read'],
  leasing: ['lease.read'],
  sales: ['sale.read'],
  contracts: ['contract.read'],
  invoices: ['invoice.read'],
  payments: ['payment.read', 'receipt.read'],
  accounting: ['accounting.read'],
  expenses: ['accounting.read'],
  maintenance: ['maintenance.read'],
  'work-orders': ['work_order.read'],
  tasks: ['task.read'],
  legal: ['legal.read', 'legal.case.read'],
  approvals: ['approval.read'],
  reports: ['report.read'],
  team: ['organization.members.read'],
  'api-keys': ['api_key.read'],
};

/** Permission check alone, for lists that already filter by the owner party. */
export function holdsSectionPermission(access: PortalAccess, section: OperationsSection): boolean {
  return SECTION_PERMISSIONS[section].some((permission) => access.permissions.includes(permission));
}

export function canOpenSection(
  access: PortalAccess,
  portal: PortalRole,
  section: OperationsSection,
): boolean {
  if (portal === 'tenant') return true;
  if (!holdsSectionPermission(access, section)) return false;
  if (lawyerParty(access)) return section === 'legal';
  return !scopedOwnerParty(access) || SCOPED_OWNER_SECTIONS.has(section);
}

/** Owner-portal pages outside the ops sections (stays, terms) and what opens them. */
const PAGE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  '/stays': ['stay.booking.read', 'stay.inventory.manage', 'stay.rate.manage'],
  '/stays/calendar': ['stay.booking.read', 'stay.inventory.manage'],
  '/stays/rates': ['stay.rate.manage'],
  '/stays/setup': ['stay.inventory.manage'],
  '/terms': ['property.update', 'contract.template.read'],
  '/badges': ['party.read', 'property.read', 'organization.members.read'],
  '/properties/new': ['property.create'],
  '/properties/edit': ['property.update'],
  '/properties/terms': ['property.update', 'contract.template.read'],
};

/** Whether a sidebar path (relative to the portal root, query ignored) is open to the viewer. */
export function canOpenPortalPath(access: PortalAccess, portal: PortalRole, path: string): boolean {
  const basePath = path.split('?')[0] ?? '';
  if (!basePath) return true;
  const section = basePath.slice(1) as OperationsSection;
  if (section in SECTION_PERMISSIONS) return canOpenSection(access, portal, section);
  const needed = PAGE_PERMISSIONS[basePath];
  if (!needed || portal === 'tenant') return true;
  if (scopedOwnerParty(access)) return false;
  return needed.some((permission) => access.permissions.includes(permission));
}
