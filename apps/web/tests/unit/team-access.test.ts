import { describe, expect, it } from 'vitest';
import {
  accessFromMemberships,
  customRoleIds,
  permissionsForRoles,
  type RoleKey,
} from '@bhd-r/authz';
import {
  canOpenPortalPath,
  canOpenSection,
  lawyerParty,
  portalsForRoles,
  scopedOwnerParty,
} from '@/lib/portal-access';
import {
  assignableRoles,
  canAssignSavedRole,
  canManageMember,
  capabilitiesFromPermissions,
  grantableCapabilities,
  permissionsForCapabilities,
  primaryRole,
  roleLabel,
  savedRoleId,
  savedRoleKey,
  TEAM_CAPABILITIES,
  validTeamEmail,
} from '@/lib/team-shared';

const ownerPermissions = permissionsForRoles(['organization_owner']);
const adminPermissions = permissionsForRoles(['organization_admin']);
const ROLE_ID = '0b6c2b0e-5d0f-4c3b-9a43-6a1f1c2d3e4f';
const PARTY = '20570b48-4636-48fc-877c-6a813f5c7969';

describe('team roles', () => {
  it('lets the owner give every staff role, admins only below admin', () => {
    expect(assignableRoles(['organization_owner'])).toEqual([
      'organization_admin',
      'property_manager',
      'finance_manager',
      'admin_staff',
      'legal_counsel',
      'maintenance_agent',
      'building_guard',
      'auditor',
      'developer_admin',
    ]);
    expect(assignableRoles(['organization_admin'])).toEqual([
      'property_manager',
      'finance_manager',
      'admin_staff',
      'legal_counsel',
      'maintenance_agent',
      'building_guard',
      'auditor',
    ]);
    expect(assignableRoles(['admin_staff'])).toEqual([
      'admin_staff',
      'legal_counsel',
      'maintenance_agent',
      'building_guard',
      'auditor',
    ]);
  });

  it('never manages the owner, and admins never manage other admins', () => {
    expect(canManageMember(['organization_owner'], 'organization_owner')).toBe(false);
    expect(canManageMember(['organization_owner'], 'organization_admin')).toBe(true);
    expect(canManageMember(['organization_admin'], 'organization_admin')).toBe(false);
    expect(canManageMember(['organization_admin'], 'finance_manager')).toBe(true);
  });

  it('orders a multi-role member by their highest role and names saved roles', () => {
    expect(primaryRole(['auditor', savedRoleKey(ROLE_ID), 'finance_manager'])).toBe(
      'finance_manager',
    );
    expect(savedRoleId(savedRoleKey(ROLE_ID))).toBe(ROLE_ID);
    expect(savedRoleId('auditor')).toBeNull();
    const saved = [{ id: ROLE_ID, nameAr: 'محاسب استلام', nameEn: '' }];
    expect(roleLabel(savedRoleKey(ROLE_ID), true, saved)).toBe('محاسب استلام');
    expect(roleLabel(savedRoleKey(ROLE_ID), false, saved)).toBe('محاسب استلام');
    expect(roleLabel('building_guard', true)).toBe('حارس مبنى');
  });
});

describe('team capabilities', () => {
  it('only grants capabilities the actor fully holds; team management is owner-only', () => {
    const owner = grantableCapabilities(ownerPermissions, ['organization_owner']);
    expect(owner).toEqual(TEAM_CAPABILITIES.map((capability) => capability.id));
    const admin = grantableCapabilities(adminPermissions, ['organization_admin']);
    expect(admin).not.toContain('team');
    expect(admin).not.toContain('refund_transfer');
    expect(admin).not.toContain('refund_approve');
    expect(admin).toContain('bookings');
  });

  it('round-trips capabilities through stored permissions', () => {
    const stored = permissionsForCapabilities(['refund_approve', 'maintenance']);
    expect(capabilitiesFromPermissions(stored).sort()).toEqual(['maintenance', 'refund_approve']);
    expect(capabilitiesFromPermissions(permissionsForCapabilities(['refund_approve']))).toEqual([
      'refund_approve',
    ]);
    const partialAccountant = permissionsForCapabilities(['invoices_view', 'payments']);
    expect(capabilitiesFromPermissions(partialAccountant).sort()).toEqual([
      'invoices_view',
      'payments',
      'payments_view',
    ]);
  });

  it('the accountant role already transfers deposits and approves refunds', () => {
    const accountant = capabilitiesFromPermissions(permissionsForRoles(['finance_manager']));
    expect(accountant).toContain('refund_transfer');
    expect(accountant).toContain('refund_approve');
    expect(accountant).not.toContain('bookings');
  });

  it('stores only real permissions', () => {
    const all = new Set<string>(permissionsForRoles(['platform_admin' as RoleKey]));
    for (const capability of TEAM_CAPABILITIES) {
      for (const permission of capability.permissions) expect(all.has(permission)).toBe(true);
    }
  });

  it('gives a saved role only to someone holding all of it; team control stays with the owner', () => {
    const cashier = permissionsForCapabilities(['payments', 'refund_transfer']);
    expect(canAssignSavedRole(adminPermissions, ['organization_admin'], cashier)).toBe(false);
    const finance = permissionsForRoles(['finance_manager']);
    expect(canAssignSavedRole(finance, ['finance_manager'], cashier)).toBe(true);
    const teamControl = permissionsForCapabilities(['team']);
    expect(canAssignSavedRole(ownerPermissions, ['organization_admin'], teamControl)).toBe(false);
    expect(canAssignSavedRole([], ['organization_owner'], teamControl)).toBe(true);
  });
});

