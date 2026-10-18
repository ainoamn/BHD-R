/** Display labels for accounting hub — follow the active locale (AR / EN). */

type Locale = 'ar' | 'en';

const JOURNAL_STATUS: Record<string, { ar: string; en: string }> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  posted: { ar: 'مرحّل', en: 'Posted' },
  reversed: { ar: 'معكوس', en: 'Reversed' },
};

const EXPENSE_STATUS: Record<string, { ar: string; en: string }> = {
  pending: { ar: 'قيد الانتظار', en: 'Pending' },
  approved: { ar: 'معتمد', en: 'Approved' },
  paid: { ar: 'مدفوع', en: 'Paid' },
  void: { ar: 'ملغى', en: 'Void' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
  issued: { ar: 'صادرة', en: 'Issued' },
  partially_paid: { ar: 'مدفوعة جزئياً', en: 'Part paid' },
  overdue: { ar: 'متأخرة', en: 'Overdue' },
  succeeded: { ar: 'محصّلة', en: 'Collected' },
  draft: { ar: 'مسودة', en: 'Draft' },
};

const SOURCE_TYPE: Record<string, { ar: string; en: string }> = {
  manual: { ar: 'يدوي', en: 'Manual' },
  journal_reversal: { ar: 'عكس قيد', en: 'Journal reversal' },
  reservation_deposit: { ar: 'عربون حجز', en: 'Booking deposit' },
  stay_deposit_held: { ar: 'تأمين إقامة', en: 'Stay deposit held' },
  stay_payment: { ar: 'تحصيل إقامة', en: 'Stay payment' },
  rent_payment: { ar: 'تحصيل إيجار', en: 'Rent payment' },
  expense: { ar: 'مصروف', en: 'Expense' },
  ops_income: { ar: 'دخل تشغيلي', en: 'Operating income' },
  ops_purchase: { ar: 'مشتريات', en: 'Purchase' },
  ops_sale: { ar: 'مبيعات', en: 'Sale' },
  deposit_refund: { ar: 'استرداد تأمين', en: 'Deposit refund' },
  deposit_retained: { ar: 'خصم تأمين', en: 'Deposit retained' },
  tenant_charge: { ar: 'رسوم مستأجر', en: 'Tenant charge' },
  invoice: { ar: 'فاتورة', en: 'Invoice' },
  payment: { ar: 'دفعة', en: 'Payment' },
};

const DOC_KIND: Record<string, { ar: string; en: string }> = {
  receipt: { ar: 'إيصال', en: 'Receipt' },
  invoice: { ar: 'فاتورة', en: 'Invoice' },
  journal: { ar: 'قيد', en: 'Journal' },
};

const ACCOUNT_TYPE: Record<string, { ar: string; en: string }> = {
  asset: { ar: 'أصل', en: 'Asset' },
  liability: { ar: 'التزام', en: 'Liability' },
  equity: { ar: 'حقوق ملكية', en: 'Equity' },
  revenue: { ar: 'إيراد', en: 'Revenue' },
  expense: { ar: 'مصروف', en: 'Expense' },
};

/** Known fixed phrases stored on journals/documents → bilingual display. */
const PHRASE: Array<{ match: RegExp; ar: (m: RegExpMatchArray) => string; en: (m: RegExpMatchArray) => string }> = [
  {
    match: /^Reversal of\s+(.+)$/i,
    ar: (m) => `عكس القيد ${m[1]}`,
    en: (m) => `Reversal of ${m[1]}`,
  },
  {
    match: /^عكس القيد\s+(.+)$/i,
    ar: (m) => `عكس القيد ${m[1]}`,
    en: (m) => `Reversal of ${m[1]}`,
  },
  {
    match: /^Reversal:\s*(.*)$/i,
    ar: (m) => `عكس: ${m[1] || '—'}`,
    en: (m) => `Reversal: ${m[1] || '—'}`,
  },
  {
    match: /^تحصيل إقامة\s+(.+)$/i,
    ar: (m) => `تحصيل إقامة ${m[1]}`,
    en: (m) => `Stay collection ${m[1]}`,
  },
  {
    match: /^عربون حجز محتجز\s*(.*)$/i,
    ar: (m) => `عربون حجز محتجز${m[1] ? ` ${m[1]}` : ''}`.trim(),
    en: (m) => `Booking deposit held${m[1] ? ` ${m[1]}` : ''}`.trim(),
  },
  {
    match: /^تأمين إقامة محتجز\s*(.*)$/i,
    ar: (m) => `تأمين إقامة محتجز${m[1] ? ` ${m[1]}` : ''}`.trim(),
    en: (m) => `Stay deposit held${m[1] ? ` ${m[1]}` : ''}`.trim(),
  },
  {
    match: /^إيصال إقامة\s*[—\-–]?\s*(.*)$/i,
    ar: (m) => `إيصال إقامة${m[1] ? ` — ${m[1]}` : ''}`,
    en: (m) => `Stay receipt${m[1] ? ` — ${m[1]}` : ''}`,
  },
  {
    match: /^إيصال قبض(?:\s*[—\-–]\s*(.+))?$/i,
    ar: (m) => (m[1] ? `إيصال قبض — ${m[1]}` : 'إيصال قبض'),
    en: (m) => (m[1] ? `Receipt — ${m[1]}` : 'Receipt'),
  },
  {
    match: /^فاتورة مطالبة(?:\s*[—\-–]\s*(.+))?$/i,
    ar: (m) => (m[1] ? `فاتورة مطالبة — ${m[1]}` : 'فاتورة مطالبة'),
    en: (m) => (m[1] ? `Demand invoice — ${m[1]}` : 'Demand invoice'),
  },
  {
    match: /^مصروف\s+(.+)$/i,
    ar: (m) => `مصروف ${m[1]}`,
    en: (m) => `Expense ${m[1]}`,
  },
  {
    match: /^دخل:\s*(.+)$/i,
    ar: (m) => `دخل: ${m[1]}`,
    en: (m) => `Income: ${m[1]}`,
  },
  {
    match: /^مشتريات:\s*(.+)$/i,
    ar: (m) => `مشتريات: ${m[1]}`,
    en: (m) => `Purchase: ${m[1]}`,
  },
  {
    match: /^مبيعات:\s*(.+)$/i,
    ar: (m) => `مبيعات: ${m[1]}`,
    en: (m) => `Sale: ${m[1]}`,
  },
];

function pick(locale: Locale, row: { ar: string; en: string } | undefined, fallback: string) {
  if (!row) return fallback;
  return locale === 'ar' ? row.ar : row.en;
}

export function accountingJournalStatusLabel(status: string | null | undefined, locale: Locale) {
  if (!status) return '—';
  return pick(locale, JOURNAL_STATUS[status], status);
}

export function accountingExpenseStatusLabel(status: string | null | undefined, locale: Locale) {
  if (!status) return '—';
  return pick(locale, EXPENSE_STATUS[status] ?? JOURNAL_STATUS[status], status);
}

export function accountingSourceTypeLabel(sourceType: string | null | undefined, locale: Locale) {
  if (!sourceType) return pick(locale, SOURCE_TYPE.manual, locale === 'ar' ? 'يدوي' : 'Manual');
  return pick(locale, SOURCE_TYPE[sourceType], sourceType.replace(/_/g, ' '));
}

export function accountingDocKindLabel(kind: string | null | undefined, locale: Locale) {
  if (!kind) return '—';
  return pick(locale, DOC_KIND[kind], kind);
}

export function accountingAccountTypeLabel(type: string | null | undefined, locale: Locale) {
  if (!type) return '—';
  return pick(locale, ACCOUNT_TYPE[type], type);
}

/** Localize a stored journal/document title or description for the active language. */
export function accountingDisplayText(text: string | null | undefined, locale: Locale): string {
  if (!text) return '—';
  const trimmed = text.trim();
  for (const rule of PHRASE) {
    const match = trimmed.match(rule.match);
    if (match) return locale === 'ar' ? rule.ar(match) : rule.en(match);
  }
  // Raw source-type strings wrongly shown as party/property labels.
  if (SOURCE_TYPE[trimmed]) return pick(locale, SOURCE_TYPE[trimmed], trimmed);
  return trimmed;
}

const CHEQUE_STATUS: Record<string, { ar: string; en: string }> = {
  pending: { ar: 'قيد الانتظار', en: 'Pending' },
  accepted: { ar: 'مقبول', en: 'Accepted' },
  deposited: { ar: 'مودع للتحصيل', en: 'Deposited' },
  cleared: { ar: 'محصّل', en: 'Cleared' },
  bounced: { ar: 'مرتجع', en: 'Bounced' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
};

export function accountingChequeStatusLabel(status: string | null | undefined, locale: Locale) {
  if (!status) return '—';
  return pick(locale, CHEQUE_STATUS[status], status);
}
