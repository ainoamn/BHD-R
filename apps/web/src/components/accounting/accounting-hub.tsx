'use client';

import { useSearchParams } from 'next/navigation';
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccountingChequesPanel } from '@/components/accounting/accounting-cheques-panel';
import {
  AccountingCollectionBoard,
  type CollectionOutlook,
} from '@/components/accounting/accounting-collection-board';
import {
  AccountingFollowTask,
  AccountingTasksAlert,
  AccountingTasksInbox,
  AccountingTasksProvider,
} from '@/components/accounting/accounting-follow-task';
import { AccountingRecordActions } from '@/components/accounting/accounting-record-actions';
import { AccountingEntryDrawer } from '@/components/accounting/accounting-entry-drawer';
import { AccountingJournalComposerModal } from '@/components/accounting/accounting-journal-composer';
import {
  AccountingExpenseIncomeModal,
  AccountingTradingModal,
} from '@/components/accounting/accounting-ops-modals';
import { AccountingSettingsPanel } from '@/components/accounting/accounting-settings-panel';
import { DepositLedgerPanel } from '@/components/accounting/deposit-ledger';
import { AccountingRefundsAlert } from '@/components/accounting/accounting-refunds-alert';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  ACCOUNTING_HUB_TABS,
  parseAccountingHubTab,
  type AccountingHubTab,
  type LedgerAccountType,
} from '@/lib/accounting-gl';
import { accountingHubCopy } from '@/lib/accounting-hub-copy';
import {
  accountingAccountTypeLabel,
  accountingDisplayText,
  accountingDocKindLabel,
  accountingExpenseStatusLabel,
  accountingJournalStatusLabel,
  accountingSourceTypeLabel,
} from '@/lib/accounting-i18n';
import { openAccountingPrint, printAccountingDocument } from '@/lib/accounting-print';
import {
  fetchAccountingJson,
  getAccountingCache,
  invalidateAccountingCache,
  warmAccountingHub,
} from '@/lib/accounting-client-cache';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { LIVE_CHANGE_EVENT } from '@/lib/live-sync-shared';

/** Keep every tab mounted; only visibility flips so switches stay instant. */
function AccountingTabPanel({
  id,
  tab,
  children,
}: {
  id: AccountingHubTab;
  tab: AccountingHubTab;
  children: ReactNode;
}) {
  const selected = tab === id;
  return (
    <div
      role="tabpanel"
      id={`accounting-panel-${id}`}
      hidden={!selected}
      inert={!selected || undefined}
      className="accounting-hub__slot"
    >
      {children}
    </div>
  );
}

