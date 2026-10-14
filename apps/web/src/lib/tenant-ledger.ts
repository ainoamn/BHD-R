/**
 * The tenant's account statement for one lease: every installment the contract calls for, by due
 * date, matched with the cheques the landlord holds and the invoices paid, then what was paid,
 * what is overdue and what remains of the full contract value. Client-safe and pure.
 */

import { chargeCategoryOf, chargeLabel, type ChargeCategory } from '@/lib/tenant-charges-shared';

export type LedgerChequeStatus =
  'pending' | 'accepted' | 'rejected' | 'deposited' | 'cleared' | 'bounced' | 'cancelled';

export type LedgerCheque = {
  id: string;
  chequeNumber: string;
  bankName: string | null;
  amountMinor: string;
  dueOn: string;
  reviewStatus: LedgerChequeStatus;
};

export type LedgerInvoice = {
  id: string;
  number: string;
  status: string;
  issuedOn: string;
  dueOn: string;
  totalMinor: string;
  paidMinor: string;
  billingPeriodStart: string | null;
};

/** The parts of the signed contract's lease terms the statement reads. */
export type LedgerTerms = {
  startsOn: string;
  paymentMethod: string;
  grandTotalMinor: number;
  schedule: Array<{
    index: number;
    periodFrom: string | null;
    periodTo: string | null;
    dueOn: string;
    totalMinor: number;
    chequeNumber: string | null;
    bankName: string | null;
  }>;
  vatCheques: Array<{
    index: number;
    dueOn: string;
    amountMinor: number;
    chequeNumber: string | null;
  }>;
  depositItems: Array<{
    method: string;
    amountMinor: number;
    reference: string | null;
    bankName: string | null;
    dueOn: string | null;
  }>;
};

export type LedgerLineKind = 'rent' | 'vat' | 'fees' | 'deposit' | 'invoice' | 'cheque';

export type LedgerLineStatus =
  | 'paid'
  | 'partially_paid'
  | 'overdue'
  | 'bounced'
  | 'stopped'
  | 'collecting'
  | 'due_soon'
  | 'upcoming'
  | 'due';

export type LedgerLine = {
  key: string;
  kind: LedgerLineKind;
  /** 1-based installment number for rent and VAT rows. */
  index: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  dueOn: string;
  /** The contract's date when the landlord moved the cheque. */
  originalDueOn: string | null;
  amountMinor: string;
  paidMinor: string;
  status: LedgerLineStatus;
  chequeId: string | null;
  chequeStatus: LedgerChequeStatus | null;
  chequeNumber: string | null;
  bankName: string | null;
  invoiceNumber: string | null;
  /** The security deposit is held, not part of the contract value. */
  outsideTotal: boolean;
};

export type LeaseStatement = {
  contractTotalMinor: string;
  paidMinor: string;
  overdueMinor: string;
  remainingMinor: string;
  nextDue: { dueOn: string; amountMinor: string } | null;
  lines: LedgerLine[];
  /** Invoices that are not one of the contract's installments: services, fines, extras. */
  otherInvoices: LedgerInvoice[];
  otherOutstandingMinor: string;
  /** Everything the tenant is late on: rent, VAT, bounced cheques and overdue bills. */
  arrears: LeaseArrears;
};

export type ArrearsCategory = 'rent' | 'vat' | 'cheque' | ChargeCategory;

export type ArrearsItem = {
  key: string;
  category: ArrearsCategory;
  dueOn: string;
  /** What is still owed on it. */
  amountMinor: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  index: number | null;
};

export type LeaseArrears = {
  totalMinor: string;
  items: ArrearsItem[];
  /** Totals per category, largest first. */
  byCategory: Array<{ category: ArrearsCategory; amountMinor: string }>;
};

const DUE_SOON_DAYS = 14;
const OPEN_INVOICE = new Set(['issued', 'partially_paid', 'overdue']);

function big(value: string | number | null | undefined): bigint {
  if (typeof value === 'number') return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;
  return value && /^-?\d+$/.test(value) ? BigInt(value) : 0n;
}

function plusDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function lineStatus(
  amount: bigint,
  paid: bigint,
  dueOn: string,
  cheque: LedgerCheque | null,
  today: string,
): LedgerLineStatus {
  if (paid >= amount) return 'paid';
  if (cheque?.reviewStatus === 'bounced') return 'bounced';
  if (cheque?.reviewStatus === 'cancelled') return 'stopped';
  if (cheque?.reviewStatus === 'deposited') return 'collecting';
  const holdsCheque = cheque?.reviewStatus === 'pending' || cheque?.reviewStatus === 'accepted';
  if (dueOn < today) {
    if (holdsCheque) return 'collecting';
    return paid > 0n ? 'partially_paid' : 'overdue';
  }
  if (paid > 0n) return 'partially_paid';
  return dueOn <= plusDays(today, DUE_SOON_DAYS) ? 'due_soon' : 'upcoming';
}

/** Unpaid amounts the tenant is late on: not cheques the landlord still has to deposit. */
function countsOverdue(line: LedgerLine, today: string): boolean {
  if (line.outsideTotal || line.status === 'paid' || line.status === 'collecting') return false;
  if (line.status === 'bounced') return true;
  return line.dueOn < today && line.status !== 'due';
}

type Draft = Omit<LedgerLine, 'status' | 'paidMinor' | 'chequeStatus'> & {
  paid: bigint;
  cheque: LedgerCheque | null;
};

function finish(draft: Draft, today: string): LedgerLine {
  const amount = big(draft.amountMinor);
  const { cheque, paid, ...rest } = draft;
  return {
    ...rest,
    chequeStatus: cheque?.reviewStatus ?? null,
    paidMinor: min(paid, amount).toString(),
    status:
      draft.kind === 'fees' && paid < amount
        ? 'due'
        : lineStatus(amount, paid, draft.dueOn, cheque, today),
  };
}

