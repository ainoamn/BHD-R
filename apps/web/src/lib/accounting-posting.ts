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

/**
 * Operating / maintenance / legal expense paid: Dr expense, Cr cash.
 * Optional input VAT (Oman): Dr expense (net) + Dr 1400 (VAT) / Cr cash (gross).
 */
export function postingExpensePaid(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  channel: CashChannel,
  expenseCode: '5000' | '5100' | '5200' | '5300' | '5400' | '5500' | '5600',
  memo: string,
  vatMinor?: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  const vat = vatMinor && /^\d+$/.test(vatMinor) ? BigInt(vatMinor) : 0n;
  if (vat <= 0n) {
    return [
      line(requireCode(map, expenseCode), 'debit', amountMinor, dims, memo),
      line(requireCode(map, cashAccountCode(channel)), 'credit', amountMinor, dims, memo),
    ];
  }
  const gross = (BigInt(amountMinor) + vat).toString();
  return [
    line(requireCode(map, expenseCode), 'debit', amountMinor, dims, memo),
    line(requireCode(map, '1400'), 'debit', vat.toString(), dims, memo),
    line(requireCode(map, cashAccountCode(channel)), 'credit', gross, dims, memo),
  ];
}

/** Other income received: Dr cash family, Cr other / sales revenue. */
export function postingIncomeReceived(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  channel: CashChannel,
  revenueCode: '4000' | '4100' | '4200' | '4300' | '4400',
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, cashAccountCode(channel)), 'debit', amountMinor, dims, memo),
    line(requireCode(map, revenueCode), 'credit', amountMinor, dims, memo),
  ];
}

/** Purchase paid or on credit: Dr purchases, Cr cash/bank or payables. */
export function postingPurchase(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  payWith: CashChannel | 'payable',
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  const credit =
    payWith === 'payable' ? requireCode(map, '2000') : requireCode(map, cashAccountCode(payWith));
  return [
    line(requireCode(map, '5600'), 'debit', amountMinor, dims, memo),
    line(credit, 'credit', amountMinor, dims, memo),
  ];
}

/** Sale cash/bank or on credit: Dr cash/AR, Cr sales. */
export function postingSale(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  collectWith: CashChannel | 'receivable',
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  const debit =
    collectWith === 'receivable'
      ? requireCode(map, '1200')
      : requireCode(map, cashAccountCode(collectWith));
  return [
    line(debit, 'debit', amountMinor, dims, memo),
    line(requireCode(map, '4400'), 'credit', amountMinor, dims, memo),
  ];
}

/**
 * Accrual: invoice issued to tenant (not yet collected).
 * Dr receivables (gross) / Cr revenue (net) [/ Cr 2200 output VAT when taxable].
 * Oman: residential rent usually VAT-exempt → use revenue 4010 with vatMinor omitted.
 */
export function postingTenantInvoice(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  revenueCode: '4000' | '4010' | '4200' | '4300',
  memo: string,
  vatMinor?: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  const vat = vatMinor && /^\d+$/.test(vatMinor) ? BigInt(vatMinor) : 0n;
  if (vat <= 0n) {
    return [
      line(requireCode(map, '1200'), 'debit', amountMinor, dims, memo),
      line(requireCode(map, revenueCode), 'credit', amountMinor, dims, memo),
    ];
  }
  const net = BigInt(amountMinor);
  const gross = (net + vat).toString();
  return [
    line(requireCode(map, '1200'), 'debit', gross, dims, memo),
    line(requireCode(map, revenueCode), 'credit', amountMinor, dims, memo),
    line(requireCode(map, '2200'), 'credit', vat.toString(), dims, memo),
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

export function expenseCodeFromCategory(
  category: string,
): '5000' | '5100' | '5200' | '5300' | '5500' {
  const value = category.toLowerCase();
  if (/صيان|maint|repair/.test(value)) return '5100';
  if (/قانون|legal|قض|court/.test(value)) return '5200';
  if (/مرفق|util|كهرب|ماء|water|elec/.test(value)) return '5300';
  if (/أخرى|other/.test(value)) return '5500';
  return '5000';
}

/** Revenue account for a tenant charge category (not rent). */
export function revenueCodeFromChargeCategory(
  category: string | null | undefined,
): '4000' | '4200' | '4300' {
  const value = (category ?? '').toLowerCase();
  if (value === 'service' || /خدم|service/.test(value)) return '4200';
  if (
    value === 'maintenance' ||
    value === 'damage' ||
    value === 'electricity' ||
    value === 'water' ||
    value === 'other' ||
    /صيان|تلف|كهرب|ماء|other|maint|damage|elec|water/.test(value)
  ) {
    return '4300';
  }
  return '4000';
}

/**
 * Legal recovery received: Dr cash family, Cr other income 4300.
 * Posts the delta only (caller supplies the increase in recovered amount).
 */
export function postingLegalRecovery(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  channel: CashChannel,
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, cashAccountCode(channel)), 'debit', amountMinor, dims, memo),
    line(requireCode(map, '4300'), 'credit', amountMinor, dims, memo),
  ];
}

