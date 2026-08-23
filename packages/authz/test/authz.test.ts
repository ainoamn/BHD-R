import { describe, expect, it } from 'vitest';
import { parseVerifiedIdentityClaims, permissionsForRoles, rolePermissions } from '../src/index.js';

describe('central role permissions regression', () => {
  it('keeps tenant access isolated from property administration and payment mutation', () => {
    expect(rolePermissions.tenant).toContain('contract.sign');
    expect(rolePermissions.tenant).toContain('maintenance.create');
    expect(rolePermissions.tenant).not.toContain('property.update');
    expect(rolePermissions.tenant).not.toContain('payment.record');
    expect(rolePermissions.tenant).not.toContain('organization.members.read');
  });

  it('does not silently grant write access to platform support', () => {
    expect(
      rolePermissions.platform_support.every((permission) => permission.endsWith('.read')),
    ).toBe(true);
  });

  it('deduplicates permissions when a user has multiple roles', () => {
    const combined = permissionsForRoles(['property_manager', 'finance_manager']);
    expect(new Set(combined).size).toBe(combined.length);
    expect(combined).toContain('property.update');
    expect(combined).toContain('payment.reconcile');
  });
});

describe('OIDC identity claims regression', () => {
  it('requires the signed nonce to match the login transaction', () => {
    expect(() =>
      parseVerifiedIdentityClaims(
        { sub: 'identity-1', nonce: 'attacker-nonce', email_verified: true },
        'expected-nonce',
      ),
    ).toThrow('OIDC nonce validation failed');
  });

  it('does not treat an unverified email as safe for account linking', () => {
    expect(
      parseVerifiedIdentityClaims(
        { sub: 'identity-1', nonce: 'expected-nonce', email: 'owner@example.com' },
        'expected-nonce',
      ),
    ).toMatchObject({ email: 'owner@example.com', emailVerified: false });
  });
});
