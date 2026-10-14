/**
 * Receipts and demand invoices for what a tenant pays on a lease: each contract installment and
 * each bill on the lease gets a receipt once anything was paid on it, and a demand invoice while
 * anything is left. Built from the account statement; client-safe and pure.
 */

import { chargeCategoryOf, chargeLabel } from '@/lib/tenant-charges-shared';
import {
  ledgerLineLabel,
  ledgerStatusLabel,
  type LeaseStatement,
  type LedgerChequeStatus,
  type LedgerLine,
} from '@/lib/tenant-ledger';
import { domainStatusLabel } from '@/lib/ui-labels';

export type RentDocKind = 'receipt' | 'invoice';

export const RENT_DOC_KINDS: readonly RentDocKind[] = ['receipt', 'invoice'];

/** One amount on the lease the tenant owes or paid. */
export type RentDocSubject = {
  /** The statement line key, or `charge-<invoice id>` for a bill on the lease. */
  key: string;
  kind: LedgerLine['kind'] | 'charge';
  label: { ar: string; en: string };
  index: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  dueOn: string;
  amountMinor: string;
  paidMinor: string;
  outstandingMinor: string;
  status: { ar: string; en: string };
  settled: boolean;
  chequeNumber: string | null;
  bankName: string | null;
  chequeStatus: LedgerChequeStatus | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** The security deposit is held and refunded, not part of the contract value. */
  outsideTotal: boolean;
};

const LINE_KEY = /^(?:(?:rent|vat|deposit)-\d{1,3}|fees|(?:cheque|invoice|charge)-[0-9a-f-]{36})$/;
const OPEN_INVOICE = new Set(['issued', 'partially_paid', 'overdue']);

export function isRentDocKey(value: string): boolean {
  return LINE_KEY.test(value);
}

export function rentDocKindOf(value: string | string[] | undefined): RentDocKind | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'receipt' || raw === 'invoice' ? raw : null;
}

function left(amount: string, paid: string): string {
  const rest = BigInt(amount) - BigInt(paid);
  return (rest > 0n ? rest : 0n).toString();
}

/** Every amount of the statement, installments first, then the bills on the lease. */
export function rentDocSubjects(statement: LeaseStatement): RentDocSubject[] {
  const lines = statement.lines.map((line): RentDocSubject => ({
    key: line.key,
    kind: line.kind,
    label: { ar: ledgerLineLabel(line, true), en: ledgerLineLabel(line, false) },
    index: line.index,
    periodFrom: line.periodFrom,
    periodTo: line.periodTo,
    dueOn: line.dueOn,
    amountMinor: line.amountMinor,
    paidMinor: line.paidMinor,
    outstandingMinor: line.status === 'paid' ? '0' : left(line.amountMinor, line.paidMinor),
    status: { ar: ledgerStatusLabel(line.status, true), en: ledgerStatusLabel(line.status, false) },
    settled: line.status === 'paid',
    chequeNumber: line.chequeNumber,
    bankName: line.bankName,
    chequeStatus: line.chequeStatus,
    invoiceId: line.invoiceId,
    invoiceNumber: line.invoiceNumber,
    outsideTotal: line.outsideTotal,
  }));
  const bills = statement.otherInvoices.map((invoice): RentDocSubject => {
    const category = chargeCategoryOf(invoice.number);
    const open = OPEN_INVOICE.has(invoice.status);
    return {
      key: `charge-${invoice.id}`,
      kind: 'charge',
      label: category
        ? { ar: chargeLabel(category, true), en: chargeLabel(category, false) }
        : { ar: `فاتورة ${invoice.number}`, en: `Invoice ${invoice.number}` },
      index: null,
      periodFrom: invoice.billingPeriodStart,
      periodTo: null,
      dueOn: invoice.dueOn,
      amountMinor: invoice.totalMinor,
      paidMinor: invoice.paidMinor,
      outstandingMinor: open ? left(invoice.totalMinor, invoice.paidMinor) : '0',
      status: {
        ar: domainStatusLabel(invoice.status, true),
        en: domainStatusLabel(invoice.status, false),
      },
      settled: invoice.status === 'paid',
      chequeNumber: null,
      bankName: null,
      chequeStatus: null,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      outsideTotal: false,
    };
  });
  return [...lines, ...bills];
}

export function findRentDocSubject(statement: LeaseStatement, key: string): RentDocSubject | null {
  return rentDocSubjects(statement).find((subject) => subject.key === key) ?? null;
}

