import { describe, expect, it } from 'vitest';
import { publicInvoiceSchema, type PublicInvoice } from '@bhd-r/contracts';

const fixture: PublicInvoice = {
  publicReference: 'PUB-2026-000001',
  status: 'partially_paid',
  issuedOn: '2026-08-01',
  dueOn: '2026-08-31',
  total: { amountMinor: '500000', currency: 'OMR' },
  outstanding: { amountMinor: '200000', currency: 'OMR' },
  merchantName: 'BHD R Demo Owner',
  paymentEnabled: true,
};

describe('public invoice contract', () => {
  it('accepts only the deliberately minimal public DTO', () => {
    expect(publicInvoiceSchema.parse(fixture)).toEqual(fixture);
    expect(fixture).not.toHaveProperty('tenantName');
    expect(fixture).not.toHaveProperty('propertyAddress');
    expect(fixture).not.toHaveProperty('leaseId');
  });
});