/**
 * PDC register — receive tenant cheque into hand:
 * Dr 1140 (cheques in hand) / Cr 1200 (tenant AR) when receivable already booked,
 * else Cr 4000 (rent revenue) so the books stay balanced without inventing cash.
 */
export function postingChequeReceive(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  memo: string,
  creditCode: '1200' | '4000' | '2100' = '1200',
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, '1140'), 'debit', amountMinor, dims, memo),
    line(requireCode(map, creditCode), 'credit', amountMinor, dims, memo),
  ];
}

/** Deposit cheque at bank for collection: Dr 1150 / Cr 1140. */
export function postingChequeDeposit(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, '1150'), 'debit', amountMinor, dims, memo),
    line(requireCode(map, '1140'), 'credit', amountMinor, dims, memo),
  ];
}

/** Bank clears the cheque: Dr 1100 / Cr 1150 — cash recognized only here. */
export function postingChequeCollect(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, '1100'), 'debit', amountMinor, dims, memo),
    line(requireCode(map, '1150'), 'credit', amountMinor, dims, memo),
  ];
}

/**
 * Bounce under collection: Dr 1200 (restore AR) / Cr 1150.
 * Optional bank charge: Dr 5610 / Cr 1100.
 */
export function postingChequeBounce(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  memo: string,
  bankChargeMinor?: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  const lines: JournalLineInput[] = [
    line(requireCode(map, '1200'), 'debit', amountMinor, dims, memo),
    line(requireCode(map, '1150'), 'credit', amountMinor, dims, memo),
  ];
  if (bankChargeMinor && /^[1-9]\d*$/.test(bankChargeMinor)) {
    lines.push(
      line(requireCode(map, '5610'), 'debit', bankChargeMinor, dims, memo),
      line(requireCode(map, '1100'), 'credit', bankChargeMinor, dims, memo),
    );
  }
  return lines;
}

/** Redeposit after bounce: Dr 1150 / Cr 1200. */
export function postingChequeRedeposit(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, '1150'), 'debit', amountMinor, dims, memo),
    line(requireCode(map, '1200'), 'credit', amountMinor, dims, memo),
  ];
}

/** Cancel in-hand cheque that was received into 1140: reverse the receive. */
export function postingChequeCancelReceive(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  memo: string,
  creditCode: '1200' | '4000' | '2100' = '1200',
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  return [
    line(requireCode(map, creditCode), 'debit', amountMinor, dims, memo),
    line(requireCode(map, '1140'), 'credit', amountMinor, dims, memo),
  ];
}

/**
 * Charge collection that is not rent: Dr cash, Cr revenue by category.
 * Prefer over postingRentReceipt for maintenance/utilities/damage/service.
 */
export function postingChargeReceipt(
  map: AccountCodeMap,
  amountMinor: string,
  dims: PostingDimensions,
  channel: CashChannel,
  category: string | null | undefined,
  memo: string,
): JournalLineInput[] {
  if (!/^[1-9]\d*$/.test(amountMinor)) throw new Error('invalid_amount');
  const revenue = revenueCodeFromChargeCategory(category);
  return [
    line(requireCode(map, cashAccountCode(channel)), 'debit', amountMinor, dims, memo),
    line(requireCode(map, revenue), 'credit', amountMinor, dims, memo),
  ];
}
