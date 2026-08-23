import { describe, expect, it } from 'vitest';
import {
  currencyMinorUnits,
  moneySchema,
  publicInvoiceSchema,
  supportedCurrencyCodes,
} from '../src/index.js';

describe('shared contracts', () => {
  it('uses exact integer minor amounts and correct three-decimal Gulf currencies', () => {
    expect(moneySchema.safeParse({ amountMinor: '1250', currency: 'OMR' }).success).toBe(true);
    expect(moneySchema.safeParse({ amountMinor: '12.50', currency: 'OMR' }).success).toBe(false);
    expect(currencyMinorUnits.OMR).toBe(3);
    expect(currencyMinorUnits.BHD).toBe(3);
    expect(currencyMinorUnits.KWD).toBe(3);
  });

  it('covers all required Gulf currencies and USD', () => {
    expect(supportedCurrencyCodes).toEqual(['OMR', 'AED', 'SAR', 'BHD', 'KWD', 'QAR', 'USD']);
  });

  it('keeps the public invoice projection deliberately small', () => {
    const parsed = publicInvoiceSchema.parse({
      publicReference: 'a-random-public-reference',
      status: 'issued',
      issuedOn: '2026-08-23',
      dueOn: '2026-09-01',
      total: { amountMinor: '100000', currency: 'OMR' },
      outstanding: { amountMinor: '100000', currency: 'OMR' },
      merchantName: 'BHD R Demo',
      paymentEnabled: true,
      tenantEmail: 'must-not-be-exposed@example.com',
    });
    expect(parsed).not.toHaveProperty('tenantEmail');
  });
});
