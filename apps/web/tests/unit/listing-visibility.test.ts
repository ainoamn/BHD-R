import { describe, expect, it } from 'vitest';
import { contractUseForCategory } from '@/lib/lease-terms';
import { listingVisibilityCode } from '@/lib/listing-visibility-sql';
import { pendingApprovalTitle, type PendingApprovalItem } from '@/lib/pending-approvals-shared';

const base: PendingApprovalItem = {
  kind: 'sale_decision',
  id: '00000000-0000-4000-8000-000000000001',
  reference: 'A1',
  propertyId: '00000000-0000-4000-8000-000000000002',
  propertyNameAr: 'مبنى',
  propertyNameEn: null,
  unitCode: 'A1',
  party: null,
  contractType: 'lease',
  fromOn: null,
  requestedAt: '2026-10-13T00:00:00.000Z',
};

describe('contractUseForCategory', () => {
  it('leases offices, shops and warehouses commercially', () => {
    expect(contractUseForCategory('office')).toBe('commercial');
    expect(contractUseForCategory('shop')).toBe('commercial');
    expect(contractUseForCategory('warehouse')).toBe('commercial');
  });

  it('leases homes and unknown categories residentially', () => {
    expect(contractUseForCategory('apartment')).toBe('residential');
    expect(contractUseForCategory('villa')).toBe('residential');
    expect(contractUseForCategory(null)).toBe('residential');
  });
});

describe('listing visibility decisions', () => {
  it('keeps the policy code within the 64-character column', () => {
    expect(listingVisibilityCode(base.id).length).toBeLessThanOrEqual(64);
  });

  it('asks the right question in the bell', () => {
    expect(pendingApprovalTitle({ ...base, decision: 'hide_sold' }, true)).toContain('بيعت');
    expect(pendingApprovalTitle({ ...base, decision: 'hide_leased' }, true)).toContain('تخفيها');
    expect(pendingApprovalTitle({ ...base, decision: 'keep_selling' }, true)).toContain('بيعها');
  });
});
