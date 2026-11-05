/**
 * Cheque schedule annex: a companion document to the lease, built from the
 * reservation's submitted cheques (numbers, bank, amounts) and, if those are
 * absent, from stored lease-term schedule rows.
 */

import type { LeaseTerms } from '@/lib/lease-terms';

export type ContractChequeKind = 'rent' | 'vat' | 'deposit';

export type ContractChequeRow = {
  key: string;
  kind: ContractChequeKind;
  labelAr: string;
  labelEn: string;
  dueOn: string | null;
  amountMinor: string;
  currency: string;
  chequeNumber: string | null;
  bankName: string | null;
  accountHolderName: string | null;
  accountNumber: string | null;
};

export type ContractChequeAnnex = {
  reference: string;
  rows: ContractChequeRow[];
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function amount(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.round(value));
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return null;
}

function kindOf(value: unknown, key: string): ContractChequeKind {
  if (value === 'vat' || value === 'deposit' || value === 'rent') return value;
  if (key.startsWith('vat')) return 'vat';
  if (key.startsWith('deposit')) return 'deposit';
  return 'rent';
}

function rowsFromLifecycle(lifecycle: unknown): ContractChequeRow[] {
  if (!lifecycle || typeof lifecycle !== 'object') return [];
  const record = lifecycle as Record<string, unknown>;
  const instructions = Array.isArray(record.chequeInstructions) ? record.chequeInstructions : [];
  const submissions = Array.isArray(record.chequeSubmissions) ? record.chequeSubmissions : [];
  const submitted = new Map<string, Record<string, unknown>>();
  for (const item of submissions) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const key = text(row.key);
    if (key) submitted.set(key, row);
  }

  const rows: ContractChequeRow[] = [];
  const seen = new Set<string>();
  for (const item of instructions) {
    if (!item || typeof item !== 'object') continue;
    const instruction = item as Record<string, unknown>;
    const key = text(instruction.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const submission = submitted.get(key);
    const minor = amount(instruction.amountMinor);
    if (!minor) continue;
    rows.push({
      key,
      kind: kindOf(instruction.kind, key),
      labelAr: text(instruction.labelAr) ?? key,
      labelEn: text(instruction.labelEn) ?? text(instruction.labelAr) ?? key,
      dueOn: text(instruction.dueOn),
      amountMinor: minor,
      currency: text(instruction.currency) ?? 'OMR',
      chequeNumber: text(submission?.chequeNumber) ?? text(instruction.suggestedChequeNumber),
      bankName: text(submission?.bankName),
      accountHolderName: text(submission?.accountHolderName),
      accountNumber: text(submission?.accountNumber),
    });
  }

  for (const [key, submission] of submitted) {
    if (seen.has(key)) continue;
    rows.push({
      key,
      kind: kindOf(null, key),
      labelAr: key,
      labelEn: key,
      dueOn: null,
      amountMinor: '0',
      currency: 'OMR',
      chequeNumber: text(submission.chequeNumber),
      bankName: text(submission.bankName),
      accountHolderName: text(submission.accountHolderName),
      accountNumber: text(submission.accountNumber),
    });
  }
  return rows.filter((row) => row.chequeNumber || row.amountMinor !== '0');
}

function rowsFromLeaseTerms(terms: LeaseTerms): ContractChequeRow[] {
  const rows: ContractChequeRow[] = terms.schedule.map((row) => ({
    key: `rent-${row.index}`,
    kind: 'rent' as const,
    labelAr: `شيك إيجار #${row.index}`,
    labelEn: `Rent cheque #${row.index}`,
    dueOn: row.dueOn,
    amountMinor: String(row.totalMinor),
    currency: terms.currency,
    chequeNumber: row.chequeNumber,
    bankName: row.bankName ?? terms.chequeBankName,
    accountHolderName: terms.chequeAccountName,
    accountNumber: null,
  }));
  for (const row of terms.vatCheques) {
    rows.push({
      key: `vat-${row.index}`,
      kind: 'vat',
      labelAr: `شيك ضريبة #${row.index}`,
      labelEn: `VAT cheque #${row.index}`,
      dueOn: row.dueOn,
      amountMinor: String(row.amountMinor),
      currency: terms.currency,
      chequeNumber: row.chequeNumber,
      bankName: terms.chequeBankName,
      accountHolderName: terms.chequeAccountName,
      accountNumber: null,
    });
  }
  for (const [index, item] of terms.depositItems.entries()) {
    if (item.method !== 'cheque') continue;
    rows.push({
      key: `deposit-${index}`,
      kind: 'deposit',
      labelAr: `شيك تأمين #${index + 1}`,
      labelEn: `Deposit cheque #${index + 1}`,
      dueOn: item.dueOn,
      amountMinor: String(item.amountMinor),
      currency: terms.currency,
      chequeNumber: item.reference,
      bankName: item.bankName,
      accountHolderName: terms.chequeAccountName,
      accountNumber: null,
    });
  }
  const hasNumber = rows.some((row) => row.chequeNumber);
  if (terms.paymentMethod !== 'cheque' && !hasNumber) return [];
  return rows;
}

/** Prefer submitted reservation cheques; fall back to the stored lease schedule. */
export function buildContractChequeAnnex(input: {
  reference: string;
  lifecycle: unknown;
  leaseTerms: LeaseTerms | null;
}): ContractChequeAnnex | null {
  const fromLifecycle = rowsFromLifecycle(input.lifecycle);
  const rows = fromLifecycle.length
    ? fromLifecycle
    : input.leaseTerms
      ? rowsFromLeaseTerms(input.leaseTerms)
      : [];
  if (!rows.length) return null;
  return { reference: input.reference, rows };
}
