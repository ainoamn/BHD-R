'use client';

import { useEffect, useMemo, useState } from 'react';
import { AccountingFollowTask } from '@/components/accounting/accounting-follow-task';
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
  leaseId: string | null;
  tenantName: string | null;
  propertyName: string | null;
  unitCode: string | null;
};

type Summary = {
  arrearsMinor: string;
  expectedMinor: string;
  overdueCount: number;
  upcomingCount: number;
  currency: string;
};

type Filter = 'all' | 'pending' | 'accepted' | 'deposited' | 'cleared' | 'bounced' | 'overdue' | 'upcoming';

/** Tenant collection register: schedule from signed leases + cheque status + CSV import. */
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
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!active && rows !== null) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/owner/accounting/cheques', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('fail');
        const payload = (await response.json()) as {
          cheques?: ChequeRow[];
          summary?: Summary;
        };
        setRows(payload.cheques ?? []);
        setSummary(payload.summary ?? null);
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when tab opens or import finishes
  }, [active, reloadKey]);

  const today = new Date().toISOString().slice(0, 10);
  const visible = useMemo(() => {
    const list = rows ?? [];
    return list.filter((row) => {
      if (filter === 'all') return true;
      if (filter === 'overdue') {
        return (
          row.lineStatus === 'overdue' ||
          row.lineStatus === 'bounced' ||
          (row.dueOn < today &&
            row.reviewStatus !== 'cleared' &&
            row.reviewStatus !== 'cancelled' &&
            row.reviewStatus !== 'bounced')
        );
      }
      if (filter === 'upcoming') {
        return (
          row.lineStatus === 'upcoming' ||
          row.lineStatus === 'due_soon' ||
          row.lineStatus === 'due' ||
          (row.dueOn >= today &&
            row.reviewStatus !== 'cleared' &&
            row.reviewStatus !== 'cancelled')
        );
      }
      return row.reviewStatus === filter;
    });
  }, [rows, filter, today]);

  const filters: Array<[Filter, string]> = [
    ['all', ar ? 'الكل' : 'All'],
    ['overdue', ar ? 'متأخرة' : 'Overdue'],
    ['upcoming', ar ? 'قادمة' : 'Upcoming'],
    ['pending', ar ? 'بانتظار' : 'Pending'],
    ['accepted', ar ? 'مقبولة' : 'Accepted'],
    ['deposited', ar ? 'مودعة' : 'Deposited'],
    ['cleared', ar ? 'محصّلة' : 'Cleared'],
    ['bounced', ar ? 'مرتجعة' : 'Bounced'],
  ];

  const statusLabel = (row: ChequeRow) => {
    if (row.lineStatus) {
      return ledgerStatusLabel(row.lineStatus as LedgerLineStatus, ar);
    }
    return accountingChequeStatusLabel(row.reviewStatus, locale);
  };

  return (
    <div className="accounting-hub__panel">
      <div className="accounting-hub__toolbar">
        <div>
          <h2>{ar ? 'التحصيل والشيكات' : 'Collections & cheques'}</h2>
          <p className="accounting-hub__hint">
            {ar
              ? 'تُجلب من جداول أقساط العقود الموثّقة. لا تُحذف أقساط أو شيكات مرتبطة بالعقد — تُحدَّث الحالة بعد التحقق والتحصيل فقط.'
              : 'From signed lease schedules. Lease-linked installments and cheques are not deleted — only status changes after verification and collection.'}
          </p>
        </div>
      </div>

      {summary ? (
        <div className="accounting-hub__stat-row" role="group" aria-label={ar ? 'ملخص التحصيل' : 'Collection summary'}>
          <div className="accounting-hub__stat">
            <span className="accounting-hub__stat-label">{ar ? 'متأخرات العقارات' : 'Property arrears'}</span>
            <strong>
              {formatMoney(summary.arrearsMinor, summary.currency || 'OMR', locale)}
            </strong>
            <span className="accounting-hub__meta">
              {ar ? `${summary.overdueCount} قسط متأخر` : `${summary.overdueCount} overdue`}
            </span>
          </div>
          <div className="accounting-hub__stat">
            <span className="accounting-hub__stat-label">
              {ar ? 'متوقع استلامه لاحقاً' : 'Expected receipts'}
            </span>
            <strong>
              {formatMoney(summary.expectedMinor, summary.currency || 'OMR', locale)}
            </strong>
            <span className="accounting-hub__meta">
              {ar ? `${summary.upcomingCount} قسط قادم` : `${summary.upcomingCount} upcoming`}
            </span>
          </div>
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
          </button>
        ))}
      </div>

      {failed ? (
        <p className="accounting-hub__error">{ar ? 'تعذر تحميل الشيكات' : 'Could not load cheques'}</p>
      ) : null}

      <div className="accounting-hub__table-wrap">
        <table className="accounting-hub__table">
          <thead>
            <tr>
              <th>{ar ? 'رقم الشيك / القسط' : 'Cheque / installment'}</th>
              <th>{ar ? 'المستأجر' : 'Tenant'}</th>
              <th>{ar ? 'المبنى / الوحدة' : 'Property / unit'}</th>
              <th>{ar ? 'البنك' : 'Bank'}</th>
              <th>{ar ? 'الاستحقاق' : 'Due'}</th>
              <th>{ar ? 'الحالة' : 'Status'}</th>
              <th className="num">{ar ? 'المبلغ' : 'Amount'}</th>
              <th>{ar ? 'إجراءات' : 'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={8}>{ar ? 'جارٍ التحميل…' : 'Loading…'}</td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  {ar
                    ? 'لا أقساط بعد — وثّق عقد إيجار بجدول دفعات لتظهر هنا مباشرة.'
                    : 'No installments yet — document a lease with a payment schedule to see them here.'}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} data-kind="cheque">
                  <td dir="ltr">
                    <span className="accounting-hub__chip accounting-hub__chip--cheque">
                      <i aria-hidden="true" />
                    </span>{' '}
                    {row.chequeNumber}
                  </td>
                  <td>
                    <bdi>{row.tenantName || '—'}</bdi>
                  </td>
                  <td>
                    {[row.propertyName, row.unitCode].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td>{row.bankName}</td>
                  <td dir="ltr">{row.dueOn}</td>
                  <td>
                    <span
                      className={`accounting-hub__status accounting-hub__status--${row.lineStatus || row.reviewStatus}`}
                    >
                      {statusLabel(row)}
                    </span>
                  </td>
                  <td className="num">
                    {formatMoney(row.amountMinor, row.currency || 'OMR', locale)}
                  </td>
                  <td>
                    <AccountingFollowTask
                      locale={locale}
                      kind="cheque"
                      sourceId={row.id}
                      title={`${row.chequeNumber} · ${row.tenantName || row.propertyName || ''}`.trim()}
                      detail={[row.propertyName, row.unitCode, row.bankName].filter(Boolean).join(' · ')}
                      dueOn={row.dueOn}
                      status={row.lineStatus || row.reviewStatus}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
          {notice ? <p className="accounting-hub__meta">{notice}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