export function buildLeaseStatement(input: {
  terms: LedgerTerms | null;
  contractAmountMinor: string | null;
  cheques: LedgerCheque[];
  invoices: LedgerInvoice[];
  /** YYYY-MM-DD in the landlord's time zone. */
  today: string;
}): LeaseStatement {
  const { terms, today } = input;
  const byNumber = new Map(input.cheques.map((cheque) => [cheque.chequeNumber, cheque]));
  const usedCheques = new Set<string>();
  const usedInvoices = new Set<string>();
  const invoices = input.invoices.filter((invoice) => invoice.status !== 'void');
  const installmentInvoices = invoices.filter((invoice) => !chargeCategoryOf(invoice.number));
  const drafts: Draft[] = [];

  const chequeFor = (number: string | null) => {
    if (!number) return null;
    const cheque = byNumber.get(number) ?? null;
    if (cheque) usedCheques.add(cheque.id);
    return cheque;
  };
  const chequePaid = (cheque: LedgerCheque | null, amount: bigint) =>
    cheque?.reviewStatus === 'cleared' ? amount : 0n;

  if (terms) {
    for (const row of terms.schedule) {
      const cheque = chequeFor(row.chequeNumber);
      const invoice = installmentInvoices.find(
        (item) =>
          !usedInvoices.has(item.id) &&
          ((row.periodFrom && item.billingPeriodStart === row.periodFrom) ||
            (!item.billingPeriodStart && item.dueOn === row.dueOn)),
      );
      if (invoice) usedInvoices.add(invoice.id);
      const amount = BigInt(Math.trunc(row.totalMinor));
      const dueOn = cheque?.dueOn ?? row.dueOn;
      drafts.push({
        key: `rent-${row.index}`,
        kind: 'rent',
        index: row.index,
        periodFrom: row.periodFrom,
        periodTo: row.periodTo,
        dueOn,
        originalDueOn: dueOn !== row.dueOn ? row.dueOn : null,
        amountMinor: amount.toString(),
        paid: chequePaid(cheque, amount) || big(invoice?.paidMinor),
        cheque,
        chequeId: cheque?.id ?? null,
        chequeNumber: row.chequeNumber,
        bankName: cheque?.bankName ?? row.bankName,
        invoiceNumber: invoice?.number ?? null,
        outsideTotal: false,
      });
    }
    for (const row of terms.vatCheques) {
      const cheque = chequeFor(row.chequeNumber);
      const amount = BigInt(Math.trunc(row.amountMinor));
      const dueOn = cheque?.dueOn ?? row.dueOn;
      drafts.push({
        key: `vat-${row.index}`,
        kind: 'vat',
        index: row.index,
        periodFrom: null,
        periodTo: null,
        dueOn,
        originalDueOn: dueOn !== row.dueOn ? row.dueOn : null,
        amountMinor: amount.toString(),
        paid: chequePaid(cheque, amount),
        cheque,
        chequeId: cheque?.id ?? null,
        chequeNumber: row.chequeNumber,
        bankName: cheque?.bankName ?? null,
        invoiceNumber: null,
        outsideTotal: false,
      });
    }
    const scheduled = drafts.reduce((sum, line) => sum + big(line.amountMinor), 0n);
    const fees = BigInt(Math.trunc(terms.grandTotalMinor)) - scheduled;
    if (fees > 0n) {
      drafts.push({
        key: 'fees',
        kind: 'fees',
        index: null,
        periodFrom: null,
        periodTo: null,
        dueOn: terms.startsOn,
        originalDueOn: null,
        amountMinor: fees.toString(),
        paid: 0n,
        cheque: null,
        chequeId: null,
        chequeNumber: null,
        bankName: null,
        invoiceNumber: null,
        outsideTotal: false,
      });
    }
    terms.depositItems.forEach((item, at) => {
      const cheque = item.method === 'cheque' ? chequeFor(item.reference) : null;
      const amount = BigInt(Math.trunc(item.amountMinor));
      if (amount <= 0n) return;
      drafts.push({
        key: `deposit-${at}`,
        kind: 'deposit',
        index: null,
        periodFrom: null,
        periodTo: null,
        dueOn: cheque?.dueOn ?? item.dueOn ?? terms.startsOn,
        originalDueOn: null,
        amountMinor: amount.toString(),
        paid: chequePaid(cheque, amount),
        cheque,
        chequeId: cheque?.id ?? null,
        chequeNumber: item.method === 'cheque' ? item.reference : null,
        bankName: cheque?.bankName ?? item.bankName,
        invoiceNumber: null,
        outsideTotal: true,
      });
    });
  }

  // Cheques the landlord recorded outside the contract's schedule (or a lease with no terms).
  for (const cheque of input.cheques) {
    if (usedCheques.has(cheque.id)) continue;
    const amount = big(cheque.amountMinor);
    drafts.push({
      key: `cheque-${cheque.id}`,
      kind: 'cheque',
      index: null,
      periodFrom: null,
      periodTo: null,
      dueOn: cheque.dueOn,
      originalDueOn: null,
      amountMinor: amount.toString(),
      paid: chequePaid(cheque, amount),
      cheque,
      chequeId: cheque.id,
      chequeNumber: cheque.chequeNumber,
      bankName: cheque.bankName,
      invoiceNumber: null,
      outsideTotal: false,
    });
  }

  // With no contract schedule and no cheques, the invoices are the installments.
  const invoicesAreInstallments = !terms && !input.cheques.length;
  if (invoicesAreInstallments) {
    for (const invoice of installmentInvoices) {
      usedInvoices.add(invoice.id);
      drafts.push({
        key: `invoice-${invoice.id}`,
        kind: 'invoice',
        index: null,
        periodFrom: invoice.billingPeriodStart,
        periodTo: null,
        dueOn: invoice.dueOn,
        originalDueOn: null,
        amountMinor: big(invoice.totalMinor).toString(),
        paid: big(invoice.paidMinor),
        cheque: null,
        chequeId: null,
        chequeNumber: null,
        bankName: null,
        invoiceNumber: invoice.number,
        outsideTotal: false,
      });
    }
  }

  const lines = drafts
    .map((draft) => finish(draft, today))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.key.localeCompare(b.key));
  const counted = lines.filter((line) => !line.outsideTotal);
  const linesTotal = counted.reduce((sum, line) => sum + big(line.amountMinor), 0n);
  const contractTotal = terms
    ? BigInt(Math.trunc(terms.grandTotalMinor))
    : big(input.contractAmountMinor) > linesTotal
      ? big(input.contractAmountMinor)
      : linesTotal;
  const paid = counted.reduce((sum, line) => sum + big(line.paidMinor), 0n);
  const overdue = counted
    .filter((line) => countsOverdue(line, today))
    .reduce((sum, line) => sum + big(line.amountMinor) - big(line.paidMinor), 0n);
  const remaining = contractTotal - paid;
  const next = counted.find(
    (line) => line.status !== 'paid' && line.status !== 'collecting' && line.dueOn >= today,
  );
  const otherInvoices = invoices.filter((invoice) => !usedInvoices.has(invoice.id));
  const otherOutstanding = otherInvoices
    .filter((invoice) => OPEN_INVOICE.has(invoice.status))
    .reduce((sum, invoice) => {
      const left = big(invoice.totalMinor) - big(invoice.paidMinor);
      return sum + (left > 0n ? left : 0n);
    }, 0n);

  const arrearsItems: ArrearsItem[] = [
    ...counted
      .filter((line) => countsOverdue(line, today))
      .map((line): ArrearsItem => ({
        key: line.key,
        category: line.kind === 'vat' ? 'vat' : line.kind === 'cheque' ? 'cheque' : 'rent',
        dueOn: line.dueOn,
        amountMinor: (big(line.amountMinor) - big(line.paidMinor)).toString(),
        invoiceId: null,
        invoiceNumber: line.invoiceNumber,
        index: line.index,
      })),
    ...otherInvoices
      .filter(
        (invoice) =>
          OPEN_INVOICE.has(invoice.status) &&
          (invoice.status === 'overdue' || invoice.dueOn < today) &&
          big(invoice.totalMinor) > big(invoice.paidMinor),
      )
      .map((invoice) => ({
        key: `invoice-${invoice.id}`,
        category: chargeCategoryOf(invoice.number) ?? ('other' as const),
        dueOn: invoice.dueOn,
        amountMinor: (big(invoice.totalMinor) - big(invoice.paidMinor)).toString(),
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        index: null,
      })),
  ].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const perCategory = new Map<ArrearsCategory, bigint>();
  for (const item of arrearsItems) {
    perCategory.set(item.category, (perCategory.get(item.category) ?? 0n) + big(item.amountMinor));
  }

  return {
    contractTotalMinor: contractTotal.toString(),
    paidMinor: paid.toString(),
    overdueMinor: overdue.toString(),
    remainingMinor: (remaining > 0n ? remaining : 0n).toString(),
    nextDue: next
      ? {
          dueOn: next.dueOn,
          amountMinor: (big(next.amountMinor) - big(next.paidMinor)).toString(),
        }
      : null,
    lines,
    otherInvoices,
    otherOutstandingMinor: otherOutstanding.toString(),
    arrears: {
      totalMinor: arrearsItems.reduce((sum, item) => sum + big(item.amountMinor), 0n).toString(),
      items: arrearsItems,
      byCategory: [...perCategory.entries()]
        .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
        .map(([category, amount]) => ({ category, amountMinor: amount.toString() })),
    },
  };
}

