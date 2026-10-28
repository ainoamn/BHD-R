import { describe, expect, it } from 'vitest';
import { postingIncomeReceived, postingPurchase, postingSale } from '@/lib/accounting-posting';
import { parseChequeImportCsv } from '@/lib/accounting-ops';

const map = new Map([
  ['1000', 'cash'],
  ['1100', 'bank'],
  ['1150', 'cheque'],
  ['1200', 'ar'],
  ['2000', 'ap'],
  ['4300', 'other-rev'],
  ['4400', 'sales'],
  ['5600', 'purchases'],
]);

describe('ops posting', () => {
  it('posts income to cash and other revenue', () => {
    const lines = postingIncomeReceived(
      map,
      '10000',
      { currency: 'OMR', propertyId: 'p1' },
      'cash',
      '4300',
      'fee',
    );
    expect(lines).toEqual([
      expect.objectContaining({ accountId: 'cash', debitMinor: '10000', propertyId: 'p1' }),
      expect.objectContaining({ accountId: 'other-rev', creditMinor: '10000', propertyId: 'p1' }),
    ]);
  });

  it('posts purchase on credit to payables', () => {
    const lines = postingPurchase(map, '5000', { currency: 'OMR' }, 'payable', 'stock');
    expect(lines[0]?.accountId).toBe('purchases');
    expect(lines[1]?.accountId).toBe('ap');
  });

  it('posts sale on receivable', () => {
    const lines = postingSale(map, '7000', { currency: 'OMR' }, 'receivable', 'sale');
    expect(lines[0]?.accountId).toBe('ar');
    expect(lines[1]?.accountId).toBe('sales');
  });
});

describe('parseChequeImportCsv', () => {
  it('parses major amounts and optional lease id', () => {
    const rows = parseChequeImportCsv(
      'chequeNumber,bankName,amount,dueOn,leaseId\n101,Bank Muscat,80.000,2026-11-01,7b8f4590-1ccc-418d-89c4-c4e11e48312f',
    );
    expect(rows).toEqual([
      {
        chequeNumber: '101',
        bankName: 'Bank Muscat',
        amountMinor: '80000',
        dueOn: '2026-11-01',
        leaseId: '7b8f4590-1ccc-418d-89c4-c4e11e48312f',
      },
    ]);
  });
});
