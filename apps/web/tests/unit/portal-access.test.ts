import { describe, expect, it } from 'vitest';
import { canOpenPortalPath, canOpenSection, type PortalAccess } from '@/lib/portal-access';

const tenantAccess: PortalAccess = {
  roles: ['tenant'],
  permissions: [
    'reservation.read',
    'contract.read',
    'lease.read',
    'invoice.read',
    'payment.read',
    'receipt.read',
    'maintenance.read',
    'request.read',
  ],
  partyId: 'party-1',
};

const bareAccess: PortalAccess = {
  roles: ['tenant'],
  permissions: [],
  partyId: 'party-1',
};

describe('tenant portal access', () => {
  it('allows tenant sections only when the matching permission is held', () => {
    expect(canOpenSection(tenantAccess, 'tenant', 'contracts')).toBe(true);
    expect(canOpenSection(tenantAccess, 'tenant', 'invoices')).toBe(true);
    expect(canOpenSection(bareAccess, 'tenant', 'contracts')).toBe(false);
    expect(canOpenSection(tenantAccess, 'tenant', 'accounting')).toBe(false);
    expect(canOpenSection(tenantAccess, 'tenant', 'team')).toBe(false);
  });

  it('never opens owner-only pages for the tenant portal', () => {
    expect(canOpenPortalPath(tenantAccess, 'tenant', '/stays')).toBe(false);
    expect(canOpenPortalPath(tenantAccess, 'tenant', '/settings')).toBe(false);
    expect(canOpenPortalPath(tenantAccess, 'tenant', '/lab-reset')).toBe(false);
    expect(canOpenPortalPath(tenantAccess, 'tenant', '/api-keys')).toBe(false);
    expect(canOpenPortalPath(tenantAccess, 'tenant', '/contracts')).toBe(true);
    expect(canOpenPortalPath(bareAccess, 'tenant', '/contracts')).toBe(false);
  });
});