const ARREARS_LABEL: Record<'rent' | 'vat' | 'cheque', { ar: string; en: string }> = {
  rent: { ar: 'إيجار متأخر', en: 'Overdue rent' },
  vat: { ar: 'ضريبة القيمة المضافة', en: 'VAT' },
  cheque: { ar: 'شيك مرتجع أو غير مسدد', en: 'Bounced or unpaid cheque' },
};

export function arrearsLabel(category: ArrearsCategory, ar: boolean): string {
  if (category === 'rent' || category === 'vat' || category === 'cheque') {
    return ar ? ARREARS_LABEL[category].ar : ARREARS_LABEL[category].en;
  }
  return chargeLabel(category, ar);
}

/** Lease terms from a contract payload, or null when the contract carries none. */
export function ledgerTermsOf(payload: unknown): LedgerTerms | null {
  const terms =
    payload && typeof payload === 'object'
      ? (payload as { leaseTerms?: unknown }).leaseTerms
      : null;
  if (!terms || typeof terms !== 'object') return null;
  const value = terms as Partial<{
    startsOn: string;
    paymentMethod: string;
    totals: { grandTotalMinor?: number };
    schedule: LedgerTerms['schedule'];
    vatCheques: LedgerTerms['vatCheques'];
    depositItems: LedgerTerms['depositItems'];
  }>;
  if (typeof value.startsOn !== 'string' || !Array.isArray(value.schedule)) return null;
  return {
    startsOn: value.startsOn,
    paymentMethod: typeof value.paymentMethod === 'string' ? value.paymentMethod : 'cheque',
    grandTotalMinor: Number(value.totals?.grandTotalMinor ?? 0) || 0,
    schedule: value.schedule.filter(
      (row) => row && typeof row.dueOn === 'string' && Number.isFinite(row.totalMinor),
    ),
    vatCheques: Array.isArray(value.vatCheques)
      ? value.vatCheques.filter((row) => row && typeof row.dueOn === 'string')
      : [],
    depositItems: Array.isArray(value.depositItems) ? value.depositItems : [],
  };
}

