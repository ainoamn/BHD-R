'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DepositLedgerPanel } from '@/components/accounting/deposit-ledger';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  ACCOUNTING_HUB_TABS,
  parseAccountingHubTab,
  type AccountingHubTab,
  type LedgerAccountType,
} from '@/lib/accounting-gl';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';

type Caps = { manage: boolean; post: boolean };
type HubDash = {
  totalsByCurrency: Array<{
    currency: string;
    receivableMinor: string;
    collectedMinor: string;
    expenseMinor: string;
  }>;
  draftJournals: number;
  overdueInvoices: number;
  accountCount: number;
  postedJournals: number;
  capabilities: Caps;
};
type Account = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: LedgerAccountType;
  active: boolean;
  system: boolean;
};
type JournalRow = {
  id: string;
  reference: string;
  occurredOn: string;
  description: string;
  status: string;
  currency: string | null;
  debitMinor: string | null;
  creditMinor: string | null;
};
type ExpenseRow = {
  id: string;
  reference: string;
  category: string;
  description: string;
  amountMinor: string;
  taxMinor: string;
  currency: string;
  status: string;
  issuedOn: string;
};
type PeriodRow = {
  id: string;
  from: string;
  to: string;
  locked: boolean;
  note: string | null;
  at: string;
};
type AuditRow = {
  id: string;
  resourceType: string;
  resourceId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  occurredAt: string;
};
type DraftLine = {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
};

const TAB_LABEL: Record<AccountingHubTab, { ar: string; en: string }> = {
  dashboard: { ar: 'لوحة التحكم', en: 'Dashboard' },
  deposits: { ar: 'أمانات التأمين', en: 'Deposits' },
  accounts: { ar: 'دليل الحسابات', en: 'Chart of accounts' },
  journal: { ar: 'قيود اليومية', en: 'Journal' },
  expenses: { ar: 'المصروفات', en: 'Expenses' },
  ledgers: { ar: 'أستاذ تحليلي', en: 'Dimensional ledger' },
  reports: { ar: 'التقارير', en: 'Reports' },
  periods: { ar: 'الفترات', en: 'Periods' },
  audit: { ar: 'التدقيق', en: 'Audit' },
};

const TYPE_LABEL: Record<LedgerAccountType, { ar: string; en: string }> = {
  asset: { ar: 'أصل', en: 'Asset' },
  liability: { ar: 'التزام', en: 'Liability' },
  equity: { ar: 'حقوق ملكية', en: 'Equity' },
  revenue: { ar: 'إيراد', en: 'Revenue' },
  expense: { ar: 'مصروف', en: 'Expense' },
};

function money(minor: string | null | undefined, currency = 'OMR', ar = true) {
  if (!minor || !/^-?\d+$/.test(minor)) return '—';
  const negative = minor.startsWith('-');
  const abs = negative ? minor.slice(1) : minor;
  const formatted = formatMoney(abs, currency, ar ? 'ar' : 'en');
  return negative ? `−${formatted}` : formatted;
}

function toMinor(value: string): string {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) return '0';
  const parts = normalized.split('.');
  const whole = parts[0] ?? '0';
  const frac = parts[1] ?? '';
  if (!/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) return '0';
  const padded = `${frac}000`.slice(0, 3);
  return `${BigInt(whole) * 1000n + BigInt(padded)}`.replace(/^0+(?=\d)/, '') || '0';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { messageAr?: string; message?: string; code?: string };
    } | null;
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'request_failed',
      payload?.error?.messageAr ?? payload?.error?.message ?? 'Request failed',
    );
  }
  return response.json() as Promise<T>;
}

/**
 * World-class owner accounting hub (ported from bhd-om patterns): CoA, balanced journals,
 * IFRS-style statements, period lock, audit — on top of Neon double-entry tables.
 */
