import { describe, expect, it } from 'vitest';
import { permissionsForRoles, type RoleKey } from '@bhd-r/authz';
import {
  assignableRoles,
  canManageMember,
  capabilitiesFromPermissions,
  grantableCapabilities,
  permissionsForCapabilities,
  TEAM_CAPABILITIES,
  validTeamEmail,
} from '@/lib/team-shared';

const ownerPermissions = permissionsForRoles(['organization_owner']);
const adminPermissions = permissionsForRoles(['organization_admin']);

describe('team roles', () => {
  it('lets the owner give every staff role, admins only below admin', () => {
    expect(assignableRoles(['organization_owner'])).toEqual([
      'organization_admin',
      'property_manager',
      'finance_manager',
      'maintenance_agent',
      'auditor',
      'developer_admin',
    ]);
    expect(assignableRoles(['organization_admin'])).toEqual([
      'property_manager',
      'finance_manager',
      'maintenance_agent',
      'auditor',
    ]);
    expect(assignableRoles(['finance_manager'])).toEqual([
      'property_manager',
      'finance_manager',
      'maintenance_agent',
      'auditor',
    ]);
  });

  it('never manages the owner, and admins never manage other admins', () => {
    expect(canManageMember(['organization_owner'], 'organization_owner')).toBe(false);
    expect(canManageMember(['organization_owner'], 'organization_admin')).toBe(true);
    expect(canManageMember(['organization_admin'], 'organization_admin')).toBe(false);
    expect(canManageMember(['organization_admin'], 'finance_manager')).toBe(true);
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
});

describe('team email', () => {
  it('accepts ordinary addresses only', () => {
    expect(validTeamEmail('accountant@bhd-om.com')).toBe(true);
    expect(validTeamEmail('no-at-sign')).toBe(false);
    expect(validTeamEmail('a@b')).toBe(false);
  });
});
