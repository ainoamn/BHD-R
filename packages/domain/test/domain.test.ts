import { describe, expect, it } from 'vitest';
import { deriveAvailability, isPubliclyDiscoverable } from '../src/availability.js';
import { calculateInvoice } from '../src/invoice.js';
import { parseMajorAmount } from '../src/money.js';
import { toPublicInvoice } from '../src/public-projections.js';

describe('financial precision', () => {
  it('keeps OMR in integer baisa and rounds tax deterministically', () => {
    const unitAmount = parseMajorAmount('12.345', 'OMR', 3);
    const invoice = calculateInvoice([
      { description: 'Rent', quantity: '2', unitAmount, taxRateBasisPoints: 500 },
    ]);
    expect(invoice.subtotal.amountMinor).toBe(24_690n);
    expect(invoice.tax.amountMinor).toBe(1_235n);
    expect(invoice.total.amountMinor).toBe(25_925n);
  });

  it('rejects hidden floating point precision', () => {
    expect(() => parseMajorAmount('0.0001', 'OMR', 3)).toThrow();
  });
});

describe('availability', () => {
  it('hides any currently blocked unit', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const state = deriveAvailability({
      publishWhenAvailable: true,
      listingEnabled: true,
      now,
      blocks: [{ kind: 'lease', startsAt: new Date('2025-01-01'), endsAt: null, active: true }],
    });
    expect(state).toBe('leased');
    expect(isPubliclyDiscoverable(state)).toBe(false);
  });
});

describe('state machines', () => {
  it('rejects illegal contract jumps from draft to active', async () => {
    const { assertTransition, contractMachine } = await import('../src/state-machines.js');
    expect(assertTransition(contractMachine, 'draft', 'active').ok).toBe(false);
    expect(assertTransition(contractMachine, 'draft', 'compliance_ready').ok).toBe(true);
  });
});

describe('entitlements', () => {
  it('rejects property creates past the starter plan limit', async () => {
    const { assertWithinEntitlement } = await import('../src/entitlements.js');
    expect(
      assertWithinEntitlement({
        planKey: 'starter',
        metric: 'properties',
        current: 5,
        requested: 1,
      }).ok,
    ).toBe(false);
    expect(
      assertWithinEntitlement({
        planKey: 'starter',
        metric: 'representatives',
        current: 1,
        requested: 1,
      }).ok,
    ).toBe(true);
  });
});

describe('public invoice projection', () => {
  it('does not leak tenant or tenancy identifiers', () => {
    const output = toPublicInvoice({
      id: 'internal',
      invoiceNumber: 'INV-1',
      status: 'issued',
      currency: 'OMR',
      minorUnit: 3,
      totalMinor: 10_000n,
      paidMinor: 2_000n,
      issuedOn: '2026-01-01',
      dueOn: '2026-02-01',
      organizationDisplayName: 'BHD',
      tenantDisplayName: 'Private',
      tenantEmail: 'private@example.com',
      leaseId: 'lease',
      organizationId: 'org',
      tenantPartyId: 'tenant',
      notes: 'private',
    });
    expect(output).toEqual(expect.objectContaining({ outstandingMinor: '8000' }));
    expect(output).not.toHaveProperty('tenantEmail');
    expect(output).not.toHaveProperty('leaseId');
    expect(output).not.toHaveProperty('id');
  });
});
