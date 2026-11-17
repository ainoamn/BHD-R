'use client';

import { useEffect, useMemo, useState } from 'react';
import { AccountingFollowTask } from '@/components/accounting/accounting-follow-task';
import { outstandingMinorOf, RentDocLinks } from '@/components/rent-doc-links';
import { fetchAccountingJson, getAccountingCache, invalidateAccountingCache } from '@/lib/accounting-client-cache';
import { accountingChequeStatusLabel } from '@/lib/accounting-i18n';
import { browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { ledgerStatusLabel, type LedgerLineStatus } from '@/lib/tenant-ledger';

type ChequeRow = {
  id: string;
  chequeNumber: string;
  bankName: string;
  amountMinor: string;
  paidMinor?: string;
  currency: string;
  dueOn: string;
  reviewStatus: string;
  lineStatus?: string;
  kind?: string;
  lineKey?: string | null;
  leaseId: string | null;
  tenantName: string | null;
  propertyName: string | null;
  unitCode: string | null;
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
  | 'remaining'
  | 'paid'
  | 'deposit'
  | 'overdue'
  | 'pending'
  | 'accepted'
  | 'deposited'
  | 'cleared'
  | 'bounced'
  | 'postponed'
  | 'insufficient_funds'
  | 'partially_cleared';

type ActionDef = {
  status: string;
  ar: string;
  en: string;
  needs?: 'dueOn' | 'partial';
};

/** All operational actions — any can be applied/undone as long as the cheque has a DB id. */
const LIFECYCLE_ACTIONS: ActionDef[] = [
  { status: 'accepted', ar: 'استلام', en: 'Receive' },
  { status: 'deposited', ar: 'إيداع بالبنك', en: 'Bank deposit' },
  { status: 'cleared', ar: 'صرف كامل', en: 'Full clear' },
  { status: 'partially_cleared', ar: 'صرف جزئي', en: 'Partial clear', needs: 'partial' },
  { status: 'postponed', ar: 'تأجيل (طلب مستأجر)', en: 'Postpone', needs: 'dueOn' },
  { status: 'insufficient_funds', ar: 'لا يوجد رصيد', en: 'No funds' },
  { status: 'bounced', ar: 'مرتجع', en: 'Bounced' },
  { status: 'pending', ar: 'تراجع / إعادة ضبط', en: 'Undo / reset' },
  { status: 'cancelled', ar: 'إلغاء', en: 'Cancel' },
];

const PIPELINE = [
  { id: 'pending', ar: 'بانتظار الاستلام', en: 'Awaiting receipt' },
  { id: 'accepted', ar: 'مستلم', en: 'Received' },
  { id: 'deposited', ar: 'مودع بالبنك', en: 'At bank' },
  { id: 'cleared', ar: 'مصروف / محصّل', en: 'Cleared' },
] as const;

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

/** Tenant cheque lifecycle register: all rent/VAT/deposit cheques from signed leases. */
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
  const [dialogPartial, setDialogPartial] = useState('');
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
      const paid = BigInt(row.paidMinor || '0');
      const amount = BigInt(row.amountMinor || '0');
      const remaining = amount > paid;
      const closed =
        row.reviewStatus === 'cleared' ||
        row.lineStatus === 'paid' ||
        (!remaining && amount > 0n);
      if (filter === 'all') return true;
      if (filter === 'past') return row.dueOn < today;
      if (filter === 'upcoming') {
        return (
          row.dueOn >= today &&
          remaining &&
          row.reviewStatus !== 'cleared' &&
          row.reviewStatus !== 'cancelled'
        );
      }
      if (filter === 'remaining') return remaining && !closed;
      if (filter === 'paid') return closed || row.reviewStatus === 'cleared';
      if (filter === 'deposit') return row.kind === 'deposit';
      if (filter === 'overdue') {
        return (
          row.lineStatus === 'overdue' ||
          row.lineStatus === 'bounced' ||
          (row.dueOn < today && remaining && row.reviewStatus !== 'cleared')
        );
      }
      return row.reviewStatus === filter;
    });
  }, [rows, filter, today]);

  const filters: Array<[Filter, string]> = [
    ['all', ar ? 'الكل' : 'All'],
    ['past', ar ? 'سابقة' : 'Past'],
    ['upcoming', ar ? 'لاحقة' : 'Upcoming'],
    ['remaining', ar ? 'متبقية' : 'Remaining'],
    ['paid', ar ? 'مدفوعة' : 'Paid'],
    ['deposit', ar ? 'تأمينات' : 'Deposits'],
    ['overdue', ar ? 'متأخرة' : 'Overdue'],
    ['pending', ar ? 'بانتظار' : 'Pending'],
    ['accepted', ar ? 'مستلمة' : 'Received'],
    ['deposited', ar ? 'مودعة' : 'Deposited'],
    ['postponed', ar ? 'مؤجّلة' : 'Postponed'],
    ['partially_cleared', ar ? 'جزئية' : 'Partial'],
    ['cleared', ar ? 'مصروفة' : 'Cleared'],
    ['insufficient_funds', ar ? 'بلا رصيد' : 'No funds'],
    ['bounced', ar ? 'مرتجعة' : 'Bounced'],
  ];

  const statusLabel = (row: ChequeRow) => {
    if (row.lineStatus) {
      return ledgerStatusLabel(row.lineStatus as LedgerLineStatus, ar);
    }
    return accountingChequeStatusLabel(row.reviewStatus, locale);
  };

  async function advanceStatus(
    row: ChequeRow,
    status: string,
    extra?: { dueOn?: string; collectedMinor?: string; notes?: string },
  ) {
    if (!isUuid(row.id)) {
      setNotice(
        ar
          ? 'هذا القسط غير مسجّل كشيك بعد — حدّث الصفحة أو اربط رقم الشيك بالعقد.'
          : 'This installment is not registered as a cheque yet — refresh or link a cheque number.',
      );
      return;
    }
    setBusyId(row.id);
    setNotice(null);
    setMenuId(null);
    try {
      await browserNextMutation('/api/owner/accounting/cheques', {
        method: 'POST',
        body: JSON.stringify({
          id: row.id,
          status,
          ...(extra?.dueOn ? { dueOn: extra.dueOn } : {}),
          ...(extra?.collectedMinor ? { collectedMinor: extra.collectedMinor } : {}),
          ...(extra?.notes ? { notes: extra.notes } : {}),
        }),
      });
      invalidateAccountingCache();
      setReloadKey((key) => key + 1);
      setRows(null);
      setDialog(null);
      setNotice(
        ar
          ? `تم تحديث حالة الشيك ${row.chequeNumber}. يمكنك التراجع أو التعديل في أي وقت.`
          : `Cheque ${row.chequeNumber} updated. You can undo or change it anytime.`,
      );
    } catch {
      setNotice(ar ? 'تعذر تحديث حالة الشيك.' : 'Could not update cheque status.');
    } finally {
      setBusyId(null);
    }
  }

  function startAction(row: ChequeRow, action: ActionDef) {
    if (action.needs === 'dueOn') {
      setDialogDueOn(row.dueOn);
      setDialog({ row, action });
      return;
    }
    if (action.needs === 'partial') {
      setDialogPartial('');
      setDialog({ row, action });
      return;
    }
    void advanceStatus(row, action.status);
  }

  function availableActions(row: ChequeRow): ActionDef[] {
    return LIFECYCLE_ACTIONS.filter((action) => action.status !== row.reviewStatus);
  }

  return (
    <div className="accounting-hub__panel cheque-lifecycle">
      <div className="accounting-hub__toolbar">
        <div>
          <h2>{ar ? 'نظام تتبّع الشيكات' : 'Cheque tracking system'}</h2>
          <p className="accounting-hub__hint">
            {ar
              ? 'كل شيكات الإيجار والضريبة والتأمين من العقود الموثّقة — من الاستلام حتى الإيداع والصرف أو الارتجاع.'
              : 'All rent, VAT and deposit cheques from signed leases — from receipt through bank deposit to clearance or bounce.'}
          </p>
        </div>
      </div>

      <ol className="cheque-lifecycle__pipeline" aria-label={ar ? 'مسار الشيك' : 'Cheque path'}>
        {PIPELINE.map((step, index) => (
          <li key={step.id}>
            <span className="cheque-lifecycle__step-index">{index + 1}</span>
            <span>{ar ? step.ar : step.en}</span>
          </li>
        ))}
      </ol>

      {summary ? (
        <div
          className="cheque-lifecycle__stats"
          role="group"
          aria-label={ar ? 'ملخص الشيكات' : 'Cheque summary'}
        >
          <div className="cheque-lifecycle__stat">
            <span>{ar ? 'سابقة' : 'Past'}</span>
            <strong>{summary.pastCount ?? 0}</strong>
          </div>
          <div className="cheque-lifecycle__stat">
            <span>{ar ? 'لاحقة' : 'Upcoming'}</span>
            <strong>{summary.upcomingCount}</strong>
            <em>{formatMoney(summary.expectedMinor, summary.currency || 'OMR', locale)}</em>
          </div>
          <div className="cheque-lifecycle__stat">
            <span>{ar ? 'متبقية' : 'Remaining'}</span>
            <strong>{summary.remainingCount ?? 0}</strong>
            <em>
              {formatMoney(summary.remainingMinor ?? '0', summary.currency || 'OMR', locale)}
            </em>
          </div>
          <div className="cheque-lifecycle__stat cheque-lifecycle__stat--good">
            <span>{ar ? 'مدفوعة' : 'Paid'}</span>
            <strong>{summary.paidCount ?? 0}</strong>
            <em>{formatMoney(summary.paidMinor ?? '0', summary.currency || 'OMR', locale)}</em>
          </div>
          <div className="cheque-lifecycle__stat cheque-lifecycle__stat--deposit">
            <span>{ar ? 'تأمينات' : 'Deposits'}</span>
            <strong>{summary.depositCount ?? 0}</strong>
            <em>{formatMoney(summary.depositMinor ?? '0', summary.currency || 'OMR', locale)}</em>
          </div>
          {summary.arrearsMinor !== '0' ? (
            <div className="cheque-lifecycle__stat cheque-lifecycle__stat--bad">
              <span>{ar ? 'متأخرات' : 'Arrears'}</span>
              <strong>{summary.overdueCount}</strong>
              <em>{formatMoney(summary.arrearsMinor, summary.currency || 'OMR', locale)}</em>
            </div>
          ) : null}
        </div>
      ) : null}

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
                    const paid = BigInt(row.paidMinor || '0');
                    const amount = BigInt(row.amountMinor || '0');
                    const remaining = amount > paid;
                    if (id === 'past') return row.dueOn < today;
                    if (id === 'upcoming')
                      return row.dueOn >= today && remaining && row.reviewStatus !== 'cleared';
                    if (id === 'remaining') return remaining && row.reviewStatus !== 'cleared';
                    if (id === 'paid') return !remaining || row.reviewStatus === 'cleared';
                    if (id === 'deposit') return row.kind === 'deposit';
                    if (id === 'overdue')
                      return (
                        row.lineStatus === 'overdue' ||
                        (row.dueOn < today && remaining && row.reviewStatus !== 'cleared')
                      );
                    return row.reviewStatus === id;
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
              <th>{ar ? 'حالة التحصيل' : 'Collection'}</th>
              <th>{ar ? 'دورة الشيك' : 'Lifecycle'}</th>
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
                const actions = availableActions(row);
                const primary = actions.filter((action) =>
                  ['accepted', 'deposited', 'cleared', 'pending'].includes(action.status),
                );
                const more = actions.filter((action) => !primary.includes(action));
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
                      <span className={`tenant-status${tone ? ` tenant-status--${tone}` : ''}`}>
                        {statusLabel(row)}
                      </span>
                    </td>
                    <td>
                      <span className={`cheque-lifecycle__status cheque-lifecycle__status--${row.reviewStatus}`}>
                        {accountingChequeStatusLabel(row.reviewStatus, locale)}
                      </span>
                    </td>
                    <td className="num">
                      {formatMoney(row.amountMinor, row.currency || 'OMR', locale)}
                      {row.reviewStatus === 'partially_cleared' && paid !== '0' ? (
                        <div className="accounting-hub__meta">
                          {ar ? 'محصّل:' : 'Cashed:'}{' '}
                          {formatMoney(paid, row.currency || 'OMR', locale)}
                        </div>
                      ) : null}
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
                                key={action.status}
                                type="button"
                                className={`button button--tiny ${
                                  action.status === 'cleared'
                                    ? 'button--primary'
                                    : action.status === 'pending'
                                      ? 'button--quiet'
                                      : 'button--quiet'
                                }`}
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
                                    key={action.status}
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
                          status={row.lineStatus || row.reviewStatus}
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
            {dialog.action.needs === 'partial' ? (
              <label>
                {ar
                  ? `المبلغ المحصّل جزئياً (من أصل ${dialog.row.amountMinor})`
                  : `Partial amount collected (of ${dialog.row.amountMinor})`}
                <input
                  type="text"
                  inputMode="numeric"
                  value={dialogPartial}
                  onChange={(event) => setDialogPartial(event.target.value.replace(/\D/g, ''))}
                  placeholder={ar ? 'بالم وحدة صغرى' : 'minor units'}
                />
              </label>
            ) : null}
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
                    void advanceStatus(dialog.row, dialog.action.status, {
                      dueOn: dialogDueOn,
                      notes: ar ? 'تأجيل بطلب من المستأجر' : 'Postponed by tenant request',
                    });
                    return;
                  }
                  if (dialog.action.needs === 'partial') {
                    if (!/^[1-9]\d*$/.test(dialogPartial)) return;
                    void advanceStatus(dialog.row, dialog.action.status, {
                      collectedMinor: dialogPartial,
                    });
                  }
                }}
              >
                {ar ? 'تأكيد' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {canManage ? (
        <form
          className="accounting-hub__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!csv.trim()) return;
            setBusy(true);
            setNotice(null);
            void (async () => {
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
                setNotice(ar ? 'فشل الاستيراد — تحقق من الأعمدة ومعرّف العقد.' : 'Import failed.');
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <h3>{ar ? 'استيراد شيكات (CSV)' : 'Import cheques (CSV)'}</h3>
          <p className="accounting-hub__hint">
            {ar
              ? 'الأعمدة: رقم الشيك، البنك، المبلغ، تاريخ الاستحقاق (YYYY-MM-DD)، معرّف العقد (اختياري).'
              : 'Columns: cheque number, bank, amount, due date (YYYY-MM-DD), lease id (optional).'}
          </p>
          <textarea
            rows={5}
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            placeholder={
              ar
                ? 'chequeNumber,bankName,amount,dueOn,leaseId'
                : 'chequeNumber,bankName,amount,dueOn,leaseId'
            }
          />
          <button className="button button--primary" type="submit" disabled={busy || !csv.trim()}>
            {ar ? 'استيراد' : 'Import'}
          </button>
        </form>
      ) : null}
    </div>
  );
}
