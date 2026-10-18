/**
 * Deterministic posting rules (SRS §5 / §11): source document → balanced journal lines.
 * AI never posts; only these rules + human approval create official balances.
 * Amounts are integer minor units — never float.
 */

import type { JournalLineInput } from '@/lib/accounting-gl';

export type CashChannel = 'cash' | 'bank' | 'cheque';

export type PostingDimensions = {
  partyId?: string;
  propertyId?: string;
  unitId?: string;
  currency: string;
};

export type AccountCodeMap = ReadonlyMap<string, string>;

/** Map payment method / channel to cash-family account code. */
export function cashAccountCode(channel: CashChannel): '1000' | '1100' | '1150' {
  if (channel === 'cheque') return '1150';
  if (channel === 'bank') return '1100';
  return '1000';
}

export function channelFromMethod(method: string | null | undefined): CashChannel {
  const value = (method ?? '').toLowerCase();
  if (value === 'cheque' || value === 'check') return 'cheque';
  if (value === 'bank_transfer' || value === 'card' || value === 'bank') return 'bank';
  return 'cash';
}

function line(
  accountId: string,
  side: 'debit' | 'credit',
  amountMinor: string,
  dims: PostingDimensions,
  memo?: string,
): JournalLineInput {
  return {
    accountId,
    debitMinor: side === 'debit' ? amountMinor : '0',
    creditMinor: side === 'credit' ? amountMinor : '0',
    currency: dims.currency,
    ...(dims.partyId ? { partyId: dims.partyId } : {}),
    ...(dims.propertyId ? { propertyId: dims.propertyId } : {}),
    ...(dims.unitId ? { unitId: dims.unitId } : {}),
    ...(memo ? { memo } : {}),
  };
}

function requireCode(map: AccountCodeMap, code: string): string {
  const id = map.get(code);
  if (!id) throw new Error(`account_missing:${code}`);
  return id;
}

/** Tenant rent / charge receipt: Dr cash family, Cr rental revenue — dims on both lines. */
export function postingRentReceipt(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  channel: CashChannel,
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, cashAccountCode(channel)), 'debit', amountMinor, dims, memo),
    line(requireCode(map, '4000'), 'credit', amountMinor, dims, memo),
  ];
}

/** Deposit held in trust: Dr cash, Cr deposits liability 2100. */
export function postingDepositHeld(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  channel: CashChannel,
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, cashAccountCode(channel)), 'debit', amountMinor, dims, memo),
    line(requireCode(map, '2100'), 'credit', amountMinor, dims, memo),
  ];
}

/** Deposit refund to guest: Dr 2100, Cr cash. */
export function postingDepositRefund(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  channel: CashChannel,
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, '2100'), 'debit', amountMinor, dims, memo),
    line(requireCode(map, cashAccountCode(channel)), 'credit', amountMinor, dims, memo),
  ];
}

/** Retained deposit becomes property income: Dr 2100, Cr other revenue 4300. */
export function postingDepositRetained(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, '2100'), 'debit', amountMinor, dims, memo),
    line(requireCode(map, '4300'), 'credit', amountMinor, dims, memo),
  ];
}

/** Operating / maintenance / legal expense paid: Dr expense, Cr cash. */
export function postingExpensePaid(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  channel: CashChannel,
  expenseCode: '5000' | '5100' | '5200' | '5300' | '5400' | '5500',
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, expenseCode), 'debit', amountMinor, dims, memo),
    line(requireCode(map, cashAccountCode(channel)), 'credit', amountMinor, dims, memo),
  ];
}

/** Invoice issued to tenant (not yet collected): Dr receivables, Cr revenue. */
export function postingTenantInvoice(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  revenueCode: '4000' | '4200' | '4300',
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, '1200'), 'debit', amountMinor, dims, memo),
    line(requireCode(map, revenueCode), 'credit', amountMinor, dims, memo),
  ];
}

/** Collection against receivable: Dr cash, Cr receivables. */
export function postingReceivableCollection(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  channel: CashChannel,
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, cashAccountCode(channel)), 'debit', amountMinor, dims, memo),
    line(requireCode(map, '1200'), 'credit', amountMinor, dims, memo),
  ];
}

export function expenseCodeFromCategory(category: string): '5000' | '5100' | '5200' | '5300' | '5500' {
  const value = category.toLowerCase();
  if (/صيان|maint|repair/.test(value)) return '5100';
  if (/قانون|legal|قض|court/.test(value)) return '5200';
  if (/مرفق|util|كهرب|ماء|water|elec/.test(value)) return '5300';
  if (/أخرى|other/.test(value)) return '5500';
  return '5000';
}
