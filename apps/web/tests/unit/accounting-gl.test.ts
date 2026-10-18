import { describe, expect, it } from 'vitest';
import {
  AccountingBalanceError,
  DEFAULT_CHART_OF_ACCOUNTS,
  agingBucket,
  buildBalanceSheet,
  buildIncomeStatement,
  daysBetween,
  parseAccountingHubTab,
  validateBalanced,
  type TrialBalanceRow,
} from '@/lib/accounting-gl';

describe('accounting-gl', () => {
  it('seeds a full property chart covering all five account classes', () => {
    const types = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((row) => row.type));
    expect(types).toEqual(new Set(['asset', 'liability', 'equity', 'revenue', 'expense']));
    expect(DEFAULT_CHART_OF_ACCOUNTS.some((row) => row.code === '2100')).toBe(true);
    expect(DEFAULT_CHART_OF_ACCOUNTS.some((row) => row.code === '4000')).toBe(true);
  });

  it('rejects unbalanced and one-sided journals', () => {
    expect(() =>
      validateBalanced([
        { accountId: 'a', debitMinor: '1000', creditMinor: '0', currency: 'OMR' },
        { accountId: 'b', debitMinor: '0', creditMinor: '500', currency: 'OMR' },
      ]),
    ).toThrow(AccountingBalanceError);

    expect(() =>
      validateBalanced([
        { accountId: 'a', debitMinor: '1000', creditMinor: '1000', currency: 'OMR' },
      ]),
    ).toThrow(AccountingBalanceError);

    expect(() =>
      validateBalanced([
        { accountId: 'a', debitMinor: '1000', creditMinor: '0', currency: 'OMR' },
        { accountId: 'b', debitMinor: '0', creditMinor: '1000', currency: 'OMR' },
      ]),
    ).not.toThrow();
  });

  it('builds an income statement and a balanced sheet from trial rows', () => {
    const rows: TrialBalanceRow[] = [
      {
        accountId: '1',
        code: '1000',
        nameAr: 'صندوق',
        nameEn: 'Cash',
        type: 'asset',
        currency: 'OMR',
        debitMinor: '5000',
        creditMinor: '0',
        balanceMinor: '5000',
      },
      {
        accountId: '2',
        code: '4000',
        nameAr: 'إيراد',
        nameEn: 'Revenue',
        type: 'revenue',
        currency: 'OMR',
        debitMinor: '0',
        creditMinor: '8000',
        balanceMinor: '-8000',
      },
      {
        accountId: '3',
        code: '5000',
        nameAr: 'مصروف',
        nameEn: 'Expense',
        type: 'expense',
        currency: 'OMR',
        debitMinor: '3000',
        creditMinor: '0',
        balanceMinor: '3000',
      },
      {
        accountId: '4',
        code: '3000',
        nameAr: 'رأس مال',
        nameEn: 'Equity',
        type: 'equity',
        currency: 'OMR',
        debitMinor: '0',
        creditMinor: '0',
        balanceMinor: '0',
      },
    ];
    const income = buildIncomeStatement(rows, '2026-01-01', '2026-12-31', 'OMR');
    expect(income.netIncomeMinor).toBe('5000');
    expect(income.revenue.totalMinor).toBe('8000');
    expect(income.expenses.totalMinor).toBe('3000');

    const sheet = buildBalanceSheet(rows, '2026-12-31', 'OMR', income.netIncomeMinor);
    expect(sheet.assets.totalMinor).toBe('5000');
    expect(sheet.equity.totalMinor).toBe('5000');
    expect(sheet.balanced).toBe(true);
  });

  it('classifies AR aging buckets and hub tabs', () => {
    expect(agingBucket(-2)).toBe('current');
    expect(agingBucket(15)).toBe('1-30');
    expect(agingBucket(45)).toBe('31-60');
    expect(agingBucket(75)).toBe('61-90');
    expect(agingBucket(120)).toBe('90+');
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(parseAccountingHubTab('journal')).toBe('journal');
    expect(parseAccountingHubTab('ledgers')).toBe('ledgers');
    expect(parseAccountingHubTab('documents')).toBe('documents');
    expect(parseAccountingHubTab('nope')).toBe('dashboard');
  });
});
