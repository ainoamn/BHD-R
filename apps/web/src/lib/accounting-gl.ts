/**
 * Double-entry helpers and IFRS-style statement builders for the owner accounting hub.
 * Amounts are integer minor units (OMR: 3 decimals → 1000 = 1.000 ر.ع.).
 */

export type LedgerAccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export type JournalLineInput = {
  accountId: string;
  partyId?: string;
  propertyId?: string;
  unitId?: string;
  debitMinor: string;
  creditMinor: string;
  currency: string;
  memo?: string;
};

export type ChartSeed = {
  code: string;
  nameAr: string;
  nameEn: string;
  type: LedgerAccountType;
};

/** Lean IFRS chart for Oman property ops — aligned with legacy bhd-om DEFAULT_ACCOUNTS. */
export const DEFAULT_CHART_OF_ACCOUNTS: readonly ChartSeed[] = [
  { code: '1000', nameAr: 'الصندوق', nameEn: 'Cash', type: 'asset' },
  { code: '1100', nameAr: 'البنوك', nameEn: 'Banks', type: 'asset' },
  { code: '1150', nameAr: 'شيكات تحت التحصيل', nameEn: 'Cheques receivable', type: 'asset' },
  { code: '1200', nameAr: 'ذمم المستأجرين', nameEn: 'Tenant receivables', type: 'asset' },
  { code: '1210', nameAr: 'ذمم مدينة أخرى', nameEn: 'Other receivables', type: 'asset' },
  { code: '1300', nameAr: 'دفعات ومصروفات مقدمة', nameEn: 'Prepayments', type: 'asset' },
  {
    code: '1400',
    nameAr: 'ضريبة مدخلات قابلة للاسترداد',
    nameEn: 'Recoverable input VAT',
    type: 'asset',
  },
  { code: '1500', nameAr: 'أصول أخرى', nameEn: 'Other assets', type: 'asset' },
  { code: '2000', nameAr: 'الموردون', nameEn: 'Payables', type: 'liability' },
  { code: '2100', nameAr: 'تأمينات وعربونات مستلمة', nameEn: 'Deposits held', type: 'liability' },
  { code: '2200', nameAr: 'ضريبة القيمة المضافة', nameEn: 'VAT payable', type: 'liability' },
  { code: '2300', nameAr: 'التزامات أخرى', nameEn: 'Other liabilities', type: 'liability' },
  { code: '3000', nameAr: 'حقوق الملاك', nameEn: 'Owners equity', type: 'equity' },
  { code: '3100', nameAr: 'أرباح محتجزة', nameEn: 'Retained earnings', type: 'equity' },
  {
    code: '4000',
    nameAr: 'إيرادات الإيجار والإقامات',
    nameEn: 'Rent & stay revenue',
    type: 'revenue',
  },
  { code: '4100', nameAr: 'عمولات البيع', nameEn: 'Sales commission', type: 'revenue' },
  { code: '4200', nameAr: 'رسوم إدارية وخدمات', nameEn: 'Fees & services', type: 'revenue' },
  { code: '4300', nameAr: 'إيرادات أخرى', nameEn: 'Other revenue', type: 'revenue' },
  { code: '5000', nameAr: 'مصروفات التشغيل', nameEn: 'Operating expenses', type: 'expense' },
  { code: '5100', nameAr: 'مصروفات الصيانة', nameEn: 'Maintenance expenses', type: 'expense' },
  {
    code: '5200',
    nameAr: 'مصروفات إدارية وقانونية',
    nameEn: 'Admin & legal expenses',
    type: 'expense',
  },
  { code: '5300', nameAr: 'مرافق وإيجارات', nameEn: 'Utilities & rents', type: 'expense' },
  { code: '5400', nameAr: 'رواتب ومزايا', nameEn: 'Salaries & benefits', type: 'expense' },
  { code: '5500', nameAr: 'مصروفات أخرى', nameEn: 'Other expenses', type: 'expense' },
  { code: '5600', nameAr: 'مشتريات', nameEn: 'Purchases', type: 'expense' },
  { code: '4400', nameAr: 'مبيعات', nameEn: 'Sales', type: 'revenue' },
] as const;

export class AccountingBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountingBalanceError';
  }
}

function asBigInt(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new AccountingBalanceError(`Invalid ${field}`);
  return BigInt(value);
}

/** Every line is debit XOR credit; totals match per currency; ≥ 2 lines. */
export function validateBalanced(lines: readonly JournalLineInput[]): void {
  if (lines.length < 2) {
    throw new AccountingBalanceError('A journal requires at least two lines');
  }
  const balances = new Map<string, { debit: bigint; credit: bigint }>();
  for (const line of lines) {
    const debit = asBigInt(line.debitMinor, 'debitMinor');
    const credit = asBigInt(line.creditMinor, 'creditMinor');
    if ((debit > 0n && credit > 0n) || (debit === 0n && credit === 0n)) {
      throw new AccountingBalanceError('Each journal line must have either a debit or a credit');
    }
    const current = balances.get(line.currency) ?? { debit: 0n, credit: 0n };
    current.debit += debit;
    current.credit += credit;
    balances.set(line.currency, current);
  }
  for (const [currency, balance] of balances) {
    if (balance.debit !== balance.credit) {
      throw new AccountingBalanceError(`Journal is not balanced for ${currency}`);
    }
  }
}

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: LedgerAccountType;
  currency: string;
  debitMinor: string;
  creditMinor: string;
  /** Debit − credit (natural for assets/expenses; invert display for L/E/R if needed). */
  balanceMinor: string;
};

export type StatementSection = {
  titleAr: string;
  titleEn: string;
  totalMinor: string;
  rows: Array<{
    code: string;
    nameAr: string;
    nameEn: string;
    balanceMinor: string;
  }>;
};

