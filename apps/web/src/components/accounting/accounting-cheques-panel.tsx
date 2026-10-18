'use client';

import { useEffect, useMemo, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { domainStatusLabel } from '@/lib/ui-labels';

type ChequeRow = {
  id: string;
  chequeNumber: string;
  bankName: string;
  amountMinor: string;
  currency: string;
  dueOn: string;
  reviewStatus: string;
  leaseId: string | null;
  tenantName: string | null;
  propertyName: string | null;
  unitCode: string | null;
};

type Filter = 'all' | 'pending' | 'accepted' | 'deposited' | 'cleared' | 'bounced' | 'overdue';

/** Tenant cheques register: status, due dates, and CSV import. */
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
        const payload = (await response.json()) as { cheques?: ChequeRow[] };
        setRows(payload.cheques ?? []);
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
          row.dueOn < today &&
          row.reviewStatus !== 'cleared' &&
          row.reviewStatus !== 'cancelled' &&
          row.reviewStatus !== 'bounced'
        );
      }
      return row.reviewStatus === filter;
    });
  }, [rows, filter, today]);

  const filters: Array<[Filter, string]> = [
    ['all', ar ? 'الكل' : 'All'],
    ['overdue', ar ? 'متأخرة' : 'Overdue'],
    ['pending', ar ? 'بانتظار' : 'Pending'],
    ['accepted', ar ? 'مقبولة' : 'Accepted'],
    ['deposited', ar ? 'مودعة' : 'Deposited'],
    ['cleared', ar ? 'محصّلة' : 'Cleared'],
    ['bounced', ar ? 'مرتجعة' : 'Bounced'],
  ];

  return (
    <div className="accounting-hub__panel">
      <div className="accounting-hub__toolbar">
        <div>
          <h2>{ar ? 'شيكات المستأجرين' : 'Tenant cheques'}</h2>
          <p className="accounting-hub__hint">
            {ar
              ? 'كل الشيكات المسجّلة على العقود مع حالتها وتاريخ الاستحقاق. يمكن استيراد ملف CSV.'
              : 'All cheques on leases with status and due date. Import a CSV file when needed.'}
          </p>
        </div>
      </div>

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
              <th>{ar ? 'رقم الشيك' : 'Cheque No.'}</th>
              <th>{ar ? 'المستأجر' : 'Tenant'}</th>
              <th>{ar ? 'المبنى / الوحدة' : 'Property / unit'}</th>
              <th>{ar ? 'البنك' : 'Bank'}</th>
              <th>{ar ? 'الاستحقاق' : 'Due'}</th>
              <th>{ar ? 'الحالة' : 'Status'}</th>
              <th className="num">{ar ? 'المبلغ' : 'Amount'}</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr>
                <td colSpan={7}>{ar ? 'جارٍ التحميل…' : 'Loading…'}</td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  {ar
                    ? 'لا شيكات بعد — استورد ملفاً أو سجّل عقد إيجار بجداول شيكات.'
                    : 'No cheques yet — import a file or register a lease with a cheque schedule.'}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id}>
                  <td dir="ltr">{row.chequeNumber}</td>
                  <td>
                    <bdi>{row.tenantName || '—'}</bdi>
                  </td>
                  <td>
                    {[row.propertyName, row.unitCode].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td>{row.bankName}</td>
                  <td dir="ltr">{row.dueOn}</td>
                  <td>{domainStatusLabel(row.reviewStatus, locale)}</td>
                  <td className="num">
                    {formatMoney(row.amountMinor, row.currency || 'OMR', locale)}
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