type Caps = { manage: boolean; post: boolean };
type HubDash = {
  totalsByCurrency: Array<{
    currency: string;
    receivableMinor: string;
    collectedMinor: string;
    expenseMinor: string;
    depositsMinor?: string;
  }>;
  draftJournals: number;
  overdueInvoices: number;
  accountCount: number;
  postedJournals: number;
  needsSetup?: boolean;
  recentActivity?: Array<{
    id: string;
    kind: string;
    label: string;
    amountMinor: string;
    currency: string;
    at: string;
  }>;
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
  sourceType?: string | null;
  archived?: boolean;
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
  archived?: boolean;
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
type DocRow = {
  id: string;
  kind: 'invoice' | 'receipt' | 'journal';
  reference: string;
  title: string;
  status: string;
  amountMinor: string;
  currency: string;
  occurredOn: string;
  partyName: string | null;
  propertyLabel: string | null;
  journalId: string | null;
  note: string | null;
  sourceType?: string | null;
  archived?: boolean;
};

const TYPE_LABEL: Record<LedgerAccountType, { ar: string; en: string }> = {
  asset: { ar: 'أصل', en: 'Asset' },
  liability: { ar: 'التزام', en: 'Liability' },
  equity: { ar: 'حقوق ملكية', en: 'Equity' },
  revenue: { ar: 'إيراد', en: 'Revenue' },
  expense: { ar: 'مصروف', en: 'Expense' },
};

const TAB_MARK: Record<string, string> = {
  dashboard: '▣',
  documents: '▤',
  journal: '≡',
  tasks: '✓',
  deposits: '◈',
  expenses: '↘',
  trading: '⇄',
  cheques: '▦',
  reports: '◔',
  accounts: '#',
  ledgers: '▦',
  periods: '◷',
  settings: '⚙',
  audit: '◎',
};

function TabMark({ id }: { id: string }) {
  return (
    <span className={`accounting-tab-icon accounting-tab-icon--${id}`} aria-hidden="true">
      {TAB_MARK[id] ?? '•'}
    </span>
  );
}

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

async function getJson<T>(path: string, preferCache = false): Promise<T> {
  try {
    return await fetchAccountingJson<T>(path, { preferCache });
  } catch (error) {
    throw new ApiError(
      500,
      'request_failed',
      error instanceof Error ? error.message : 'Request failed',
    );
  }
}

function hydrateFromCache<T>(path: string, apply: (value: T) => void) {
  const hit = getAccountingCache<T>(path);
  if (hit !== null) apply(hit);
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
  const t = useMemo(() => accountingHubCopy(locale), [locale]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /** Document/journal highlight id from print “back”; deposits used focus alone historically. */
  const focusId = searchParams.get('focus');
  const tab = searchParams.get('tab')
    ? parseAccountingHubTab(searchParams.get('tab'))
    : focusId
      ? 'deposits'
      : 'dashboard';
  const [dash, setDash] = useState<HubDash | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [journals, setJournals] = useState<JournalRow[] | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRow[] | null>(null);
  const [periods, setPeriods] = useState<PeriodRow[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [reportKind, setReportKind] = useState('trial');
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 4)}-01-01`);
  const [toDate, setToDate] = useState(todayIso());
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [warming, setWarming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState({
    code: '',
    nameAr: '',
    nameEn: '',
    type: 'expense' as LedgerAccountType,
  });
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [tradingModalOpen, setTradingModalOpen] = useState(false);
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
  const [documents, setDocuments] = useState<DocRow[] | null>(null);
  const [outlook, setOutlook] = useState<CollectionOutlook | null>(null);
  const [openJournalId, setOpenJournalId] = useState<string | null>(
    searchParams.get('open') && /^[0-9a-f-]{36}$/i.test(searchParams.get('open')!)
      ? searchParams.get('open')
      : null,
  );
  const [composeOpen, setComposeOpen] = useState(false);
  // locale-aware labels for table cells
  const statusLabel = (value: string | null | undefined) =>
    accountingJournalStatusLabel(value, locale);
  const sourceLabel = (value: string | null | undefined) =>
    accountingSourceTypeLabel(value, locale);
  const textLabel = (value: string | null | undefined) => accountingDisplayText(value, locale);

  const caps = dash?.capabilities ?? { manage: false, post: false };
  const omr = dash?.totalsByCurrency.find((row) => row.currency === 'OMR') ??
    dash?.totalsByCurrency[0] ?? {
      currency: 'OMR',
      receivableMinor: '0',
      collectedMinor: '0',
      expenseMinor: '0',
      depositsMinor: '0',
    };
  const syncedRef = useRef(false);
  const warmedRef = useRef(false);
  const refreshGen = useRef(0);
  const refreshAllRef = useRef<(opts?: { silent?: boolean }) => Promise<void>>(async () => undefined);
  const reportKindRef = useRef(reportKind);
  const fromDateRef = useRef(fromDate);
  const toDateRef = useRef(toDate);
  const ledgerScopeRef = useRef(ledgerScope);
  const ledgerIdRef = useRef(ledgerId);
  reportKindRef.current = reportKind;
  fromDateRef.current = fromDate;
  toDateRef.current = toDate;
  ledgerScopeRef.current = ledgerScope;
  ledgerIdRef.current = ledgerId;

  const setTab = useCallback(
    (next: AccountingHubTab) => {
      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        // Manual tab clicks clear row highlight; deposit deep-links keep focus without a tab.
        if (next === 'deposits' && !searchParams.get('tab') && focusId) {
          /* keep focus */
        } else {
          params.delete('focus');
          params.delete('open');
        }
        if (next === 'dashboard') params.delete('tab');
        else params.set('tab', next);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [focusId, pathname, router, searchParams],
  );

  useEffect(() => {
    if (!active || !focusId) return;
    if (tab === 'documents' && documents?.length) {
      const row = documents.find((doc) => doc.id === focusId);
      if (row?.journalId) setOpenJournalId(row.journalId);
      const timer = window.setTimeout(() => {
        document
          .getElementById(`accounting-doc-${focusId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 140);
      return () => window.clearTimeout(timer);
    }
    if (tab === 'journal' && journals?.length) {
      if (/^[0-9a-f-]{36}$/i.test(focusId)) setOpenJournalId(focusId);
      const timer = window.setTimeout(() => {
        document
          .getElementById(`accounting-journal-${focusId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 140);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [active, documents, focusId, journals, tab]);

  const refreshDash = useCallback(async () => {
    const data = await getJson<HubDash>('/api/owner/accounting/hub');
    setDash(data);
    return data;
  }, []);

  const refreshReport = useCallback(async () => {
    const kind = reportKindRef.current;
    const from = fromDateRef.current;
    const to = toDateRef.current;
    const data = await getJson<Record<string, unknown>>(
      `/api/owner/accounting/reports?report=${encodeURIComponent(kind)}&fromDate=${from}&toDate=${to}&asOfDate=${to}`,
    );
    setReport(data);
  }, []);

  const refreshLedgers = useCallback(async () => {
    const id = ledgerIdRef.current.trim();
    if (!id) {
      setLedgerRows([]);
      setLedgerTotals({ debitMinor: '0', creditMinor: '0' });
      return;
    }
    const scope = ledgerScopeRef.current;
    const from = fromDateRef.current;
    const to = toDateRef.current;
    const data = await getJson<{
      rows: typeof ledgerRows;
      totals: { debitMinor: string; creditMinor: string };
    }>(
      `/api/owner/accounting/ledgers?${encodeURIComponent(scope)}=${encodeURIComponent(id)}&fromDate=${from}&toDate=${to}`,
    );
    setLedgerRows(data.rows);
    setLedgerTotals(data.totals);
  }, []);

  /** Paint dashboard first, warm other tabs in the background — never blank the UI. */
  const refreshAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? warmedRef.current;
      const gen = ++refreshGen.current;
      const hadDash =
        warmedRef.current || Boolean(getAccountingCache('/api/owner/accounting/hub'));
      if (!silent && !hadDash) setWarming(true);
      setError(null);

      hydrateFromCache<HubDash>('/api/owner/accounting/hub', setDash);
      hydrateFromCache<CollectionOutlook>('/api/owner/accounting/cheques', setOutlook);
      hydrateFromCache<{ documents: DocRow[] }>('/api/owner/accounting/documents', (payload) =>
        setDocuments(payload.documents),
      );
      hydrateFromCache<{ journals: JournalRow[] }>('/api/owner/accounting/journals', (payload) =>
        setJournals(payload.journals),
      );
      hydrateFromCache<{ accounts: Account[] }>('/api/owner/accounting/accounts', (payload) =>
        setAccounts(payload.accounts),
      );
      hydrateFromCache<{ expenses: ExpenseRow[] }>('/api/owner/accounting/expenses', (payload) =>
        setExpenses(payload.expenses),
      );
      hydrateFromCache<{ periods: PeriodRow[] }>('/api/owner/accounting/periods', (payload) =>
        setPeriods(payload.periods),
      );
      hydrateFromCache<{ events: AuditRow[] }>('/api/owner/accounting/audit', (payload) =>
        setAudit(payload.events),
      );

      try {
        const [hub, collection] = await Promise.all([
          getJson<HubDash>('/api/owner/accounting/hub', true),
          getJson<CollectionOutlook>('/api/owner/accounting/cheques', true).catch(() => null),
        ]);
        if (gen !== refreshGen.current) return;
        setDash(hub);
        if (collection) setOutlook(collection);
        warmedRef.current = true;
        if (gen === refreshGen.current) setWarming(false);

        const rest = Promise.all([
          getJson<{ documents: DocRow[] }>('/api/owner/accounting/documents', true),
          getJson<{ journals: JournalRow[] }>('/api/owner/accounting/journals', true),
          getJson<{ accounts: Account[] }>('/api/owner/accounting/accounts', true),
          getJson<{ expenses: ExpenseRow[] }>('/api/owner/accounting/expenses', true),
          getJson<{ periods: PeriodRow[] }>('/api/owner/accounting/periods', true),
          getJson<{ events: AuditRow[] }>('/api/owner/accounting/audit', true),
        ]).then(async ([docs, journalData, accountData, expenseData, periodData, auditData]) => {
          if (gen !== refreshGen.current) return;
          setDocuments(docs.documents);
          setJournals(journalData.journals);
          setAccounts(accountData.accounts);
          setExpenses(expenseData.expenses);
          setPeriods(periodData.periods);
          setAudit(auditData.events);

          if (
            !accountData.accounts.length &&
            (hub.capabilities.manage || hub.capabilities.post)
          ) {
            try {
              await browserNextMutation('/api/owner/accounting/accounts/bootstrap', {
                method: 'POST',
                body: '{}',
              });
              invalidateAccountingCache('/api/owner/accounting/accounts');
              if (gen !== refreshGen.current) return;
              const again = await getJson<{ accounts: Account[] }>(
                '/api/owner/accounting/accounts',
              );
              if (gen !== refreshGen.current) return;
              setAccounts(again.accounts);
            } catch {
              /* manage permission may be missing */
            }
          }

          await Promise.all([
            refreshReport().catch(() => undefined),
            ledgerIdRef.current.trim()
              ? refreshLedgers().catch(() => undefined)
              : Promise.resolve(),
          ]);
        });

        if (
          !syncedRef.current &&
          hub.needsSetup &&
          (hub.capabilities.manage || hub.capabilities.post)
        ) {
          syncedRef.current = true;
          void (async () => {
            try {
              await browserNextMutation('/api/owner/accounting/sync', {
                method: 'POST',
                body: '{}',
              });
              invalidateAccountingCache();
              if (gen !== refreshGen.current) return;
              await refreshDash();
              void refreshAllRef.current({ silent: true });
            } catch {
              /* sync is best-effort in the background */
            }
          })();
        }

        await rest.catch(() => undefined);
      } catch (err) {
        if (gen !== refreshGen.current) return;
        if (!silent || !warmedRef.current) {
          setError(err instanceof ApiError ? err.message : ar ? 'تعذر التحميل' : 'Load failed');
        }
      } finally {
        if (gen === refreshGen.current) setWarming(false);
      }
    },
    [ar, refreshDash, refreshLedgers, refreshReport],
  );
  refreshAllRef.current = refreshAll;

  useEffect(() => {
    if (!active) return;
    void warmAccountingHub();
    void refreshAll({ silent: warmedRef.current || Boolean(getAccountingCache('/api/owner/accounting/hub')) });
    const onLive = () => {
      invalidateAccountingCache();
      void refreshAll({ silent: true });
    };
    window.addEventListener(LIVE_CHANGE_EVENT, onLive);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshAll({ silent: true });
    }, 45_000);
    return () => {
      window.removeEventListener(LIVE_CHANGE_EVENT, onLive);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/active only; refreshAll identity would loop
  }, [active]);

  useEffect(() => {
    if (!active || !warmedRef.current) return;
    void refreshReport().catch(() => undefined);
  }, [active, fromDate, reportKind, toDate, refreshReport]);

  useEffect(() => {
    if (!active || !warmedRef.current) return;
    void refreshLedgers().catch(() => undefined);
  }, [active, fromDate, ledgerId, ledgerScope, toDate, refreshLedgers]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      invalidateAccountingCache();
      await refreshAll({ silent: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ar ? 'تعذر الحفظ' : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  const PRIMARY_TABS: AccountingHubTab[] = [
    'dashboard',
    'documents',
    'journal',
    'tasks',
    'deposits',
    'expenses',
    'trading',
    'cheques',
    'reports',
  ];
  const MORE_TABS: AccountingHubTab[] = ACCOUNTING_HUB_TABS.filter(
    (id) => !PRIMARY_TABS.includes(id),
  );

  return (
    <AccountingTasksProvider active={active}>
    <section className="accounting-hub" data-testid="accounting-hub" hidden={!active}>
      <header className="accounting-hub__head">
        <div>
          <p className="accounting-hub__eyebrow">{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="accounting-hub__actions">
          {(caps.manage || caps.post) && (
            <button
              type="button"
              className="button button--primary button--sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await browserNextMutation('/api/owner/accounting/sync', {
                    method: 'POST',
                    body: '{}',
                  });
                  await refreshDash();
                })
              }
            >
              {t.sync}
            </button>
          )}
          <a
            className="button button--quiet button--sm"
            href="https://hisaby.bhd-om.com"
            target="_blank"
            rel="noreferrer"
          >
            {t.hisaby}
          </a>
        </div>
      </header>

      <div
        className="accounting-hub__tabs"
        role="tablist"
        aria-label={ar ? 'أقسام المحاسبة · Accounting sections' : 'Accounting sections · أقسام المحاسبة'}
      >
        {PRIMARY_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={`accounting-hub__tab accounting-hub__tab--${id}`}
            aria-selected={tab === id}
            aria-controls={`accounting-panel-${id}`}
            id={`accounting-tab-${id}`}
            onClick={() => setTab(id)}
          >
            <TabMark id={id} />
            {t.tabLabel(id)}
          </button>
        ))}
        {MORE_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={`accounting-hub__tab accounting-hub__tab--muted accounting-hub__tab--${id}`}
            aria-selected={tab === id}
            aria-controls={`accounting-panel-${id}`}
            id={`accounting-tab-${id}`}
            onClick={() => setTab(id)}
          >
            <TabMark id={id} />
            {t.tabLabel(id)}
          </button>
        ))}
      </div>

      {error ? <p className="accounting-hub__error">{error}</p> : null}
      {warming && !dash ? (
        <p className="accounting-hub__muted accounting-hub__muted--soft">{t.warming}</p>
      ) : null}

      <AccountingTabPanel id="dashboard" tab={tab}>
        <div className="accounting-hub__panel accounting-hub__panel--hero">
          <div className="accounting-hub__hero-copy">
            <h2>{t.moneyGlance}</h2>
            <p className="accounting-hub__hint">{t.moneyHint}</p>
          </div>
          <AccountingTasksAlert locale={locale} onOpen={() => setTab('tasks')} />
          <AccountingRefundsAlert locale={locale} onOpen={() => setTab('deposits')} />
          <AccountingCollectionBoard
            locale={locale}
            outlook={outlook}
            canManage={caps.manage}
            onChanged={() => void refreshAll({ silent: true })}
          />
          <div className="accounting-hub__kpis accounting-hub__kpis--hero">
            <div className="accounting-hub__kpi accounting-hub__kpi--in">
              <span>{t.collected}</span>
              <strong>{money(omr.collectedMinor, omr.currency, ar)}</strong>
            </div>
            <div className="accounting-hub__kpi accounting-hub__kpi--hold">
              <span>{t.depositsHeld}</span>
              <strong>{money(omr.depositsMinor ?? '0', omr.currency, ar)}</strong>
            </div>
            <div className="accounting-hub__kpi accounting-hub__kpi--due">
              <span>{t.receivables}</span>
              <strong>{money(omr.receivableMinor, omr.currency, ar)}</strong>
            </div>
            <div className="accounting-hub__kpi accounting-hub__kpi--out">
              <span>{t.expenses}</span>
              <strong>{money(omr.expenseMinor, omr.currency, ar)}</strong>
            </div>
          </div>
          <div className="accounting-hub__meta-row">
            <span>
              {ar ? 'قيود مرحّلة' : 'Posted'}: {dash?.postedJournals ?? 0}
            </span>
            <span>
              {ar ? 'حسابات' : 'Accounts'}: {dash?.accountCount ?? 0}
            </span>
            <span>
              {ar ? 'فواتير متأخرة' : 'Overdue'}: {dash?.overdueInvoices ?? 0}
            </span>
          </div>
          {(dash?.recentActivity?.length ?? 0) > 0 ? (
            <div className="accounting-hub__activity">
              <h3>{ar ? 'آخر التحصيلات' : 'Recent collections'}</h3>
              <ul>
                {dash!.recentActivity!.map((row) => (
                  <li key={row.id}>
                    <span>{row.label}</span>
                    <strong>{money(row.amountMinor, row.currency, ar)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : dash ? (
            <p className="accounting-hub__muted">
              {ar
                ? 'لا تحصيلات ظاهرة بعد — اضغط «مزامنة المدفوعات» لجلب مدفوعات الإقامة والعربون إلى القيود.'
                : 'No collections yet — press “Sync payments” to pull stay and deposit money into journals.'}
            </p>
          ) : (
            <p className="accounting-hub__muted accounting-hub__muted--soft">
              {ar ? 'جاري تجهيز الملخص…' : 'Preparing summary…'}
            </p>
          )}
          <div className="accounting-hub__actions">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setTab('deposits')}
            >
              {ar ? 'أمانات التأمين' : 'Deposits'}
            </button>
            <button type="button" className="button button--quiet" onClick={() => setTab('ledgers')}>
              {ar ? 'أستاذ تحليلي' : 'Ledgers'}
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
              onClick={() => setTab('accounts')}
            >
              {ar ? 'دليل الحسابات' : 'Accounts'}
            </button>
          </div>
        </div>
      </AccountingTabPanel>

      <AccountingTabPanel id="deposits" tab={tab}>
        <DepositLedgerPanel
          portal={portal}
          locale={locale}
          active={active && tab === 'deposits'}
        />
      </AccountingTabPanel>

      <AccountingTabPanel id="accounts" tab={tab}>
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
                {(accounts ?? []).map((account) => (
                  <tr key={account.id}>
                    <td>{account.code}</td>
                    <td>{ar ? account.nameAr : account.nameEn}</td>
                    <td>{accountingAccountTypeLabel(account.type, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {accounts === null ? (
            <p className="accounting-hub__muted accounting-hub__muted--soft">
              {ar ? 'جاري التحميل…' : 'Loading…'}
            </p>
          ) : accounts.length === 0 ? (
            <p className="accounting-hub__muted">
              {ar
                ? 'لا حسابات بعد — اضغط تهيئة الدليل الافتراضي.'
                : 'No accounts yet — bootstrap the chart.'}
            </p>
          ) : null}
        </div>
      </AccountingTabPanel>

      <AccountingTabPanel id="documents" tab={tab}>
        <div className="accounting-hub__panel accounting-hub__panel--workspace">
          <div className="accounting-hub__toolbar">
            <div>
              <h2>{t.docsTitle}</h2>
              <p className="accounting-hub__hint">{t.docsHint}</p>
            </div>
          </div>
          <div className="accounting-hub__table-wrap">
            <table className="accounting-hub__table accounting-hub__table--interactive">
              <thead>
                <tr>
                  <th>{ar ? 'النوع' : 'Kind'}</th>
                  <th>{ar ? 'الحالة' : 'Status'}</th>
                  <th>{ar ? 'المرجع' : 'Ref'}</th>
                  <th>{ar ? 'العنوان' : 'Title'}</th>
                  <th>{ar ? 'الطرف / العقار' : 'Party / property'}</th>
                  <th>{ar ? 'ملاحظة' : 'Note'}</th>
                  <th className="num">{ar ? 'المبلغ' : 'Amount'}</th>
                  <th>{ar ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {documents === null ? (
                  <tr>
                    <td colSpan={8}>
                      {ar ? 'جاري التحميل…' : 'Loading…'}
                    </td>
                  </tr>
                ) : documents.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      {ar
                        ? 'لا مستندات بعد — سجّل قبض إيجار أو ادفع إقامة ثم اضغط مزامنة المدفوعات.'
                        : 'No documents yet — record rent or stay payments, then sync.'}
                    </td>
                  </tr>
                ) : (
                  documents.map((row) => (
                    <tr
                      key={`${row.kind}-${row.id}`}
                      id={`accounting-doc-${row.id}`}
                      data-kind={row.kind}
                      className={[
                        row.journalId ? 'is-clickable' : '',
                        focusId === row.id ? 'is-focus' : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined}
                      onClick={() => {
                        if (row.journalId) setOpenJournalId(row.journalId);
                      }}
                    >
                      <td>
                        <span
                          className={
                            row.kind === 'receipt'
                              ? 'tenant-doc-link tenant-doc-link--receipt'
                              : row.kind === 'invoice'
                                ? 'tenant-doc-link tenant-doc-link--invoice'
                                : `accounting-hub__chip accounting-hub__chip--${row.kind}`
                          }
                        >
                          {row.kind === 'receipt' || row.kind === 'invoice' ? null : (
                            <i aria-hidden="true" />
                          )}
                          {row.kind === 'receipt'
                            ? ar
                              ? 'إيصال القبض'
                              : 'Receipt'
                            : row.kind === 'invoice'
                              ? ar
                                ? 'الفاتورة'
                                : 'Invoice'
                              : accountingDocKindLabel(row.kind, locale)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            row.status === 'overdue' ||
                            row.status === 'bounced' ||
                            row.status === 'failed'
                              ? 'tenant-status tenant-status--bad'
                              : row.status === 'paid' ||
                                  row.status === 'posted' ||
                                  row.status === 'succeeded' ||
                                  row.status === 'cleared'
                                ? 'tenant-status tenant-status--good'
                                : row.status === 'partially_paid' || row.status === 'due_soon'
                                  ? 'tenant-status tenant-status--warn'
                                  : `accounting-hub__status accounting-hub__status--${row.status}`
                          }
                        >
                          {accountingExpenseStatusLabel(row.status, locale)}
                        </span>
                        {row.archived ? (
                          <span className="accounting-hub__status accounting-hub__status--archived">
                            {ar ? 'أرشيف' : 'Archived'}
                          </span>
                        ) : null}
                      </td>
                      <td>{row.reference}</td>
                      <td>{textLabel(row.title)}</td>
                      <td>
                        {[row.partyName, textLabel(row.propertyLabel)]
                          .filter((part) => part && part !== '—')
                          .join(' · ') || '—'}
                      </td>
                      <td>{row.note ?? '—'}</td>
                      <td className="num">
                        {row.amountMinor !== '0'
                          ? money(row.amountMinor, row.currency, ar)
                          : '—'}
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="accounting-hub__row-actions">
                          <button
                            type="button"
                            className={
                              row.kind === 'receipt'
                                ? 'tenant-doc-link tenant-doc-link--receipt'
                                : row.kind === 'invoice'
                                  ? 'tenant-doc-link tenant-doc-link--invoice'
                                  : 'accounting-act accounting-act--print'
                            }
                            onClick={() => {
                              void printAccountingDocument(row, locale).then((failed) => {
                                if (failed) setError(failed);
                              });
                            }}
                          >
                            {row.kind === 'receipt'
                              ? ar
                                ? 'إيصال القبض'
                                : 'Receipt'
                              : row.kind === 'invoice'
                                ? ar
                                  ? 'الفاتورة'
                                  : 'Invoice'
                                : ar
                                  ? 'طباعة'
                                  : 'Print'}
                          </button>
                          <button
                            type="button"
                            className="accounting-act accounting-act--send"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const result = await browserNextMutation<{
                                  emailed: number;
                                  whatsappUrl: string | null;
                                }>('/api/owner/accounting/send', {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    kind: 'document',
                                    id: row.id,
                                    channel: 'both',
                                    locale,
                                  }),
                                });
                                if (result.whatsappUrl) {
                                  window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer');
                                }
                              })
                            }
                          >
                            {ar ? 'إرسال' : 'Send'}
                          </button>
                          <AccountingRecordActions
                            locale={locale}
                            kind={row.kind}
                            id={row.id}
                            journalId={row.journalId}
                            status={row.status}
                            sourceType={row.sourceType}
                            archived={row.archived}
                            disabled={busy}
                            onDone={() => void refreshAll({ silent: true })}
                            onError={(message) => setError(message)}
                          />
                          <AccountingFollowTask
                            locale={locale}
                            kind={row.kind === 'receipt' ? 'receipt' : row.kind === 'invoice' ? 'invoice' : 'journal'}
                            sourceId={row.id}
                            title={`${row.reference} · ${textLabel(row.title)}`}
                            detail={[row.partyName, textLabel(row.propertyLabel), row.note]
                              .filter(Boolean)
                              .join(' · ')}
                            dueOn={row.occurredOn}
                            status={row.status}
                          />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </AccountingTabPanel>

      <AccountingTabPanel id="journal" tab={tab}>
        <div className="accounting-hub__panel accounting-hub__panel--workspace">
          <div className="accounting-hub__toolbar">
            <div>
              <h2>{t.journalTitle}</h2>
              <p className="accounting-hub__hint">{t.journalHint}</p>
            </div>
            {caps.manage ? (
              <button
                type="button"
                className="button button--primary"
                onClick={() => setComposeOpen(true)}
              >
                {t.newJournal}
              </button>
            ) : null}
          </div>
          <AccountingJournalComposerModal
            open={composeOpen}
            onClose={() => setComposeOpen(false)}
            locale={locale}
            accounts={accounts ?? []}
            canPost={caps.post}
            busy={busy}
            onSaved={(journalId) => {
              if (journalId) setOpenJournalId(journalId);
              void refreshAll({ silent: true });
            }}
          />
          <div className="accounting-hub__table-wrap">
            <table className="accounting-hub__table accounting-hub__table--interactive">
              <thead>
                <tr>
                  <th>{ar ? 'المرجع' : 'Ref'}</th>
                  <th>{ar ? 'التاريخ' : 'Date'}</th>
                  <th>{ar ? 'البيان' : 'Description'}</th>
                  <th>{ar ? 'المصدر' : 'Source'}</th>
                  <th>{ar ? 'الحالة' : 'Status'}</th>
                  <th className="num">{ar ? 'المبلغ' : 'Amount'}</th>
                  <th>{ar ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {journals === null ? (
                  <tr>
                    <td colSpan={7}>{ar ? 'جاري التحميل…' : 'Loading…'}</td>
                  </tr>
                ) : journals.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      {ar
                        ? 'لا قيود بعد — أنشئ قيداً أعلاه أو اضغط مزامنة المدفوعات لترحيل التحصيلات.'
                        : 'No journals yet — compose an entry above or sync payments.'}
                    </td>
                  </tr>
                ) : (
                  journals.map((row) => (
                    <tr
                      key={row.id}
                      id={`accounting-journal-${row.id}`}
                      data-kind="journal"
                      className={`is-clickable${focusId === row.id || openJournalId === row.id ? ' is-focus' : ''}`}
                      onClick={() => setOpenJournalId(row.id)}
                    >
                      <td>
                        <span className="accounting-hub__chip accounting-hub__chip--journal">
                          <i aria-hidden="true" />
                        </span>{' '}
                        {row.reference}
                      </td>
                      <td>{row.occurredOn}</td>
                      <td>{textLabel(row.description)}</td>
                      <td>{sourceLabel(row.sourceType)}</td>
                      <td>
                        <span
                          className={`accounting-hub__status accounting-hub__status--${row.status}`}
                        >
                          {statusLabel(row.status)}
                        </span>
                        {row.archived ? (
                          <span className="accounting-hub__status accounting-hub__status--archived">
                            {ar ? 'أرشيف' : 'Archived'}
                          </span>
                        ) : null}
                      </td>
                      <td className="num">{money(row.debitMinor, row.currency ?? 'OMR', ar)}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <AccountingRecordActions
                          locale={locale}
                          kind="journal"
                          id={row.id}
                          status={row.status}
                          sourceType={row.sourceType}
                          archived={row.archived}
                          disabled={busy}
                          onDone={() => void refreshAll({ silent: true })}
                          onError={(message) => setError(message)}
                        />
                        <AccountingFollowTask
                          locale={locale}
                          kind="journal"
                          sourceId={row.id}
                          title={`${row.reference} · ${textLabel(row.description)}`}
                          detail={sourceLabel(row.sourceType)}
                          dueOn={row.occurredOn}
                          status={row.status}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </AccountingTabPanel>

      <AccountingTabPanel id="tasks" tab={tab}>
        <div className="accounting-hub__panel accounting-hub__panel--workspace">
          <AccountingTasksInbox locale={locale} markSeen={active && tab === 'tasks'} />
        </div>
      </AccountingTabPanel>

      <AccountingTabPanel id="expenses" tab={tab}>
        <div className="accounting-hub__panel">
          <div className="accounting-hub__toolbar">
            <div>
              <h2>{t.expensesTitle}</h2>
              <p className="accounting-hub__hint">{t.expensesHint}</p>
            </div>
            {caps.manage ? (
              <button
                type="button"
                className="button button--primary"
                onClick={() => setExpenseModalOpen(true)}
              >
                {t.addExpenseIncome}
              </button>
            ) : null}
          </div>
          <AccountingExpenseIncomeModal
            open={expenseModalOpen}
            onClose={() => setExpenseModalOpen(false)}
            locale={locale}
            busy={busy}
            onBusy={setBusy}
            onDone={() => void refreshAll({ silent: true })}
            onError={(message) => setError(message)}
          />
          <div className="accounting-hub__table-wrap">
            <table className="accounting-hub__table">
              <thead>
                <tr>
                  <th>{t.colRef}</th>
                  <th>{ar ? 'التصنيف' : 'Category'}</th>
                  <th>{t.description}</th>
                  <th>{t.status}</th>
                  <th className="num">{t.colAmount}</th>
                  <th>{ar ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {expenses === null ? (
                  <tr>
                    <td colSpan={6}>{ar ? 'جاري التحميل…' : 'Loading…'}</td>
                  </tr>
                ) : expenses.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      {ar ? 'لا مصروفات مسجّلة بعد.' : 'No expenses recorded yet.'}
                    </td>
                  </tr>
                ) : (
                  expenses.map((row) => (
                    <tr key={row.id} data-kind="expense">
                      <td>
                        <span className="accounting-hub__chip accounting-hub__chip--expense">
                          <i aria-hidden="true" />
                        </span>{' '}
                        {row.reference}
                      </td>
                      <td>{row.category}</td>
                      <td>{textLabel(row.description)}</td>
                      <td>
                        <span className={`accounting-hub__status accounting-hub__status--${row.status}`}>
                          {accountingExpenseStatusLabel(row.status, locale)}
                        </span>
                        {row.archived ? (
                          <span className="accounting-hub__status accounting-hub__status--archived">
                            {ar ? 'أرشيف' : 'Archived'}
                          </span>
                        ) : null}
                      </td>
                      <td className="num">{money(row.amountMinor, row.currency, ar)}</td>
                      <td>
                        <AccountingRecordActions
                          locale={locale}
                          kind="expense"
                          id={row.id}
                          status={row.status}
                          sourceType="expense"
                          archived={row.archived}
                          disabled={busy}
                          onDone={() => void refreshAll({ silent: true })}
                          onError={(message) => setError(message)}
                        />
                        <AccountingFollowTask
                          locale={locale}
                          kind="expense"
                          sourceId={row.id}
                          title={`${row.reference} · ${textLabel(row.description)}`}
                          detail={row.category}
                          dueOn={row.issuedOn}
                          status={row.status}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </AccountingTabPanel>

      <AccountingTabPanel id="trading" tab={tab}>
        <div className="accounting-hub__panel">
          <div className="accounting-hub__toolbar">
            <div>
              <h2>{t.tradingTitle}</h2>
              <p className="accounting-hub__hint">{t.tradingHint}</p>
            </div>
            {caps.manage ? (
              <button
                type="button"
                className="button button--primary"
                onClick={() => setTradingModalOpen(true)}
              >
                {t.addTrading}
              </button>
            ) : null}
          </div>
          <AccountingTradingModal
            open={tradingModalOpen}
            onClose={() => setTradingModalOpen(false)}
            locale={locale}
            busy={busy}
            onBusy={setBusy}
            onDone={() => void refreshAll({ silent: true })}
            onError={(message) => setError(message)}
          />
          <p className="accounting-hub__hint">
            {ar
              ? 'بعد الحفظ يظهر القيد في دفتر اليومية والمستندات. استخدم «إضافة مشتريات / مبيعات» لكل حركة جديدة.'
              : 'After saving, the journal appears under Journal and Documents. Use “Add purchase / sale” for each new entry.'}
          </p>
        </div>
      </AccountingTabPanel>

      <AccountingTabPanel id="cheques" tab={tab}>
        <AccountingChequesPanel locale={locale} active={active && tab === 'cheques'} canManage={caps.manage} />
      </AccountingTabPanel>

      <AccountingTabPanel id="ledgers" tab={tab}>
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
                  await refreshLedgers();
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
                  <th>{ar ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
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
                      <td>
                        <AccountingFollowTask
                          locale={locale}
                          kind="ledger"
                          sourceId={`${row.reference}:${row.accountCode}:${row.occurredOn}`}
                          title={`${row.reference} · ${row.accountCode}`}
                          detail={row.description}
                          dueOn={row.occurredOn}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </AccountingTabPanel>

      <AccountingTabPanel id="reports" tab={tab}>
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
              onClick={() => void run(async () => refreshReport())}
            >
              {ar ? 'عرض' : 'Run'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={!report || busy}
              onClick={() => {
                if (!report) return;
                void openAccountingPrint(locale, 'report', `${reportKind}-${toDate}`, {
                  report: reportKind,
                  fromDate,
                  toDate,
                });
              }}
            >
              {t.printReport}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={!report || busy}
              onClick={() =>
                void run(async () => {
                  if (!report) return;
                  const summary = reportShareSummary(report, reportKind, fromDate, toDate, ar);
                  const result = await browserNextMutation<{
                    emailed: number;
                    whatsappUrl: string | null;
                  }>('/api/owner/accounting/send', {
                    method: 'POST',
                    body: JSON.stringify({
                      kind: 'report',
                      id: `${reportKind}-${fromDate}-${toDate}`,
                      channel: 'both',
                      locale,
                      reportSummary: summary,
                    }),
                  });
                  if (result.whatsappUrl) {
                    window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer');
                  }
                })
              }
            >
              {ar ? 'إرسال التقرير' : 'Send report'}
            </button>
          </div>
          <ReportView ar={ar} report={report} />
        </div>
      </AccountingTabPanel>

      <AccountingTabPanel id="periods" tab={tab}>
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
                {periods === null ? (
                  <tr>
                    <td colSpan={4}>{ar ? 'جاري التحميل…' : 'Loading…'}</td>
                  </tr>
                ) : periods.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      {ar ? 'لا فترات مقفلة بعد.' : 'No locked periods yet.'}
                    </td>
                  </tr>
                ) : (
                  periods.map((period) => (
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </AccountingTabPanel>

      <AccountingTabPanel id="settings" tab={tab}>
        <AccountingSettingsPanel
          locale={locale}
          canManage={caps.manage}
          busy={busy}
          onBusy={setBusy}
          onError={(message) => setError(message)}
        />
      </AccountingTabPanel>

      <AccountingTabPanel id="audit" tab={tab}>
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
                {audit === null ? (
                  <tr>
                    <td colSpan={4}>{ar ? 'جاري التحميل…' : 'Loading…'}</td>
                  </tr>
                ) : audit.length === 0 ? (
                  <tr>
                    <td colSpan={4}>{ar ? 'لا أحداث بعد.' : 'No events yet.'}</td>
                  </tr>
                ) : (
                  audit.map((row) => (
                    <tr key={row.id}>
                      <td>{row.occurredAt.replace('T', ' ').slice(0, 19)}</td>
                      <td>{row.eventType}</td>
                      <td>
                        {row.resourceType}:{row.resourceId.slice(0, 8)}
                      </td>
                      <td>{[row.fromStatus, row.toStatus].filter(Boolean).join(' → ') || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </AccountingTabPanel>

      <AccountingEntryDrawer
        journalId={openJournalId}
        locale={locale}
        busy={busy}
        canPost={caps.post}
        onClose={() => setOpenJournalId(null)}
        onPost={(id) =>
          void run(async () => {
            await browserNextMutation(`/api/owner/accounting/journals/${id}/post`, {
              method: 'POST',
              body: '{}',
            });
            setOpenJournalId(id);
          })
        }
        onChanged={() => void refreshAll({ silent: true })}
        onReverse={(id) => {
          const reason = window.prompt(
            ar
              ? 'سبب العكس / الاسترداد (مطلوب للمعاملات المرتبطة أو الإلكترونية):'
              : 'Reason for reverse / refund (required for linked or electronic lines):',
            '',
          );
          if (reason === null) return;
          const refundOk = window.confirm(
            ar
              ? 'أكد أن الاسترداد أو فشل التحصيل موثّق قبل عكس القيد الإلكتروني.'
              : 'Confirm the refund or collection failure is documented before reversing an electronic entry.',
          );
          if (!refundOk) return;
          void run(async () => {
            await browserNextMutation(`/api/owner/accounting/journals/${id}/reverse`, {
              method: 'POST',
              body: JSON.stringify({
                occurredOn: todayIso(),
                note: reason.trim() || undefined,
                refundConfirmed: true,
              }),
            });
            setOpenJournalId(null);
          });
        }}
      />
    </section>
    </AccountingTasksProvider>
  );
}

function reportCurrency(report: Record<string, unknown>): string {
  return typeof report.currency === 'string' && report.currency ? report.currency : 'OMR';
}

function reportTitle(kind: string, ar: boolean): string {
  const map: Record<string, { ar: string; en: string }> = {
    trial: { ar: 'ميزان المراجعة', en: 'Trial balance' },
    income: { ar: 'قائمة الدخل', en: 'Income statement' },
    balance: { ar: 'الميزانية العمومية', en: 'Balance sheet' },
    cashflow: { ar: 'التدفقات النقدية', en: 'Cash flow' },
    aging: { ar: 'أعمار الذمم', en: 'AR aging' },
  };
  const row = map[kind];
  return row ? (ar ? row.ar : row.en) : kind;
}

function reportShareSummary(
  report: Record<string, unknown>,
  kind: string,
  fromDate: string,
  toDate: string,
  ar: boolean,
): string {
  const currency = reportCurrency(report);
  const title = reportTitle(kind, ar);
  if (kind === 'income') {
    return `${title} (${fromDate} → ${toDate}): ${ar ? 'صافي الدخل' : 'net'} ${money(String(report.netIncomeMinor), currency, ar)}`;
  }
  if (kind === 'cashflow') {
    return `${title} (${fromDate} → ${toDate}): ${ar ? 'صافي النقد' : 'net cash'} ${money(String(report.netMinor), currency, ar)}`;
  }
  if (kind === 'aging') {
    return `${title}: ${ar ? 'المستحق' : 'outstanding'} ${money(String(report.totalOutstandingMinor), currency, ar)}`;
  }
  if (kind === 'balance') {
    return `${title} @ ${toDate}: ${report.balanced ? (ar ? 'متوازنة' : 'balanced') : ar ? 'غير متوازنة' : 'unbalanced'}`;
  }
  return `${title} (${fromDate} → ${toDate})`;
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