export type IncomeStatement = {
  report: 'income';
  fromDate: string;
  toDate: string;
  currency: string;
  revenue: StatementSection;
  expenses: StatementSection;
  netIncomeMinor: string;
};

export type BalanceSheet = {
  report: 'balance';
  asOfDate: string;
  currency: string;
  assets: StatementSection;
  liabilities: StatementSection;
  equity: StatementSection;
  /** Assets should equal liabilities + equity + net income rolled into equity. */
  balanced: boolean;
  differenceMinor: string;
};

export type CashFlowReport = {
  report: 'cashflow';
  fromDate: string;
  toDate: string;
  currency: string;
  inflowMinor: string;
  outflowMinor: string;
  netMinor: string;
  lines: Array<{
    occurredOn: string;
    reference: string;
    description: string;
    accountCode: string;
    debitMinor: string;
    creditMinor: string;
  }>;
};

export type AgingBucketKey = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export type AgingReport = {
  report: 'aging';
  ledger: 'ar';
  asOfDate: string;
  currency: string;
  totalOutstandingMinor: string;
  buckets: Record<AgingBucketKey, string>;
  lines: Array<{
    invoiceId: string;
    invoiceNumber: string;
    dueOn: string | null;
    daysOverdue: number;
    bucket: AgingBucketKey;
    outstandingMinor: string;
    currency: string;
  }>;
};

function sumMinor(values: string[]): string {
  return values.reduce((acc, value) => acc + BigInt(value || '0'), 0n).toString();
}

function naturalBalance(type: LedgerAccountType, debit: bigint, credit: bigint): bigint {
  if (type === 'asset' || type === 'expense') return debit - credit;
  return credit - debit;
}

export function buildIncomeStatement(
  rows: TrialBalanceRow[],
  fromDate: string,
  toDate: string,
  currency: string,
): IncomeStatement {
  const scoped = rows.filter((row) => row.currency === currency);
  const pick = (type: LedgerAccountType, titleAr: string, titleEn: string): StatementSection => {
    const matched = scoped.filter((row) => row.type === type);
    const sectionRows = matched
      .map((row) => {
        const balance = naturalBalance(type, BigInt(row.debitMinor), BigInt(row.creditMinor));
        return {
          code: row.code,
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          balanceMinor: balance.toString(),
        };
      })
      .filter((row) => row.balanceMinor !== '0');
    return {
      titleAr,
      titleEn,
      totalMinor: sumMinor(sectionRows.map((row) => row.balanceMinor)),
      rows: sectionRows,
    };
  };
  const revenue = pick('revenue', 'الإيرادات', 'Revenue');
  const expenses = pick('expense', 'المصروفات', 'Expenses');
  const net = BigInt(revenue.totalMinor) - BigInt(expenses.totalMinor);
  return {
    report: 'income',
    fromDate,
    toDate,
    currency,
    revenue,
    expenses,
    netIncomeMinor: net.toString(),
  };
}

export function buildBalanceSheet(
  rows: TrialBalanceRow[],
  asOfDate: string,
  currency: string,
  netIncomeMinor = '0',
): BalanceSheet {
  const scoped = rows.filter((row) => row.currency === currency);
  const section = (
    types: LedgerAccountType[],
    titleAr: string,
    titleEn: string,
  ): StatementSection => {
    const matched = scoped.filter((row) => types.includes(row.type));
    const sectionRows = matched
      .map((row) => {
        const balance = naturalBalance(row.type, BigInt(row.debitMinor), BigInt(row.creditMinor));
        return {
          code: row.code,
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          balanceMinor: balance.toString(),
        };
      })
      .filter((row) => row.balanceMinor !== '0');
    return {
      titleAr,
      titleEn,
      totalMinor: sumMinor(sectionRows.map((row) => row.balanceMinor)),
      rows: sectionRows,
    };
  };
  const assets = section(['asset'], 'الأصول', 'Assets');
  const liabilities = section(['liability'], 'الالتزامات', 'Liabilities');
  const equityBase = section(['equity'], 'حقوق الملكية', 'Equity');
  const equityTotal = (BigInt(equityBase.totalMinor) + BigInt(netIncomeMinor)).toString();
  const equity: StatementSection = {
    ...equityBase,
    totalMinor: equityTotal,
    rows:
      netIncomeMinor === '0'
        ? equityBase.rows
        : [
            ...equityBase.rows,
            {
              code: 'NI',
              nameAr: 'صافي دخل الفترة',
              nameEn: 'Period net income',
              balanceMinor: netIncomeMinor,
            },
          ],
  };
  const right = BigInt(liabilities.totalMinor) + BigInt(equity.totalMinor);
  const left = BigInt(assets.totalMinor);
  const difference = left - right;
  return {
    report: 'balance',
    asOfDate,
    currency,
    assets,
    liabilities,
    equity,
    balanced: difference === 0n,
    differenceMinor: difference.toString(),
  };
}

export function agingBucket(daysOverdue: number): AgingBucketKey {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.floor((to - from) / 86_400_000);
}

export const ACCOUNTING_HUB_TABS = [
  'dashboard',
  'documents',
  'journal',
  'deposits',
  'accounts',
  'expenses',
  'trading',
  'cheques',
  'ledgers',
  'reports',
  'periods',
  'audit',
] as const;

export type AccountingHubTab = (typeof ACCOUNTING_HUB_TABS)[number];

export function parseAccountingHubTab(value: string | null | undefined): AccountingHubTab {
  return ACCOUNTING_HUB_TABS.includes(value as AccountingHubTab)
    ? (value as AccountingHubTab)
    : 'dashboard';
}
