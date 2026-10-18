import { describe, expect, it } from 'vitest';
import {
  cashAccountCode,
  channelFromMethod,
  expenseCodeFromCategory,
  postingChargeReceipt,
  postingDepositHeld,
  postingDepositRefund,
  postingDepositRetained,
  postingExpensePaid,
  postingLegalRecovery,
  postingReceivableCollection,
  postingRentReceipt,
  postingTenantInvoice,
  revenueCodeFromChargeCategory,
} from '@/lib/accounting-posting';
import { validateBalanced } from '@/lib/accounting-gl';

const MAP = new Map<string, string>([
  ['1000', 'cash'],
  ['1100', 'bank'],
  ['1150', 'cheque'],
  ['1200', 'ar'],
  ['2100', 'deposit'],
  ['4000', 'rent'],
  ['4200', 'service'],
  ['4300', 'other'],
  ['5000', 'opex'],
  ['5100', 'maint'],
  ['5200', 'legal'],
  ['5300', 'util'],
  ['5500', 'misc'],
]);

const DIMS = {
  currency: 'OMR',
  partyId: 'party-1',
  propertyId: 'prop-1',
  unitId: 'unit-1',
};

describe('accounting-posting', () => {
  it('maps payment channels and expense categories', () => {
    expect(cashAccountCode('cash')).toBe('1000');
    expect(cashAccountCode('bank')).toBe('1100');
    expect(cashAccountCode('cheque')).toBe('1150');
    expect(channelFromMethod('bank_transfer')).toBe('bank');
    expect(channelFromMethod('cheque')).toBe('cheque');
    expect(channelFromMethod('cash')).toBe('cash');
    expect(expenseCodeFromCategory('صيانة دورية')).toBe('5100');
    expect(expenseCodeFromCategory('قضية قانونية')).toBe('5200');
    expect(expenseCodeFromCategory('كهرباء')).toBe('5300');
    expect(expenseCodeFromCategory('تشغيل')).toBe('5000');
  });

  it('posts balanced rent receipt with unit/party/property on both lines', () => {
    const lines = postingRentReceipt(MAP, '150000', DIMS, 'bank', 'إيجار أكتوبر');
    expect(lines).toHaveLength(2);
    expect(lines[0]!.accountId).toBe('bank');
    expect(lines[0]!.debitMinor).toBe('150000');
    expect(lines[1]!.accountId).toBe('rent');
    expect(lines[1]!.creditMinor).toBe('150000');
    for (const row of lines) {
      expect(row.partyId).toBe('party-1');
      expect(row.propertyId).toBe('prop-1');
      expect(row.unitId).toBe('unit-1');
    }
    expect(() => validateBalanced(lines)).not.toThrow();
  });

  it('posts deposit hold, refund, and retain as balanced pairs', () => {
    const held = postingDepositHeld(MAP, '50000', DIMS, 'cash', 'تأمين');
    const refund = postingDepositRefund(MAP, '30000', DIMS, 'bank', 'استرداد');
    const retain = postingDepositRetained(MAP, '20000', DIMS, 'احتجاز');
    expect(held[1]!.accountId).toBe('deposit');
    expect(refund[0]!.accountId).toBe('deposit');
    expect(retain[1]!.accountId).toBe('other');
    expect(() => validateBalanced(held)).not.toThrow();
    expect(() => validateBalanced(refund)).not.toThrow();
    expect(() => validateBalanced(retain)).not.toThrow();
  });

  it('posts maintenance expense and receivable collection with dimensions', () => {
    const expense = postingExpensePaid(MAP, '25000', DIMS, 'bank', '5100', 'صيانة');
    expect(expense[0]!.accountId).toBe('maint');
    expect(expense[0]!.debitMinor).toBe('25000');
    expect(expense[1]!.accountId).toBe('bank');
    expect(() => validateBalanced(expense)).not.toThrow();

    const invoice = postingTenantInvoice(MAP, '100000', DIMS, '4000', 'فاتورة');
    const collect = postingReceivableCollection(MAP, '100000', DIMS, 'cash', 'تحصيل');
    expect(() => validateBalanced(invoice)).not.toThrow();
    expect(() => validateBalanced(collect)).not.toThrow();
  });

  it('rejects zero/invalid amounts and missing accounts', () => {
    expect(() => postingRentReceipt(MAP, '0', DIMS, 'cash', 'x')).toThrow('invalid_amount');
    expect(() => postingRentReceipt(new Map(), '100', DIMS, 'cash', 'x')).toThrow(
      /account_missing/,
    );
  });

  it('maps charge categories to non-rent revenue and posts legal recovery', () => {
    expect(revenueCodeFromChargeCategory('maintenance')).toBe('4300');
    expect(revenueCodeFromChargeCategory('service')).toBe('4200');
    expect(revenueCodeFromChargeCategory('electricity')).toBe('4300');
    const charge = postingChargeReceipt(MAP, '12000', DIMS, 'bank', 'maintenance', 'MNT-1');
    expect(charge[1]!.accountId).toBe('other');
    expect(() => validateBalanced(charge)).not.toThrow();
    const recovery = postingLegalRecovery(MAP, '90000', DIMS, 'bank', 'قضية');
    expect(recovery[1]!.accountId).toBe('other');
    expect(() => validateBalanced(recovery)).not.toThrow();
  });
});
