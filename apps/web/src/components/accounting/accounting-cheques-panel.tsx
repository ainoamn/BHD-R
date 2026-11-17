'use client';

import { useEffect, useMemo, useState } from 'react';
import { AccountingFollowTask } from '@/components/accounting/accounting-follow-task';
import { useAccountingTrustConfirm } from '@/components/accounting/accounting-trust-confirm';
import {
  AccountingWorkspace,
  AccountingWorkspaceSection,
} from '@/components/accounting/accounting-workspace';
import { outstandingMinorOf, RentDocLinks } from '@/components/rent-doc-links';
import { fetchAccountingJson, getAccountingCache, invalidateAccountingCache } from '@/lib/accounting-client-cache';
import {
  accountingChequeOperationLabel,
  accountingChequeStatusLabel,
} from '@/lib/accounting-i18n';
import { browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { ledgerStatusLabel, type LedgerLineStatus } from '@/lib/tenant-ledger';

type ChequeOp = {
  id: string;
  operation: string;
  fromStatus: string | null;
  toStatus: string | null;
  occurredOn: string;
  notes: string | null;
  bounceReason: string | null;
  journalEntryId: string | null;
  createdAt: string;
};

type ChequeRow = {
  id: string;
  chequeNumber: string;
  bankName: string;
  amountMinor: string;
  paidMinor?: string;
  currency: string;
  dueOn: string;
  reviewStatus: string;
  bounceReason?: string | null;
  receivedOn?: string | null;
  depositedOn?: string | null;
  clearedOn?: string | null;
  lineStatus?: string;
  kind?: string;
  lineKey?: string | null;
  leaseId: string | null;
  tenantName: string | null;
  propertyName: string | null;
  unitCode: string | null;
  operations?: ChequeOp[];
};

const STATUS_TONE: Partial<Record<string, string>> = {
  paid: 'good',
  overdue: 'bad',
  bounced: 'bad',
  stopped: 'bad',
  partially_paid: 'warn',
  due_soon: 'warn',
  collecting: 'info',
};

type Summary = {
  arrearsMinor: string;
  expectedMinor: string;
  overdueCount: number;
  upcomingCount: number;
  paidCount?: number;
  paidMinor?: string;
  remainingCount?: number;
  remainingMinor?: string;
  pastCount?: number;
  depositCount?: number;
  depositMinor?: string;
  currency: string;
};

type Filter =
  | 'all'
  | 'past'
  | 'upcoming'
  | 'in_hand'
  | 'under_collection'
  | 'cleared'
  | 'bounced'
  | 'cancelled';

type ActionDef = {
  operation: string;
  ar: string;
  en: string;
  needs?: 'dueOn' | 'bounce';
  primary?: boolean;
};

const PIPELINE = [
  { id: 'in_hand', ar: 'في اليد', en: 'In hand' },
  { id: 'under_collection', ar: 'برسم التحصيل', en: 'Under collection' },
  { id: 'cleared', ar: 'محصّل', en: 'Cleared' },
] as const;

const BOUNCE_REASONS: Array<{ id: string; ar: string; en: string }> = [
  { id: 'insufficient_funds', ar: 'لا يوجد رصيد', en: 'Insufficient funds' },
  { id: 'signature', ar: 'توقيع غير مطابق', en: 'Signature mismatch' },
  { id: 'account_closed', ar: 'حساب مغلق', en: 'Account closed' },
  { id: 'stale', ar: 'شيك منتهي', en: 'Stale / expired' },
  { id: 'other', ar: 'سبب آخر', en: 'Other' },
];

function kindLabel(kind: string | undefined, ar: boolean) {
  if (kind === 'deposit') return ar ? 'تأمين' : 'Deposit';
  if (kind === 'vat') return ar ? 'ضريبة' : 'VAT';
  if (kind === 'rent') return ar ? 'إيجار' : 'Rent';
  return ar ? 'شيك' : 'Cheque';
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeStatus(status: string): string {
  if (status === 'pending' || status === 'accepted' || status === 'postponed') return 'in_hand';
  if (status === 'deposited') return 'under_collection';
  if (status === 'insufficient_funds') return 'bounced';
  if (status === 'partially_cleared') return 'cleared';
  if (status === 'rejected') return 'cancelled';
  return status;
}

function actionsFor(status: string): ActionDef[] {
  const s = normalizeStatus(status);
  if (s === 'in_hand') {
    return [
      { operation: 'deposit', ar: 'إيداع بالبنك', en: 'Deposit at bank', primary: true },
      { operation: 'postpone', ar: 'تأجيل التاريخ', en: 'Postpone date', needs: 'dueOn' },
      { operation: 'cancel', ar: 'إلغاء / إعادة للعميل', en: 'Cancel / return' },
      { operation: 'undo', ar: 'تراجع عن آخر خطوة', en: 'Undo last step' },
    ];
  }
  if (s === 'under_collection') {
    return [
      { operation: 'collect', ar: 'تحصيل', en: 'Collect', primary: true },
      { operation: 'bounce', ar: 'ارتجاع', en: 'Bounce', needs: 'bounce' },
      { operation: 'undo', ar: 'تراجع عن آخر خطوة', en: 'Undo last step' },
    ];
  }
  if (s === 'bounced') {
    return [
      { operation: 'redeposit', ar: 'إعادة إيداع', en: 'Redeposit', primary: true },
      { operation: 'undo', ar: 'تراجع عن آخر خطوة', en: 'Undo last step' },
    ];
  }
  if (s === 'cleared' || s === 'cancelled') {
    return [{ operation: 'undo', ar: 'تراجع عن آخر خطوة', en: 'Undo last step' }];
  }
  return [];
}

/** PDC cheque register: In hand → Under collection → Cleared (+ bounce / cancel). */
export function AccountingChequesPanel({
  locale,
  active,
  canManage,
}: {
  locale: 'ar' | 'en';
  active: boolean;
  canManage: boolean;
}) {
  const ar = locale === 'ar';
  const trust = useAccountingTrustConfirm(locale);
  const [rows, setRows] = useState<ChequeRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [dialog, setDialog] = useState<null | {
    row: ChequeRow;
    action: ActionDef;
  }>(null);
  const [dialogDueOn, setDialogDueOn] = useState('');
  const [dialogBounce, setDialogBounce] = useState('insufficient_funds');
  const [dialogNotes, setDialogNotes] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!active && rows !== null) return;
    const cached = getAccountingCache<{ cheques?: ChequeRow[]; summary?: Summary }>(
      '/api/owner/accounting/cheques',
    );
    if (cached && rows === null) {
      setRows(cached.cheques ?? []);
      setSummary(cached.summary ?? null);
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const payload = await fetchAccountingJson<{
          cheques?: ChequeRow[];
          summary?: Summary;
        }>('/api/owner/accounting/cheques', {
          preferCache: rows !== null,
          signal: controller.signal,
        });
        setRows(payload.cheques ?? []);
        setSummary(payload.summary ?? null);
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when tab opens or action finishes
  }, [active, reloadKey]);

  const today = new Date().toISOString().slice(0, 10);
  const visible = useMemo(() => {
    const list = rows ?? [];
    return list.filter((row) => {
      const status = normalizeStatus(row.reviewStatus);
      if (filter === 'all') return true;
      if (filter === 'past') return row.dueOn < today;
      if (filter === 'upcoming') {
        return row.dueOn >= today && status !== 'cleared' && status !== 'cancelled';
      }
      return status === filter;
    });
  }, [rows, filter, today]);

  const filters: Array<[Filter, string]> = [
    ['all', ar ? 'الكل' : 'All'],
    ['in_hand', ar ? 'في اليد' : 'In hand'],
    ['under_collection', ar ? 'برسم التحصيل' : 'Under collection'],
    ['cleared', ar ? 'محصّل' : 'Cleared'],
    ['bounced', ar ? 'مرتجع' : 'Bounced'],
    ['cancelled', ar ? 'ملغى' : 'Cancelled'],
    ['past', ar ? 'سابقة' : 'Past'],
    ['upcoming', ar ? 'لاحقة' : 'Upcoming'],
  ];

  const statusLabel = (row: ChequeRow) => {
    if (row.lineStatus) {
      return ledgerStatusLabel(row.lineStatus as LedgerLineStatus, ar);
    }
    return accountingChequeStatusLabel(normalizeStatus(row.reviewStatus), locale);
  };

  function chequeTrustRows(
    row: ChequeRow,
    action: ActionDef,
    extra?: { dueOn?: string; bounceReason?: string; notes?: string },
  ) {
    const bounceLabel = extra?.bounceReason
      ? BOUNCE_REASONS.find((item) => item.id === extra.bounceReason)
      : null;
    return [
      { label: ar ? 'رقم الشيك' : 'Cheque #', value: row.chequeNumber },
      {
        label: ar ? 'المستأجر' : 'Tenant',
        value: row.tenantName || '—',
      },
      {
        label: ar ? 'المبلغ' : 'Amount',
        value: formatMoney(row.amountMinor, row.currency || 'OMR', locale),
      },
      { label: ar ? 'الاستحقاق' : 'Due', value: extra?.dueOn || row.dueOn },
      {
        label: ar ? 'الحالة الحالية' : 'Current status',
        value: accountingChequeStatusLabel(normalizeStatus(row.reviewStatus), locale),
      },
      {
        label: ar ? 'العملية' : 'Operation',
        value: ar ? action.ar : action.en,
      },
      ...(bounceLabel
        ? [{ label: ar ? 'سبب الارتجاع' : 'Bounce reason', value: ar ? bounceLabel.ar : bounceLabel.en }]
        : []),
      ...(extra?.notes
        ? [{ label: ar ? 'ملاحظات' : 'Notes', value: extra.notes }]
        : []),
    ];
  }

  async function runOperation(
    row: ChequeRow,
    action: ActionDef,
    extra?: { dueOn?: string; bounceReason?: string; notes?: string },
  ) {
    if (!isUuid(row.id)) {
      setNotice(
        ar
          ? 'هذا القسط غير مسجّل كشيك بعد — حدّث الصفحة أو اربط رقم الشيك بالعقد.'
          : 'This installment is not registered as a cheque yet — refresh or link a cheque number.',
      );
      return;
    }
    const ok = await trust.ask({
      title: ar ? action.ar : action.en,
      subtitle: ar
        ? `شيك ${row.chequeNumber} — راجع التفاصيل قبل الترحيل`
        : `Cheque ${row.chequeNumber} — review before posting`,
      rows: chequeTrustRows(row, action, extra),
      impact:
        action.operation === 'undo'
          ? ar
            ? 'سيُعكس آخر قيد مسجّل لهذا الشيك وتُعاد الحالة السابقة فقط.'
            : 'Only the last journal for this cheque will be reversed and the previous status restored.'
          : action.operation === 'postpone'
            ? ar
              ? 'يُحدَّث تاريخ الاستحقاق فقط؛ الشيك يبقى في اليد بدون قيد نقدي.'
              : 'Only the due date changes; the cheque stays in hand with no cash journal.'
            : ar
              ? 'ستُنشأ عملية في سجل الشيكات مع قيد يومية متوازن عبر الحسابات الوسيطة.'
              : 'A cheque-register operation will be logged with a balanced journal through control accounts.',
      tone: action.operation === 'bounce' || action.operation === 'cancel' || action.operation === 'undo'
        ? 'danger'
        : action.operation === 'collect'
          ? 'success'
          : 'default',
      confirmLabel: ar ? 'تأكيد العملية' : 'Confirm operation',
    });
    if (!ok) return;

    setBusyId(row.id);
    setNotice(null);
    setMenuId(null);
    try {
      await browserNextMutation('/api/owner/accounting/cheques', {
        method: 'POST',
        body: JSON.stringify({
          id: row.id,
          operation: action.operation,
          ...(extra?.dueOn ? { dueOn: extra.dueOn } : {}),
          ...(extra?.bounceReason ? { bounceReason: extra.bounceReason } : {}),
          ...(extra?.notes ? { notes: extra.notes } : {}),
        }),
      });
      invalidateAccountingCache();
      setReloadKey((key) => key + 1);
      setRows(null);
      setDialog(null);
      setNotice(
        ar
          ? `تم تسجيل عملية الشيك ${row.chequeNumber}. التراجع يعكس آخر خطوة فقط.`
          : `Cheque ${row.chequeNumber} updated. Undo reverses the last step only.`,
      );
    } catch {
      setNotice(
        ar
          ? 'تعذر تنفيذ العملية — تحقق من الحالة الحالية للشيك.'
          : 'Could not run operation — check the cheque’s current status.',
      );
    } finally {
      setBusyId(null);
    }
  }

  function startAction(row: ChequeRow, action: ActionDef) {
    if (action.needs === 'dueOn') {
      setDialogDueOn(row.dueOn);
      setDialogNotes('');
      setDialog({ row, action });
      return;
    }
    if (action.needs === 'bounce') {
      setDialogBounce('insufficient_funds');
      setDialogNotes('');
      setDialog({ row, action });
      return;
    }
    void runOperation(row, action);
  }

  const currency = summary?.currency || 'OMR';

  return (
    <div className="cheque-lifecycle">
      {trust.gate}
      <AccountingWorkspace
        title={ar ? 'سجل الشيكات (PDC)' : 'Cheque register (PDC)'}
        hint={
          ar
            ? 'دورة معيارية: في اليد → برسم التحصيل → محصّل. كل خطوة عملية بقيد، والتراجع لآخر عملية فقط.'
            : 'Standard path: in hand → under collection → cleared. Each step is an operation with a journal; undo reverses the last step only.'
        }
        {...(summary
          ? {
              metrics: [
                {
                  key: 'cleared',
                  label: ar ? 'محصّلة' : 'Cleared',
                  value: formatMoney(summary.paidMinor ?? '0', currency, locale),
                  tone: 'revenue' as const,
                  badge: String(summary.paidCount ?? 0),
                  icon: '✓',
                },
                {
                  key: 'upcoming',
                  label: ar ? 'لاحقة' : 'Upcoming',
                  value: formatMoney(summary.expectedMinor, currency, locale),
                  tone: 'profit' as const,
                  badge: String(summary.upcomingCount),
                  icon: '◷',
                },
                {
                  key: 'deposits',
                  label: ar ? 'تأمينات' : 'Deposits',
                  value: formatMoney(summary.depositMinor ?? '0', currency, locale),
                  tone: 'cash' as const,
                  badge: String(summary.depositCount ?? 0),
                  icon: '◈',
                },
                {
                  key: 'arrears',
                  label: ar ? 'متأخرات' : 'Arrears',
                  value: formatMoney(summary.arrearsMinor, currency, locale),
                  tone: 'expense' as const,
                  badge: String(summary.overdueCount),
                  icon: '!',
                },
              ],
              stats: [
                {
                  key: 'past',
                  label: ar ? 'سابقة' : 'Past',
                  value: String(summary.pastCount ?? 0),
                },
                {
                  key: 'all',
                  label: ar ? 'إجمالي الشيكات' : 'All cheques',
                  value: String(rows?.length ?? '—'),
                },
              ],
            }
          : {})}
        beforeSection={
          <ol className="cheque-lifecycle__pipeline" aria-label={ar ? 'مسار الشيك' : 'Cheque path'}>
            {PIPELINE.map((step, index) => (
              <li key={step.id}>
                <span className="cheque-lifecycle__step-index">{index + 1}</span>
                <span>{ar ? step.ar : step.en}</span>
              </li>
            ))}
          </ol>
        }
        {...(canManage
          ? {
              afterSection: (
                <AccountingWorkspaceSection
                  title={ar ? 'استيراد شيكات (CSV)' : 'Import cheques (CSV)'}
                  hint={
                    ar
                      ? 'الأعمدة: رقم الشيك، البنك، المبلغ، تاريخ الاستحقاق (YYYY-MM-DD)، معرّف العقد (اختياري).'
                      : 'Columns: cheque number, bank, amount, due date (YYYY-MM-DD), lease id (optional).'
                  }
                >
                  <form
                    className="accounting-hub__form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!csv.trim()) return;
                      void (async () => {
                        const ok = await trust.ask({
                          title: ar ? 'استيراد شيكات CSV' : 'Import cheques CSV',
                          subtitle: ar
                            ? 'راجع أن الملف يحتوي أرقام شيكات وتواريخ صحيحة قبل الترحيل'
                            : 'Confirm the file has valid cheque numbers and dates before posting',
                          rows: [
                            {
                              label: ar ? 'عدد الأسطر التقريبي' : 'Approx. lines',
                              value: String(csv.trim().split(/\r?\n/).filter(Boolean).length),
                            },
                          ],
                          impact: ar
                            ? 'ستُضاف الشيكات الجديدة بحالة «في اليد» دون تحصيل نقدي.'
                            : 'New cheques will be added as in-hand with no cash collection.',
                          confirmLabel: ar ? 'تأكيد الاستيراد' : 'Confirm import',
                        });
                        if (!ok) return;
                        setBusy(true);
                        setNotice(null);
                        try {
                          const result = await browserNextMutation<{
                            imported?: number;
                            skipped?: number;
                          }>('/api/owner/accounting/cheques', {
                            method: 'POST',
                            body: JSON.stringify({ csv }),
                          });
                          setCsv('');
                          setNotice(
                            ar
                              ? `تم استيراد ${result.imported ?? 0} شيك، وتخطّي ${result.skipped ?? 0}.`
                              : `Imported ${result.imported ?? 0}, skipped ${result.skipped ?? 0}.`,
                          );
                          invalidateAccountingCache();
                          setReloadKey((key) => key + 1);
                          setRows(null);
                        } catch {
                          setNotice(
                            ar
                              ? 'فشل الاستيراد — تحقق من الأعمدة ومعرّف العقد.'
                              : 'Import failed.',
                          );
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  >
                    <textarea
                      rows={5}
                      value={csv}
                      onChange={(event) => setCsv(event.target.value)}
                      placeholder="chequeNumber,bankName,amount,dueOn,leaseId"
                    />
                    <button
                      className="button button--primary"
                      type="submit"
                      disabled={busy || !csv.trim()}
                    >
                      {ar ? 'استيراد' : 'Import'}
                    </button>
                  </form>
                </AccountingWorkspaceSection>
              ),
            }
          : {})}
      >
        <div className="accounting-hub__chips" role="tablist">
          {filters.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`button button--tiny ${filter === id ? 'button--primary' : 'button--quiet'}`}
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
              {id === 'all' && rows ? ` (${rows.length})` : ''}
              {id !== 'all' && rows
                ? ` (${
                    rows.filter((row) => {
                      const status = normalizeStatus(row.reviewStatus);
                      if (id === 'past') return row.dueOn < today;
                      if (id === 'upcoming')
                        return row.dueOn >= today && status !== 'cleared' && status !== 'cancelled';
                      return status === id;
                    }).length
                  })`
                : ''}
            </button>
          ))}
        </div>

        {failed ? (
          <p className="accounting-hub__error">
            {ar ? 'تعذر تحميل الشيكات' : 'Could not load cheques'}
          </p>
        ) : null}
        {notice ? <p className="accounting-hub__meta">{notice}</p> : null}

        <div className="accounting-hub__table-wrap">
          <table className="accounting-hub__table">
          <thead>
            <tr>
              <th>{ar ? 'النوع' : 'Kind'}</th>
              <th>{ar ? 'رقم الشيك' : 'Cheque #'}</th>
              <th>{ar ? 'المستأجر' : 'Tenant'}</th>
              <th>{ar ? 'المبنى / الوحدة' : 'Property / unit'}</th>
              <th>{ar ? 'البنك' : 'Bank'}</th>
              <th>{ar ? 'الاستحقاق' : 'Due'}</th>
              <th>{ar ? 'الحالة' : 'Status'}</th>
              <th>{ar ? 'التواريخ' : 'Dates'}</th>
              <th className="num">{ar ? 'المبلغ' : 'Amount'}</th>
              <th>{ar ? 'الإيصال' : 'Docs'}</th>
              <th>{ar ? 'إجراءات' : 'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={11}>{ar ? 'جارٍ التحميل…' : 'Loading…'}</td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={11}>
                  {ar
                    ? 'لا شيكات في هذا التصفية — وثّق عقد إيجار بجدول دفعات وشيكات تأمين لتظهر هنا.'
                    : 'No cheques in this filter — document a lease with payment and deposit cheques.'}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const tone = STATUS_TONE[row.lineStatus || ''] ?? '';
                const paid = row.paidMinor ?? '0';
                const status = normalizeStatus(row.reviewStatus);
                const actions = actionsFor(status);
                const primary = actions.filter((action) => action.primary);
                const more = actions.filter((action) => !action.primary);
                const dates = [
                  row.receivedOn ? `${ar ? 'استلام' : 'Rcv'} ${row.receivedOn}` : null,
                  row.depositedOn ? `${ar ? 'إيداع' : 'Dep'} ${row.depositedOn}` : null,
                  row.clearedOn ? `${ar ? 'تحصيل' : 'Clr'} ${row.clearedOn}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <tr key={row.id} data-kind={row.kind || 'cheque'}>
                    <td>
                      <span
                        className={`cheque-lifecycle__kind cheque-lifecycle__kind--${row.kind || 'cheque'}`}
                      >
                        {kindLabel(row.kind, ar)}
                      </span>
                    </td>
                    <td dir="ltr">{row.chequeNumber}</td>
                    <td>
                      <bdi>{row.tenantName || '—'}</bdi>
                    </td>
                    <td>{[row.propertyName, row.unitCode].filter(Boolean).join(' · ') || '—'}</td>
                    <td>{row.bankName}</td>
                    <td dir="ltr">{row.dueOn}</td>
                    <td>
                      <span className={`cheque-lifecycle__status cheque-lifecycle__status--${status}`}>
                        {accountingChequeStatusLabel(status, locale)}
                      </span>
                      {row.bounceReason ? (
                        <div className="accounting-hub__meta">
                          {BOUNCE_REASONS.find((item) => item.id === row.bounceReason)
                            ? ar
                              ? BOUNCE_REASONS.find((item) => item.id === row.bounceReason)!.ar
                              : BOUNCE_REASONS.find((item) => item.id === row.bounceReason)!.en
                            : row.bounceReason}
                        </div>
                      ) : null}
                      {row.operations && row.operations.length ? (
                        <div className="cheque-lifecycle__ops">
                          {row.operations.slice(0, 3).map((op) => (
                            <span key={op.id}>
                              {accountingChequeOperationLabel(op.operation, locale)} · {op.occurredOn}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <span className={`tenant-status${tone ? ` tenant-status--${tone}` : ''}`}>
                        {statusLabel(row)}
                      </span>
                    </td>
                    <td className="accounting-hub__meta" dir="ltr">
                      {dates || '—'}
                    </td>
                    <td className="num">
                      {formatMoney(row.amountMinor, row.currency || 'OMR', locale)}
                    </td>
                    <td>
                      {row.leaseId && row.lineKey ? (
                        <RentDocLinks
                          portal="owner"
                          leaseId={row.leaseId}
                          lineKey={row.lineKey}
                          paidMinor={paid}
                          outstandingMinor={outstandingMinorOf(row.amountMinor, paid)}
                          ar={ar}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <div className="cheque-lifecycle__actions">
                        {canManage
                          ? primary.map((action) => (
                              <button
                                key={action.operation}
                                type="button"
                                className="button button--tiny button--primary"
                                disabled={busyId === row.id}
                                onClick={() => startAction(row, action)}
                              >
                                {ar ? action.ar : action.en}
                              </button>
                            ))
                          : null}
                        {canManage && more.length ? (
                          <div className="cheque-lifecycle__more">
                            <button
                              type="button"
                              className="button button--tiny button--quiet"
                              disabled={busyId === row.id}
                              aria-expanded={menuId === row.id}
                              onClick={() =>
                                setMenuId((current) => (current === row.id ? null : row.id))
                              }
                            >
                              {ar ? 'المزيد…' : 'More…'}
                            </button>
                            {menuId === row.id ? (
                              <div className="cheque-lifecycle__menu" role="menu">
                                {more.map((action) => (
                                  <button
                                    key={action.operation}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => startAction(row, action)}
                                  >
                                    {ar ? action.ar : action.en}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <AccountingFollowTask
                          locale={locale}
                          kind="cheque"
                          sourceId={row.id}
                          title={`${row.chequeNumber} · ${row.tenantName || row.propertyName || ''}`.trim()}
                          detail={[row.propertyName, row.unitCode, row.bankName]
                            .filter(Boolean)
                            .join(' · ')}
                          dueOn={row.dueOn}
                          status={row.lineStatus || status}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          </table>
        </div>
      </AccountingWorkspace>

      {dialog ? (
        <div className="cheque-lifecycle__dialog" role="dialog" aria-modal="true">
          <div className="cheque-lifecycle__dialog-card">
            <h3>
              {ar ? dialog.action.ar : dialog.action.en} · {dialog.row.chequeNumber}
            </h3>
            {dialog.action.needs === 'dueOn' ? (
              <label>
                {ar ? 'تاريخ الاستحقاق الجديد' : 'New due date'}
                <input
                  type="date"
                  value={dialogDueOn}
                  onChange={(event) => setDialogDueOn(event.target.value)}
                />
              </label>
            ) : null}
            {dialog.action.needs === 'bounce' ? (
              <label>
                {ar ? 'سبب الارتجاع' : 'Bounce reason'}
                <select
                  value={dialogBounce}
                  onChange={(event) => setDialogBounce(event.target.value)}
                >
                  {BOUNCE_REASONS.map((reason) => (
                    <option key={reason.id} value={reason.id}>
                      {ar ? reason.ar : reason.en}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              {ar ? 'ملاحظات (اختياري)' : 'Notes (optional)'}
              <input
                type="text"
                value={dialogNotes}
                onChange={(event) => setDialogNotes(event.target.value)}
              />
            </label>
            <div className="cheque-lifecycle__dialog-actions">
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setDialog(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={busyId === dialog.row.id}
                onClick={() => {
                  if (dialog.action.needs === 'dueOn') {
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(dialogDueOn)) return;
                    setDialog(null);
                    void runOperation(dialog.row, dialog.action, {
                      dueOn: dialogDueOn,
                      ...(dialogNotes.trim() ? { notes: dialogNotes.trim() } : {}),
                    });
                    return;
                  }
                  if (dialog.action.needs === 'bounce') {
                    setDialog(null);
                    void runOperation(dialog.row, dialog.action, {
                      bounceReason: dialogBounce,
                      ...(dialogNotes.trim() ? { notes: dialogNotes.trim() } : {}),
                    });
                  }
                }}
              >
                {ar ? 'متابعة للمراجعة' : 'Continue to review'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