/** A receipt once anything was paid; a demand invoice while anything is left to pay. */
export function rentDocKindsOf(
  subject: Pick<RentDocSubject, 'paidMinor' | 'outstandingMinor'>,
): RentDocKind[] {
  const kinds: RentDocKind[] = [];
  if (subject.paidMinor !== '0') kinds.push('receipt');
  if (subject.outstandingMinor !== '0') kinds.push('invoice');
  return kinds;
}

function lineCode(key: string): string {
  const [kind, rest] = [key.split('-')[0]!, key.slice(key.indexOf('-') + 1)];
  if (key === 'fees') return 'F00';
  const number = Number(rest);
  switch (kind) {
    case 'rent':
      return `R${String(number).padStart(2, '0')}`;
    case 'vat':
      return `V${String(number).padStart(2, '0')}`;
    case 'deposit':
      return `D${String(number + 1).padStart(2, '0')}`;
    case 'cheque':
      return `C${rest.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    default:
      return `I${rest.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  }
}

/** `RC-2026-000004-R03` for a receipt, `INV-2026-000004-R03` for a demand invoice. */
export function rentDocNumber(
  kind: RentDocKind,
  contractReference: string | null,
  leaseId: string,
  key: string,
): string {
  const base =
    contractReference?.replace(/^CTR-/i, '').replace(/[^A-Za-z0-9-]/g, '') ||
    leaseId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${kind === 'receipt' ? 'RC' : 'INV'}-${base}-${lineCode(key)}`;
}

/** Locale-less app path of a document, for the tenant space or the owner's console. */
export function rentDocHref(
  portal: 'tenant' | 'owner',
  leaseId: string,
  key: string,
  kind: RentDocKind,
): string {
  const base = portal === 'tenant' ? '/tenant/invoices' : '/owner/rent-documents';
  return `${base}/${leaseId}/${key}?doc=${kind}`;
}

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];
const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthOf(isoDate: string, ar: boolean): { name: string; year: number } | null {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(isoDate);
  if (!match) return null;
  const month = Number(match[2]) - 1;
  return { name: (ar ? MONTHS_AR : MONTHS_EN)[month] ?? '', year: Number(match[1]) };
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
}

/**
 * The month the amount is for: the month its period starts in ("أكتوبر 2026"), or the months a
 * longer period covers ("أكتوبر – ديسمبر 2026"); the due month when there is no period.
 */
export function rentMonthLabel(
  subject: Pick<RentDocSubject, 'periodFrom' | 'periodTo' | 'dueOn'>,
  ar: boolean,
): string {
  const start = monthOf(subject.periodFrom ?? subject.dueOn, ar);
  if (!start) return '—';
  const end =
    subject.periodFrom && subject.periodTo && daysBetween(subject.periodFrom, subject.periodTo) > 45
      ? monthOf(subject.periodTo, ar)
      : null;
  if (!end || (end.name === start.name && end.year === start.year)) {
    return `${start.name} ${start.year}`;
  }
  return end.year === start.year
    ? `${start.name} – ${end.name} ${end.year}`
    : `${start.name} ${start.year} – ${end.name} ${end.year}`;
}

export const RENT_PAYMENT_METHOD_LABEL: Record<string, { ar: string; en: string }> = {
  cash: { ar: 'نقداً', en: 'Cash' },
  bank_transfer: { ar: 'تحويل بنكي', en: 'Bank transfer' },
  card: { ar: 'بطاقة', en: 'Card' },
  cheque: { ar: 'شيك', en: 'Cheque' },
};

export function rentPaymentMethodLabel(method: string, ar: boolean): string {
  const label = RENT_PAYMENT_METHOD_LABEL[method];
  return label ? (ar ? label.ar : label.en) : method;
}

/** First names written as two words ("عبد الله", "Abdul Hamid") stay whole. */
const COMPOUND_FIRST = /^(?:عبد|أبو|ابو|abdul|abd|abu)$/i;

/** First name in full, then initials: what a public verification page shows of a person. */
export function maskedPersonName(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '—';
  const first = words.length > 1 && COMPOUND_FIRST.test(words[0]!) ? 2 : 1;
  return [
    words.slice(0, first).join(' '),
    ...words.slice(first).map((word) => `${word.slice(0, 1)}.`),
  ].join(' ');
}