describe('membership access', () => {
  it('merges several roles, saved roles and extra grants', () => {
    const rows = [
      { roleKey: 'maintenance_agent', permissions: ['invoice.read', 'not.a.permission'] },
      { roleKey: savedRoleKey(ROLE_ID), permissions: [] },
      { roleKey: 'building_guard', permissions: [] },
    ];
    expect(customRoleIds(rows)).toEqual([ROLE_ID]);
    const access = accessFromMemberships(
      rows,
      new Map([[ROLE_ID, ['payment.record', 'payment.read']]]),
    );
    expect(access.roles.sort()).toEqual(['building_guard', 'custom_member', 'maintenance_agent']);
    expect(access.permissions).toContain('work_order.manage');
    expect(access.permissions).toContain('stay.booking.read');
    expect(access.permissions).toContain('payment.record');
    expect(access.permissions).toContain('invoice.read');
    expect(access.permissions).not.toContain('not.a.permission');
  });

  it('drops a saved role that was archived or deleted', () => {
    const access = accessFromMemberships([{ roleKey: savedRoleKey(ROLE_ID), permissions: [] }]);
    expect(access.roles).toEqual([]);
    expect(access.permissions).toEqual([]);
  });

  it('limits a building owner to their own properties and bookings', () => {
    const owner = accessFromMemberships([
      { roleKey: 'property_owner', permissions: [], partyId: PARTY },
    ]);
    expect(owner.partyId).toBe(PARTY);
    expect(scopedOwnerParty(owner)).toBe(PARTY);
    expect(portalsForRoles(owner.roles)).toEqual(['owner']);
    expect(canOpenSection(owner, 'owner', 'properties')).toBe(true);
    expect(canOpenSection(owner, 'owner', 'bookings')).toBe(true);
    expect(canOpenSection(owner, 'owner', 'contacts')).toBe(false);
    expect(canOpenSection(owner, 'owner', 'invoices')).toBe(false);
    expect(canOpenSection(owner, 'owner', 'team')).toBe(false);
    expect(canOpenPortalPath(owner, 'owner', '/stays/rates')).toBe(false);
    expect(canOpenPortalPath(owner, 'owner', '/properties/new')).toBe(false);
  });

  it('keeps staff organization-wide even with a party, and gates sections by permission', () => {
    const staff = accessFromMemberships([
      { roleKey: 'property_owner', permissions: [], partyId: PARTY },
      { roleKey: 'finance_manager', permissions: [] },
    ]);
    expect(scopedOwnerParty(staff)).toBeNull();
    expect(canOpenSection(staff, 'owner', 'invoices')).toBe(true);
    const guard = accessFromMemberships([{ roleKey: 'building_guard', permissions: [] }]);
    expect(canOpenSection(guard, 'owner', 'maintenance')).toBe(true);
    expect(canOpenSection(guard, 'owner', 'bookings')).toBe(true);
    expect(canOpenSection(guard, 'owner', 'invoices')).toBe(false);
    expect(canOpenSection(guard, 'owner', 'contacts')).toBe(false);
    expect(canOpenPortalPath(guard, 'owner', '/properties')).toBe(false);
    expect(canOpenPortalPath(guard, 'owner', '/requests')).toBe(false);
    expect(canOpenPortalPath(guard, 'owner', '/notifications')).toBe(false);
    expect(canOpenPortalPath(guard, 'owner', '/badges')).toBe(false);
    expect(canOpenPortalPath(guard, 'owner', '/stays')).toBe(false);
    expect(canOpenPortalPath(guard, 'owner', '/stays/rates')).toBe(false);
    expect(canOpenPortalPath(guard, 'owner', '/stays/calendar')).toBe(true);
    expect(guard.permissions).toContain('viewing.read');
    expect(guard.permissions).toContain('viewing.checkin');
    expect(guard.permissions).not.toContain('property.read');
    expect(guard.permissions).not.toContain('request.read');
  });

  it('limits an external lawyer to the legal cases assigned to their party', () => {
    const lawyer = accessFromMemberships([{ roleKey: 'lawyer', permissions: [], partyId: PARTY }]);
    expect(lawyer.partyId).toBe(PARTY);
    expect(lawyerParty(lawyer)).toBe(PARTY);
    expect(scopedOwnerParty(lawyer)).toBe(PARTY);
    expect(lawyer.permissions).toEqual(['legal.case.read', 'legal.case.update']);
    expect(portalsForRoles(lawyer.roles)).toEqual(['owner']);
    expect(canOpenSection(lawyer, 'owner', 'legal')).toBe(true);
    expect(canOpenSection(lawyer, 'owner', 'properties')).toBe(false);
    expect(canOpenSection(lawyer, 'owner', 'bookings')).toBe(false);
    expect(canOpenSection(lawyer, 'owner', 'contacts')).toBe(false);
    expect(canOpenPortalPath(lawyer, 'owner', '/stays/rates')).toBe(false);
    expect(assignableRoles(['organization_owner'])).not.toContain('lawyer');

    const counsel = accessFromMemberships([
      { roleKey: 'lawyer', permissions: [], partyId: PARTY },
      { roleKey: 'legal_counsel', permissions: [] },
    ]);
    expect(lawyerParty(counsel)).toBeNull();
    const owner = accessFromMemberships([
      { roleKey: 'property_owner', permissions: [], partyId: PARTY },
      { roleKey: 'lawyer', permissions: [], partyId: PARTY },
    ]);
    expect(lawyerParty(owner)).toBeNull();
  });
});

describe('team email', () => {
  it('accepts ordinary addresses only', () => {
    expect(validTeamEmail('accountant@bhd-om.com')).toBe(true);
    expect(validTeamEmail('no-at-sign')).toBe(false);
    expect(validTeamEmail('a@b')).toBe(false);
  });
});