const STATUS_LABEL: Record<LedgerLineStatus, { ar: string; en: string }> = {
  paid: { ar: 'مدفوع', en: 'Paid' },
  partially_paid: { ar: 'مدفوع جزئياً', en: 'Part paid' },
  overdue: { ar: 'متأخر', en: 'Overdue' },
  bounced: { ar: 'شيك مرتجع', en: 'Cheque bounced' },
  stopped: { ar: 'شيك موقوف', en: 'Cheque stopped' },
  collecting: { ar: 'قيد التحصيل', en: 'Being collected' },
  due_soon: { ar: 'مستحق قريباً', en: 'Due soon' },
  upcoming: { ar: 'قادم', en: 'Upcoming' },
  due: { ar: 'مستحق بموجب العقد', en: 'Due under the contract' },
};

export function ledgerStatusLabel(status: LedgerLineStatus, ar: boolean): string {
  return ar ? STATUS_LABEL[status].ar : STATUS_LABEL[status].en;
}

export function ledgerLineLabel(line: LedgerLine, ar: boolean): string {
  switch (line.kind) {
    case 'rent':
      return ar
        ? `قسط الإيجار ${line.index ?? ''}`.trim()
        : `Rent installment ${line.index ?? ''}`.trim();
    case 'vat':
      return ar
        ? `ضريبة القيمة المضافة ${line.index ?? ''}`.trim()
        : `VAT ${line.index ?? ''}`.trim();
    case 'fees':
      return ar ? 'رسوم وإضافات العقد' : 'Contract fees and additions';
    case 'deposit':
      return ar ? 'التأمين (يُسترد، خارج قيمة العقد)' : 'Security deposit (refundable)';
    case 'invoice':
      return ar
        ? `فاتورة ${line.invoiceNumber ?? ''}`.trim()
        : `Invoice ${line.invoiceNumber ?? ''}`.trim();
    default:
      return ar ? 'شيك' : 'Cheque';
  }
}

/** Cheques the tenant may ask to stop or postpone: still with the landlord, not yet cashed. */
export function chequeIsAdjustable(line: LedgerLine): boolean {
  return (
    Boolean(line.chequeId) &&
    line.status !== 'paid' &&
    (line.chequeStatus === 'pending' || line.chequeStatus === 'accepted')
  );
}