export function AccountingHub({
  portal,
  locale,
  active,
}: {
  portal: string;
  locale: 'ar' | 'en';
  active: boolean;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('focus')
    ? 'deposits'
    : parseAccountingHubTab(searchParams.get('tab'));
  const [dash, setDash] = useState<HubDash | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<JournalRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [reportKind, setReportKind] = useState('trial');
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 4)}-01-01`);
  const [toDate, setToDate] = useState(todayIso());
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState({
    code: '',
    nameAr: '',
    nameEn: '',
    type: 'expense' as LedgerAccountType,
  });
  const [journalForm, setJournalForm] = useState({
    occurredOn: todayIso(),
    description: '',
    post: true,
    lines: [
      { accountId: '', debit: '', credit: '', memo: '' },
      { accountId: '', debit: '', credit: '', memo: '' },
    ] as DraftLine[],
  });
  const [expenseForm, setExpenseForm] = useState({
    category: 'تشغيل',
    description: '',
    amount: '',
    issuedOn: todayIso(),
    propertyId: '',
    unitId: '',
    partyId: '',
  });
  const [periodForm, setPeriodForm] = useState({
    from: `${todayIso().slice(0, 4)}-01-01`,
    to: todayIso(),
    note: '',
  });
  const [ledgerScope, setLedgerScope] = useState<'propertyId' | 'unitId' | 'partyId'>('propertyId');
  const [ledgerId, setLedgerId] = useState(searchParams.get('propertyId') ?? '');
  const [ledgerRows, setLedgerRows] = useState<
    Array<{
      reference: string;
      occurredOn: string;
      accountCode: string;
      accountNameAr: string;
      accountNameEn: string;
      debitMinor: string;
      creditMinor: string;
      currency: string;
      partyName: string | null;
      propertyNameAr: string | null;
      unitCode: string | null;
      description: string;
    }>
  >([]);
  const [ledgerTotals, setLedgerTotals] = useState({ debitMinor: '0', creditMinor: '0' });

  const caps = dash?.capabilities ?? { manage: false, post: false };
  const omr = dash?.totalsByCurrency.find((row) => row.currency === 'OMR') ??
    dash?.totalsByCurrency[0] ?? {
      currency: 'OMR',
      receivableMinor: '0',
      collectedMinor: '0',
      expenseMinor: '0',
    };

  const setTab = useCallback(
    (next: AccountingHubTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next !== 'deposits') params.delete('focus');
      if (next === 'dashboard') params.delete('tab');
      else params.set('tab', next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const refreshDash = useCallback(async () => {
    const data = await getJson<HubDash>('/api/owner/accounting/hub');
    setDash(data);
  }, []);

  const loadTab = useCallback(
    async (current: AccountingHubTab) => {
      setError(null);
      if (current === 'dashboard' || current === 'deposits') {
        await refreshDash();
        return;
      }
      if (current === 'accounts') {
        const data = await getJson<{ accounts: Account[] }>('/api/owner/accounting/accounts');
        setAccounts(data.accounts);
        await refreshDash();
        return;
      }
      if (current === 'journal') {
        const [journalData, accountData] = await Promise.all([
          getJson<{ journals: JournalRow[] }>('/api/owner/accounting/journals'),
          getJson<{ accounts: Account[] }>('/api/owner/accounting/accounts'),
        ]);
        setJournals(journalData.journals);
        setAccounts(accountData.accounts);
        return;
      }
      if (current === 'expenses') {
        const data = await getJson<{ expenses: ExpenseRow[] }>('/api/owner/accounting/expenses');
        setExpenses(data.expenses);
        return;
      }
      if (current === 'ledgers') {
        if (!ledgerId.trim()) {
          setLedgerRows([]);
          setLedgerTotals({ debitMinor: '0', creditMinor: '0' });
          return;
        }
        const data = await getJson<{
          rows: typeof ledgerRows;
          totals: { debitMinor: string; creditMinor: string };
        }>(
          `/api/owner/accounting/ledgers?${encodeURIComponent(ledgerScope)}=${encodeURIComponent(ledgerId.trim())}&fromDate=${fromDate}&toDate=${toDate}`,
        );
        setLedgerRows(data.rows);
        setLedgerTotals(data.totals);
        return;
      }
      if (current === 'reports') {
        const data = await getJson<Record<string, unknown>>(
          `/api/owner/accounting/reports?report=${encodeURIComponent(reportKind)}&fromDate=${fromDate}&toDate=${toDate}&asOfDate=${toDate}`,
        );
        setReport(data);
        return;
      }
      if (current === 'periods') {
        const data = await getJson<{ periods: PeriodRow[] }>('/api/owner/accounting/periods');
        setPeriods(data.periods);
        return;
      }
      if (current === 'audit') {
        const data = await getJson<{ events: AuditRow[] }>('/api/owner/accounting/audit');
        setAudit(data.events);
      }
    },
    [fromDate, ledgerId, ledgerScope, refreshDash, reportKind, toDate],
  );

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setBusy(true);
    void loadTab(tab)
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : ar ? 'تعذر التحميل' : 'Load failed');
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, ar, loadTab, tab]);

  const lineBalance = useMemo(() => {
    let debit = 0n;
    let credit = 0n;
    for (const line of journalForm.lines) {
      debit += BigInt(toMinor(line.debit));
      credit += BigInt(toMinor(line.credit));
    }
    return { debit, credit, ok: debit === credit && debit > 0n };
  }, [journalForm.lines]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await loadTab(tab);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar ? 'تعذر الحفظ' : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="accounting-hub" data-testid="accounting-hub" hidden={!active}>
      <header className="accounting-hub__head">
        <div>
          <h1>{ar ? 'نظام المحاسبة' : 'Accounting system'}</h1>
          <p>
            {ar
              ? 'قيد مزدوج، دليل حسابات، تقارير مالية، إقفال فترات، وأمانات التأمين — بمعايير محاسبة عالمية للعقار.'
              : 'Double-entry, chart of accounts, financial statements, period lock, and trust deposits — world-class property accounting.'}
          </p>
        </div>
        <div className="accounting-hub__actions">
          <a
            className="button button--quiet button--sm"
            href="https://hisaby.bhd-om.com"
            target="_blank"
            rel="noreferrer"
          >
            {ar ? 'فتح حسابي (كشوفات مفصّلة)' : 'Open Hisaby'}
          </a>
        </div>
      </header>

      <div
        className="accounting-hub__tabs"
        role="tablist"
        aria-label={ar ? 'أقسام المحاسبة' : 'Accounting tabs'}
      >
        {ACCOUNTING_HUB_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="accounting-hub__tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {ar ? TAB_LABEL[id].ar : TAB_LABEL[id].en}
          </button>
        ))}
      </div>

      {error ? <p className="accounting-hub__error">{error}</p> : null}
      {busy ? <p className="accounting-hub__muted">{ar ? 'جاري التحديث…' : 'Updating…'}</p> : null}

      {tab === 'dashboard' ? (
        <div className="accounting-hub__panel">
          <h2>{ar ? 'نبض المالية' : 'Finance pulse'}</h2>
          <div className="accounting-hub__kpis">
            <div className="accounting-hub__kpi">
              <span>{ar ? 'الذمم المدينة' : 'Receivables'}</span>
              <strong>{money(omr.receivableMinor, omr.currency, ar)}</strong>
            </div>
            <div className="accounting-hub__kpi">
              <span>{ar ? 'المحصّل' : 'Collected'}</span>
              <strong>{money(omr.collectedMinor, omr.currency, ar)}</strong>
            </div>
            <div className="accounting-hub__kpi">
              <span>{ar ? 'المصروفات' : 'Expenses'}</span>
              <strong>{money(omr.expenseMinor, omr.currency, ar)}</strong>
            </div>
            <div className="accounting-hub__kpi">
              <span>{ar ? 'قيود مسودة' : 'Draft journals'}</span>
              <strong>{dash?.draftJournals ?? 0}</strong>
            </div>
            <div className="accounting-hub__kpi">
              <span>{ar ? 'قيود مرحّلة' : 'Posted journals'}</span>
              <strong>{dash?.postedJournals ?? 0}</strong>
            </div>
            <div className="accounting-hub__kpi">
              <span>{ar ? 'حسابات الدليل' : 'Ledger accounts'}</span>
              <strong>{dash?.accountCount ?? 0}</strong>
            </div>
            <div className="accounting-hub__kpi">
              <span>{ar ? 'فواتير متأخرة' : 'Overdue invoices'}</span>
              <strong>{dash?.overdueInvoices ?? 0}</strong>
            </div>
          </div>
          <p className="accounting-hub__muted">
            {ar
              ? 'ابدأ بتهيئة دليل الحسابات، ثم سجّل قيوداً متوازنة، ثم اطبع ميزان المراجعة وقائمة الدخل والميزانية.'
              : 'Bootstrap the chart, post balanced journals, then run trial balance, P&L and balance sheet.'}
          </p>
          <div className="accounting-hub__actions">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setTab('accounts')}
            >
              {ar ? 'دليل الحسابات' : 'Accounts'}
            </button>
            <button
              type="button"
              className="button button--primary"
              onClick={() => setTab('journal')}
            >
              {ar ? 'قيد يومية' : 'Journal entry'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setTab('reports')}
            >
              {ar ? 'التقارير' : 'Reports'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setTab('deposits')}
            >
              {ar ? 'أمانات التأمين' : 'Deposits'}
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'deposits' ? (
        <DepositLedgerPanel portal={portal} locale={locale} active={active && tab === 'deposits'} />
      ) : null}

      {tab === 'accounts' ? (
        <div className="accounting-hub__panel">
          <div className="accounting-hub__toolbar">
            <h2>{ar ? 'دليل الحسابات' : 'Chart of accounts'}</h2>
            {caps.manage ? (
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await browserNextMutation('/api/owner/accounting/accounts/bootstrap', {
                      method: 'POST',
                      body: '{}',
                    });
                  })
                }
              >
                {ar ? 'تهيئة الدليل الافتراضي' : 'Bootstrap default chart'}
              </button>
            ) : null}
          </div>
          {caps.manage ? (
            <form
              className="accounting-hub__form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await browserNextMutation('/api/owner/accounting/accounts', {
                    method: 'POST',
                    body: JSON.stringify(accountForm),
                  });
                  setAccountForm({ code: '', nameAr: '', nameEn: '', type: 'expense' });
                });
              }}
            >
              <div className="accounting-hub__form-grid">
                <label>
                  {ar ? 'الرمز' : 'Code'}
                  <input
                    value={accountForm.code}
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, code: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {ar ? 'الاسم عربي' : 'Arabic name'}
                  <input
                    value={accountForm.nameAr}
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, nameAr: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {ar ? 'الاسم إنجليزي' : 'English name'}
                  <input
                    value={accountForm.nameEn}
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, nameEn: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {ar ? 'النوع' : 'Type'}
                  <select
                    value={accountForm.type}
                    onChange={(event) =>
                      setAccountForm((current) => ({
                        ...current,
                        type: event.target.value as LedgerAccountType,
                      }))
                    }
                  >
                    {(Object.keys(TYPE_LABEL) as LedgerAccountType[]).map((type) => (
                      <option key={type} value={type}>
                        {ar ? TYPE_LABEL[type].ar : TYPE_LABEL[type].en}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="button button--primary" type="submit" disabled={busy}>
                {ar ? 'إضافة حساب' : 'Add account'}
              </button>
            </form>
          ) : null}
          <div className="accounting-hub__table-wrap">
            <table className="accounting-hub__table">
              <thead>
                <tr>
                  <th>{ar ? 'الرمز' : 'Code'}</th>
                  <th>{ar ? 'الحساب' : 'Account'}</th>
                  <th>{ar ? 'النوع' : 'Type'}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.code}</td>
                    <td>{ar ? account.nameAr : account.nameEn}</td>
                    <td>{ar ? TYPE_LABEL[account.type].ar : TYPE_LABEL[account.type].en}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!accounts.length ? (
            <p className="accounting-hub__muted">
              {ar
                ? 'لا حسابات بعد — اضغط تهيئة الدليل الافتراضي.'
                : 'No accounts yet — bootstrap the chart.'}
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === 'journal' ? (
        <div className="accounting-hub__panel">
          <h2>{ar ? 'قيود اليومية' : 'Journal entries'}</h2>
          {caps.manage ? (
            <form
              className="accounting-hub__form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!lineBalance.ok) {
                  setError(
                    ar
                      ? 'القيد غير متوازن أو بلا مبالغ'
                      : 'Journal is unbalanced or has no amounts',
                  );
                  return;
                }
                void run(async () => {
                  await browserNextMutation('/api/owner/accounting/journals', {
                    method: 'POST',
                    body: JSON.stringify({
                      occurredOn: journalForm.occurredOn,
                      description: journalForm.description,
                      post: journalForm.post,
                      lines: journalForm.lines
                        .filter((line) => line.accountId && (line.debit || line.credit))
                        .map((line) => ({
                          accountId: line.accountId,
                          debitMinor: toMinor(line.debit),
                          creditMinor: toMinor(line.credit),
                          currency: 'OMR',
                          memo: line.memo || undefined,
                        })),
                    }),
                  });
                  setJournalForm((current) => ({
                    ...current,
                    description: '',
                    lines: [
                      { accountId: '', debit: '', credit: '', memo: '' },
                      { accountId: '', debit: '', credit: '', memo: '' },
                    ],
                  }));
                });
              }}
            >
              <div className="accounting-hub__form-grid">
                <label>
                  {ar ? 'التاريخ' : 'Date'}
                  <input
                    type="date"
                    value={journalForm.occurredOn}
                    onChange={(event) =>
                      setJournalForm((current) => ({ ...current, occurredOn: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {ar ? 'البيان' : 'Description'}
                  <input
                    value={journalForm.description}
                    onChange={(event) =>
                      setJournalForm((current) => ({ ...current, description: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {ar ? 'الترحيل فوراً' : 'Post immediately'}
                  <select
                    value={journalForm.post ? 'yes' : 'no'}
                    onChange={(event) =>
                      setJournalForm((current) => ({
                        ...current,
                        post: event.target.value === 'yes',
                      }))
                    }
                    disabled={!caps.post}
                  >
                    <option value="yes">{ar ? 'نعم' : 'Yes'}</option>
                    <option value="no">{ar ? 'مسودة' : 'Draft'}</option>
                  </select>
                </label>
              </div>
              <div className="accounting-hub__lines">
                {journalForm.lines.map((line, index) => (
                  <div className="accounting-hub__line" key={index}>
                    <select
                      value={line.accountId}
                      onChange={(event) =>
                        setJournalForm((current) => {
                          const lines = [...current.lines];
                          lines[index] = { ...lines[index]!, accountId: event.target.value };
                          return { ...current, lines };
                        })
                      }
                      required
                    >
                      <option value="">{ar ? 'الحساب…' : 'Account…'}</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code} — {ar ? account.nameAr : account.nameEn}
                        </option>
                      ))}
                    </select>
                    <input
                      inputMode="decimal"
                      placeholder={ar ? 'مدين' : 'Debit'}
                      value={line.debit}
                      onChange={(event) =>
                        setJournalForm((current) => {
                          const lines = [...current.lines];
                          lines[index] = {
                            ...lines[index]!,
                            debit: event.target.value,
                            credit: event.target.value ? '' : lines[index]!.credit,
                          };
                          return { ...current, lines };
                        })
                      }
                    />
                    <input
                      inputMode="decimal"
                      placeholder={ar ? 'دائن' : 'Credit'}
                      value={line.credit}
                      onChange={(event) =>
                        setJournalForm((current) => {
                          const lines = [...current.lines];
                          lines[index] = {
                            ...lines[index]!,
                            credit: event.target.value,
                            debit: event.target.value ? '' : lines[index]!.debit,
                          };
                          return { ...current, lines };
                        })
                      }
                    />
                    <input
                      placeholder={ar ? 'ملاحظة' : 'Memo'}
                      value={line.memo}
                      onChange={(event) =>
                        setJournalForm((current) => {
                          const lines = [...current.lines];
                          lines[index] = { ...lines[index]!, memo: event.target.value };
                          return { ...current, lines };
                        })
                      }
                    />
                    <button
                      type="button"
                      className="button button--quiet button--sm"
                      onClick={() =>
                        setJournalForm((current) => ({
                          ...current,
                          lines: current.lines.filter((_, i) => i !== index),
                        }))
                      }
                      disabled={journalForm.lines.length <= 2}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="accounting-hub__actions">
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() =>
                    setJournalForm((current) => ({
                      ...current,
                      lines: [...current.lines, { accountId: '', debit: '', credit: '', memo: '' }],
                    }))
                  }
                >
                  {ar ? '＋ سطر' : '+ Line'}
                </button>
                <span
                  className={`accounting-hub__balance ${lineBalance.ok ? 'accounting-hub__balance--ok' : 'accounting-hub__balance--bad'}`}
                >
                  {ar ? 'مدين' : 'Debit'} {money(lineBalance.debit.toString(), 'OMR', ar)} ·{' '}
                  {ar ? 'دائن' : 'Credit'} {money(lineBalance.credit.toString(), 'OMR', ar)}
                </span>
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={busy || !accounts.length}
                >
                  {ar ? 'حفظ القيد' : 'Save entry'}
                </button>
              </div>
            </form>
          ) : null}
          <div className="accounting-hub__table-wrap">
            <table className="accounting-hub__table">
              <thead>
                <tr>
                  <th>{ar ? 'المرجع' : 'Ref'}</th>
                  <th>{ar ? 'التاريخ' : 'Date'}</th>
                  <th>{ar ? 'البيان' : 'Description'}</th>
                  <th>{ar ? 'الحالة' : 'Status'}</th>
                  <th className="num">{ar ? 'المبلغ' : 'Amount'}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {journals.map((row) => (
                  <tr key={row.id}>
                    <td>{row.reference}</td>
                    <td>{row.occurredOn}</td>
                    <td>{row.description}</td>
                    <td>
                      <span
                        className={`accounting-hub__status accounting-hub__status--${row.status}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="num">{money(row.debitMinor, row.currency ?? 'OMR', ar)}</td>
                    <td>
                      <div className="accounting-hub__actions">
                        {row.status === 'draft' && caps.post ? (
                          <button
                            type="button"
                            className="button button--quiet button--sm"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await browserNextMutation(
                                  `/api/owner/accounting/journals/${row.id}/post`,
                                  { method: 'POST', body: '{}' },
                                );
                              })
                            }
                          >
                            {ar ? 'ترحيل' : 'Post'}
                          </button>
                        ) : null}
                        {row.status === 'posted' && caps.post ? (
                          <button
                            type="button"
                            className="button button--quiet button--sm"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await browserNextMutation(
                                  `/api/owner/accounting/journals/${row.id}/reverse`,
                                  {
                                    method: 'POST',
                                    body: JSON.stringify({ occurredOn: todayIso() }),
                                  },
                                );
                              })
                            }
                          >
                            {ar ? 'عكس' : 'Reverse'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'expenses' ? (
        <div className="accounting-hub__panel">
          <h2>{ar ? 'المصروفات' : 'Expenses'}</h2>
          {caps.manage ? (
            <form
              className="accounting-hub__form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await browserNextMutation('/api/owner/accounting/expenses', {
                    method: 'POST',
                    body: JSON.stringify({
                      category: expenseForm.category,
                      description: expenseForm.description,
                      amountMinor: toMinor(expenseForm.amount),
                      currency: 'OMR',
                      issuedOn: expenseForm.issuedOn,
                      ...(expenseForm.propertyId.trim()
                        ? { propertyId: expenseForm.propertyId.trim() }
                        : {}),
                      ...(expenseForm.unitId.trim()
                        ? { unitId: expenseForm.unitId.trim() }
                        : {}),
                      ...(expenseForm.partyId.trim()
                        ? { partyId: expenseForm.partyId.trim() }
                        : {}),
                    }),
                  });
                  setExpenseForm((current) => ({ ...current, description: '', amount: '' }));
                });
              }}
            >
              <div className="accounting-hub__form-grid">
                <label>
                  {ar ? 'التصنيف' : 'Category'}
                  <input
                    value={expenseForm.category}
                    onChange={(event) =>
                      setExpenseForm((current) => ({ ...current, category: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {ar ? 'الوصف' : 'Description'}
                  <input
                    value={expenseForm.description}
                    onChange={(event) =>
                      setExpenseForm((current) => ({ ...current, description: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {ar ? 'المبلغ' : 'Amount'}
                  <input
                    inputMode="decimal"
                    value={expenseForm.amount}
                    onChange={(event) =>
                      setExpenseForm((current) => ({ ...current, amount: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {ar ? 'التاريخ' : 'Date'}
                  <input
                    type="date"
                    value={expenseForm.issuedOn}
                    onChange={(event) =>
                      setExpenseForm((current) => ({ ...current, issuedOn: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {ar ? 'المبنى (اختياري)' : 'Property (optional)'}
                  <input
                    value={expenseForm.propertyId}
                    onChange={(event) =>
                      setExpenseForm((current) => ({
                        ...current,
                        propertyId: event.target.value,
                      }))
                    }
                    placeholder="UUID"
                  />
                </label>
                <label>
                  {ar ? 'الوحدة (اختياري)' : 'Unit (optional)'}
                  <input
                    value={expenseForm.unitId}
                    onChange={(event) =>
                      setExpenseForm((current) => ({ ...current, unitId: event.target.value }))
                    }
                    placeholder="UUID"
                  />
                </label>
                <label>
                  {ar ? 'الطرف (اختياري)' : 'Party (optional)'}
                  <input
                    value={expenseForm.partyId}
                    onChange={(event) =>
                      setExpenseForm((current) => ({ ...current, partyId: event.target.value }))
                    }
                    placeholder="UUID"
                  />
                </label>
              </div>
              <button className="button button--primary" type="submit" disabled={busy}>
                {ar ? 'تسجيل مصروف' : 'Record expense'}
              </button>
            </form>
          ) : null}
          <div className="accounting-hub__table-wrap">
            <table className="accounting-hub__table">
              <thead>
                <tr>
                  <th>{ar ? 'المرجع' : 'Ref'}</th>
                  <th>{ar ? 'التصنيف' : 'Category'}</th>
                  <th>{ar ? 'الوصف' : 'Description'}</th>
                  <th>{ar ? 'الحالة' : 'Status'}</th>
                  <th className="num">{ar ? 'المبلغ' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((row) => (
                  <tr key={row.id}>
                    <td>{row.reference}</td>
                    <td>{row.category}</td>
                    <td>{row.description}</td>
                    <td>{row.status}</td>
                    <td className="num">{money(row.amountMinor, row.currency, ar)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'ledgers' ? (
        <div className="accounting-hub__panel">
          <h2>{ar ? 'أستاذ تحليلي (مبنى / وحدة / طرف)' : 'Dimensional ledger'}</h2>
          <p className="accounting-hub__hint">
            {ar
              ? 'اعرض حركة القيود المرحّلة المرتبطة بمبنى أو وحدة أو طرف — الإيجار والتأمين والمصروفات تظهر هنا عند الربط الصحيح.'
              : 'Posted journal activity scoped to a property, unit, or party — rent, deposits, and expenses appear when dimensions are set.'}
          </p>
          <div className="accounting-hub__toolbar">
            <label>
              {ar ? 'النطاق' : 'Scope'}
              <select
                value={ledgerScope}
                onChange={(event) =>
                  setLedgerScope(event.target.value as 'propertyId' | 'unitId' | 'partyId')
                }
              >
                <option value="propertyId">{ar ? 'مبنى' : 'Property'}</option>
                <option value="unitId">{ar ? 'وحدة' : 'Unit'}</option>
                <option value="partyId">{ar ? 'طرف' : 'Party'}</option>
              </select>
            </label>
            <label>
              {ar ? 'المعرّف' : 'ID'}
              <input
                value={ledgerId}
                onChange={(event) => setLedgerId(event.target.value)}
                placeholder="UUID"
              />
            </label>
            <label>
              {ar ? 'من' : 'From'}
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label>
              {ar ? 'إلى' : 'To'}
              <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </label>
            <button
              className="button button--primary"
              type="button"
              disabled={busy || !ledgerId.trim()}
              onClick={() => {
                void run(async () => {
                  await loadTab('ledgers');
                });
              }}
            >
              {ar ? 'عرض' : 'Load'}
            </button>
          </div>
          <p className="accounting-hub__meta">
            {ar ? 'إجمالي مدين' : 'Total debit'}: {money(ledgerTotals.debitMinor, 'OMR', ar)}
            {' · '}
            {ar ? 'إجمالي دائن' : 'Total credit'}: {money(ledgerTotals.creditMinor, 'OMR', ar)}
          </p>
          <div className="accounting-hub__table-wrap">
            <table className="accounting-hub__table">
              <thead>
                <tr>
                  <th>{ar ? 'التاريخ' : 'Date'}</th>
                  <th>{ar ? 'المرجع' : 'Ref'}</th>
                  <th>{ar ? 'الحساب' : 'Account'}</th>
                  <th>{ar ? 'الطرف' : 'Party'}</th>
                  <th>{ar ? 'المبنى / الوحدة' : 'Property / unit'}</th>
                  <th className="num">{ar ? 'مدين' : 'Debit'}</th>
                  <th className="num">{ar ? 'دائن' : 'Credit'}</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      {ar
                        ? ledgerId.trim()
                          ? 'لا توجد حركات ضمن النطاق'
                          : 'أدخل معرّف المبنى أو الوحدة أو الطرف'
                        : ledgerId.trim()
                          ? 'No rows in scope'
                          : 'Enter a property, unit, or party id'}
                    </td>
                  </tr>
                ) : (
                  ledgerRows.map((row, index) => (
                    <tr key={`${row.reference}-${row.accountCode}-${index}`}>
                      <td>{row.occurredOn}</td>
                      <td>{row.reference}</td>
                      <td>
                        {row.accountCode} · {ar ? row.accountNameAr : row.accountNameEn}
                      </td>
                      <td>{row.partyName ?? '—'}</td>
                      <td>
                        {[row.propertyNameAr, row.unitCode].filter(Boolean).join(' / ') || '—'}
                      </td>
                      <td className="num">
                        {row.debitMinor !== '0' ? money(row.debitMinor, row.currency, ar) : '—'}
                      </td>
                      <td className="num">
                        {row.creditMinor !== '0' ? money(row.creditMinor, row.currency, ar) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'reports' ? (
        <div className="accounting-hub__panel">
          <h2>{ar ? 'التقارير المالية' : 'Financial reports'}</h2>
          <div className="accounting-hub__toolbar">
            <label>
              {ar ? 'التقرير' : 'Report'}
              <select value={reportKind} onChange={(event) => setReportKind(event.target.value)}>
                <option value="trial">{ar ? 'ميزان المراجعة' : 'Trial balance'}</option>
                <option value="income">{ar ? 'قائمة الدخل' : 'Income statement'}</option>
                <option value="balance">{ar ? 'الميزانية العمومية' : 'Balance sheet'}</option>
                <option value="cashflow">{ar ? 'التدفقات النقدية' : 'Cash flow'}</option>
                <option value="aging">{ar ? 'أعمار الذمم' : 'AR aging'}</option>
              </select>
            </label>
            <label>
              {ar ? 'من' : 'From'}
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label>
              {ar ? 'إلى' : 'To'}
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void run(async () => loadTab('reports'))}
            >
              {ar ? 'عرض' : 'Run'}
            </button>
          </div>
          <ReportView ar={ar} report={report} />
        </div>
      ) : null}

      {tab === 'periods' ? (
        <div className="accounting-hub__panel">
          <h2>{ar ? 'إقفال الفترات المالية' : 'Fiscal period lock'}</h2>
          <p className="accounting-hub__muted">
            {ar
              ? 'عند الإقفال يُرفض أي ترحيل أو قيد بتاريخ داخل الفترة — حماية تدقيق عالمية بدون تعديل بنية القاعدة.'
              : 'While locked, posting into the range is rejected — audit-grade control without a schema migration.'}
          </p>
          {caps.manage ? (
            <form
              className="accounting-hub__form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await browserNextMutation('/api/owner/accounting/periods', {
                    method: 'POST',
                    body: JSON.stringify({ ...periodForm, lock: true }),
                  });
                });
              }}
            >
              <div className="accounting-hub__form-grid">
                <label>
                  {ar ? 'من' : 'From'}
                  <input
                    type="date"
                    value={periodForm.from}
                    onChange={(event) =>
                      setPeriodForm((current) => ({ ...current, from: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {ar ? 'إلى' : 'To'}
                  <input
                    type="date"
                    value={periodForm.to}
                    onChange={(event) =>
                      setPeriodForm((current) => ({ ...current, to: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  {ar ? 'ملاحظة' : 'Note'}
                  <input
                    value={periodForm.note}
                    onChange={(event) =>
                      setPeriodForm((current) => ({ ...current, note: event.target.value }))
                    }
                  />
                </label>
              </div>
              <button className="button button--primary" type="submit" disabled={busy}>
                {ar ? 'إقفال الفترة' : 'Lock period'}
              </button>
            </form>
          ) : null}
          <div className="accounting-hub__table-wrap">
            <table className="accounting-hub__table">
              <thead>
                <tr>
                  <th>{ar ? 'من' : 'From'}</th>
                  <th>{ar ? 'إلى' : 'To'}</th>
                  <th>{ar ? 'الحالة' : 'Status'}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.id}>
                    <td>{period.from}</td>
                    <td>{period.to}</td>
                    <td>{period.locked ? (ar ? 'مقفلة' : 'Locked') : ar ? 'مفتوحة' : 'Open'}</td>
                    <td>
                      {caps.manage && period.locked ? (
                        <button
                          type="button"
                          className="button button--quiet button--sm"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await browserNextMutation('/api/owner/accounting/periods', {
                                method: 'POST',
                                body: JSON.stringify({
                                  from: period.from,
                                  to: period.to,
                                  lock: false,
                                }),
                              });
                            })
                          }
                        >
                          {ar ? 'فتح' : 'Unlock'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'audit' ? (
        <div className="accounting-hub__panel">
          <h2>{ar ? 'سجل التدقيق المحاسبي' : 'Accounting audit trail'}</h2>
          <div className="accounting-hub__table-wrap">
            <table className="accounting-hub__table">
              <thead>
                <tr>
                  <th>{ar ? 'الوقت' : 'When'}</th>
                  <th>{ar ? 'الحدث' : 'Event'}</th>
                  <th>{ar ? 'المورد' : 'Resource'}</th>
                  <th>{ar ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((row) => (
                  <tr key={row.id}>
                    <td>{row.occurredAt.replace('T', ' ').slice(0, 19)}</td>
                    <td>{row.eventType}</td>
                    <td>
                      {row.resourceType}:{row.resourceId.slice(0, 8)}
                    </td>
                    <td>{[row.fromStatus, row.toStatus].filter(Boolean).join(' → ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function reportCurrency(report: Record<string, unknown>): string {
  return typeof report.currency === 'string' && report.currency ? report.currency : 'OMR';
}

function ReportView({ ar, report }: { ar: boolean; report: Record<string, unknown> | null }) {
  if (!report) {
    return (
      <p className="accounting-hub__muted">
        {ar ? 'اختر تقريراً ثم اضغط عرض.' : 'Pick a report and run it.'}
      </p>
    );
  }
  const currency = reportCurrency(report);
  if (report.report === 'trial' && Array.isArray(report.rows)) {
    const rows = report.rows as Array<{
      code: string;
      nameAr: string;
      nameEn: string;
      type: string;
      currency: string;
      debitMinor: string;
      creditMinor: string;
    }>;
    return (
      <div className="accounting-hub__table-wrap">
        <table className="accounting-hub__table">
          <thead>
            <tr>
              <th>{ar ? 'الرمز' : 'Code'}</th>
              <th>{ar ? 'الحساب' : 'Account'}</th>
              <th>{ar ? 'النوع' : 'Type'}</th>
              <th className="num">{ar ? 'مدين' : 'Debit'}</th>
              <th className="num">{ar ? 'دائن' : 'Credit'}</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((row) => row.debitMinor !== '0' || row.creditMinor !== '0')
              .map((row) => (
                <tr key={`${row.code}-${row.currency}`}>
                  <td>{row.code}</td>
                  <td>{ar ? row.nameAr : row.nameEn}</td>
                  <td>{row.type}</td>
                  <td className="num">{money(row.debitMinor, row.currency, ar)}</td>
                  <td className="num">{money(row.creditMinor, row.currency, ar)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (report.report === 'income') {
    const revenue = report.revenue as {
      totalMinor: string;
      rows: Array<{ code: string; nameAr: string; nameEn: string; balanceMinor: string }>;
    };
    const expenses = report.expenses as typeof revenue;
    return (
      <div className="accounting-hub__panel">
        <p>
          <strong>{ar ? 'صافي الدخل' : 'Net income'}:</strong>{' '}
          {money(String(report.netIncomeMinor), currency, ar)}
        </p>
        <SectionTable
          ar={ar}
          title={ar ? 'الإيرادات' : 'Revenue'}
          section={revenue}
          currency={currency}
        />
        <SectionTable
          ar={ar}
          title={ar ? 'المصروفات' : 'Expenses'}
          section={expenses}
          currency={currency}
        />
      </div>
    );
  }
  if (report.report === 'balance') {
    const assets = report.assets as {
      totalMinor: string;
      rows: Array<{ code: string; nameAr: string; nameEn: string; balanceMinor: string }>;
    };
    const liabilities = report.liabilities as typeof assets;
    const equity = report.equity as typeof assets;
    return (
      <div className="accounting-hub__panel">
        <p>
          {ar ? 'متوازنة؟' : 'Balanced?'}{' '}
          <strong>{report.balanced ? (ar ? 'نعم' : 'Yes') : ar ? 'لا' : 'No'}</strong>
          {!report.balanced ? ` · Δ ${money(String(report.differenceMinor), currency, ar)}` : null}
        </p>
        <SectionTable
          ar={ar}
          title={ar ? 'الأصول' : 'Assets'}
          section={assets}
          currency={currency}
        />
        <SectionTable
          ar={ar}
          title={ar ? 'الالتزامات' : 'Liabilities'}
          section={liabilities}
          currency={currency}
        />
        <SectionTable
          ar={ar}
          title={ar ? 'حقوق الملكية' : 'Equity'}
          section={equity}
          currency={currency}
        />
      </div>
    );
  }
  if (report.report === 'cashflow') {
    return (
      <div className="accounting-hub__panel">
        <p>
          {ar ? 'صافي النقد' : 'Net cash'}:{' '}
          <strong>{money(String(report.netMinor), currency, ar)}</strong>
        </p>
        <p className="accounting-hub__muted">
          {ar ? 'وارد' : 'In'} {money(String(report.inflowMinor), currency, ar)} ·{' '}
          {ar ? 'صادر' : 'Out'} {money(String(report.outflowMinor), currency, ar)}
        </p>
      </div>
    );
  }
  if (report.report === 'aging') {
    const buckets = report.buckets as Record<string, string>;
    return (
      <div className="accounting-hub__panel">
        <p>
          {ar ? 'إجمالي المستحق' : 'Outstanding'}:{' '}
          <strong>{money(String(report.totalOutstandingMinor), currency, ar)}</strong>
        </p>
        <div className="accounting-hub__kpis">
          {Object.entries(buckets).map(([key, value]) => (
            <div className="accounting-hub__kpi" key={key}>
              <span>{key}</span>
              <strong>{money(value, currency, ar)}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return <pre className="accounting-hub__muted">{JSON.stringify(report, null, 2)}</pre>;
}

function SectionTable({
  ar,
  title,
  section,
  currency,
}: {
  ar: boolean;
  title: string;
  section: {
    totalMinor: string;
    rows: Array<{ code: string; nameAr: string; nameEn: string; balanceMinor: string }>;
  };
  currency: string;
}) {
  return (
    <div>
      <h3>
        {title} · {money(section.totalMinor, currency, ar)}
      </h3>
      <div className="accounting-hub__table-wrap">
        <table className="accounting-hub__table">
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.code}>
                <td>{row.code}</td>
                <td>{ar ? row.nameAr : row.nameEn}</td>
                <td className="num">{money(row.balanceMinor, currency, ar)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
