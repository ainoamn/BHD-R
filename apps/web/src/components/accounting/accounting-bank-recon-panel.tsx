'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccountingTrustConfirm } from '@/components/accounting/accounting-trust-confirm';
import { AccountingWorkspaceSection } from '@/components/accounting/accounting-workspace';
import {
  fetchAccountingJson,
  getAccountingCache,
  invalidateAccountingCache,
} from '@/lib/accounting-client-cache';
import { browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';

type OpenLine = {
  id: string;
  occurredOn: string;
  reference: string;
  description: string;
  debitMinor: string;
  creditMinor: string;
  memo: string | null;
};

type Payload = {
  sessions?: Array<{
    id: string;
    statementOn: string;
    statementBalanceMinor: string;
    status: string;
    currency: string;
  }>;
  open?: {
    bookBalanceMinor?: string;
    account?: { code: string; nameAr: string; nameEn: string } | null;
    lines?: OpenLine[];
  };
};

/** Bank reconciliation: match statement balance to uncleared bank GL lines (account 1100). */
export function BankReconPanel({
  locale,
  canManage,
  active,
}: {
  locale: 'ar' | 'en';
  canManage: boolean;
  active: boolean;
}) {
  const ar = locale === 'ar';
  const trust = useAccountingTrustConfirm(locale);
  const [data, setData] = useState<Payload | null>(() =>
    getAccountingCache<Payload>('/api/owner/accounting/bank-recon'),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statementOn, setStatementOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [statementBalance, setStatementBalance] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!active && data !== null) return;
    const cached = getAccountingCache<Payload>('/api/owner/accounting/bank-recon');
    if (cached && data === null) setData(cached);
    const controller = new AbortController();
    void (async () => {
      try {
        const payload = await fetchAccountingJson<Payload>('/api/owner/accounting/bank-recon', {
          preferCache: data !== null && !busy,
          signal: controller.signal,
        });
        setData(payload);
      } catch {
        if (!controller.signal.aborted && data === null) {
          setData({ sessions: [], open: { lines: [] } });
        }
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on tab open / after mutation
  }, [active, busy]);

  const lines = data?.open?.lines ?? [];
  const book = data?.open?.bookBalanceMinor ?? '0';
  const selectedDebit = useMemo(() => {
    let sum = 0n;
    for (const line of lines) {
      if (!selected.has(line.id)) continue;
      sum += BigInt(line.debitMinor || '0') - BigInt(line.creditMinor || '0');
    }
    return sum;
  }, [lines, selected]);
  const statement = /^-?\d+$/.test(statementBalance) ? BigInt(statementBalance) : null;
  const variance =
    statement === null ? null : statement - BigInt(book || '0') - selectedDebit;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {trust.gate}
      <AccountingWorkspaceSection
        title={ar ? 'مطابقة كشف البنك' : 'Bank reconciliation'}
        hint={
          ar
            ? 'طابق رصيد كشف البنك مع حركات حساب البنوك (1100) غير المطابقة — معيار إقفال شهري.'
            : 'Match the bank statement to uncleared bank (1100) lines — monthly close standard.'
        }
      >
        <div className="fin-dash__secondary fin-dash__secondary--3">
          <div className="fin-dash__stat">
            <span>{ar ? 'رصيد الدفتر' : 'Book balance'}</span>
            <strong>{formatMoney(book, 'OMR', locale)}</strong>
          </div>
          <div className="fin-dash__stat">
            <span>{ar ? 'حركات غير مطابقة' : 'Open lines'}</span>
            <strong>{lines.length}</strong>
          </div>
          <div className="fin-dash__stat">
            <span>{ar ? 'مختارة' : 'Selected'}</span>
            <strong>{selected.size}</strong>
          </div>
        </div>
        {data?.open?.account ? (
          <p className="accounting-hub__meta">
            {ar ? data.open.account.nameAr : data.open.account.nameEn} · {data.open.account.code}
          </p>
        ) : null}
        {notice ? <p className="accounting-hub__meta">{notice}</p> : null}
        <div className="accounting-hub__table-wrap">
          <table className="accounting-hub__table">
            <thead>
              <tr>
                <th />
                <th>{ar ? 'التاريخ' : 'Date'}</th>
                <th>{ar ? 'المرجع' : 'Ref'}</th>
                <th>{ar ? 'الوصف' : 'Description'}</th>
                <th className="num">{ar ? 'مدين' : 'Debit'}</th>
                <th className="num">{ar ? 'دائن' : 'Credit'}</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    {ar ? 'لا حركات غير مطابقة.' : 'No unreconciled bank lines.'}
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(line.id)}
                        onChange={() => toggle(line.id)}
                        disabled={!canManage}
                      />
                    </td>
                    <td dir="ltr">{line.occurredOn}</td>
                    <td dir="ltr">{line.reference}</td>
                    <td>{line.description}</td>
                    <td className="num">
                      {line.debitMinor !== '0'
                        ? formatMoney(line.debitMinor, 'OMR', locale)
                        : '—'}
                    </td>
                    <td className="num">
                      {line.creditMinor !== '0'
                        ? formatMoney(line.creditMinor, 'OMR', locale)
                        : '—'}
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
              if (!/^-?\d+$/.test(statementBalance) || selected.size === 0) {
                setNotice(
                  ar
                    ? 'حدد حركات وأدخل رصيد الكشف بوحدات صغرى.'
                    : 'Select lines and enter statement balance in minor units.',
                );
                return;
              }
              void (async () => {
                const ok = await trust.ask({
                  title: ar ? 'تأكيد مطابقة كشف البنك' : 'Confirm bank reconciliation',
                  rows: [
                    { label: ar ? 'تاريخ الكشف' : 'Statement date', value: statementOn },
                    {
                      label: ar ? 'رصيد الكشف' : 'Statement balance',
                      value: formatMoney(statementBalance, 'OMR', locale),
                    },
                    {
                      label: ar ? 'رصيد الدفتر' : 'Book balance',
                      value: formatMoney(book, 'OMR', locale),
                    },
                    {
                      label: ar ? 'حركات مطابقة' : 'Cleared lines',
                      value: String(selected.size),
                    },
                  ],
                  impact: ar
                    ? 'ستُعلَّم الحركات المختارة كمطابقة ويُقفل جلسة المطابقة في السجل.'
                    : 'Selected lines will be marked cleared and the reconciliation session locked.',
                  tone: 'success',
                  confirmLabel: ar ? 'تأكيد المطابقة' : 'Confirm reconciliation',
                });
                if (!ok) return;
                setBusy(true);
                setNotice(null);
                try {
                  await browserNextMutation('/api/owner/accounting/bank-recon', {
                    method: 'POST',
                    body: JSON.stringify({
                      statementOn,
                      statementBalanceMinor: statementBalance,
                      lineIds: [...selected],
                    }),
                  });
                  setSelected(new Set());
                  setStatementBalance('');
                  invalidateAccountingCache();
                  setNotice(ar ? 'تم إكمال المطابقة.' : 'Reconciliation completed.');
                } catch {
                  setNotice(ar ? 'تعذر إكمال المطابقة.' : 'Could not complete reconciliation.');
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <div className="accounting-hub__form-grid">
              <label>
                {ar ? 'تاريخ الكشف' : 'Statement date'}
                <input
                  type="date"
                  value={statementOn}
                  onChange={(event) => setStatementOn(event.target.value)}
                  required
                />
              </label>
              <label>
                {ar ? 'رصيد الكشف (وحدات صغرى)' : 'Statement balance (minor)'}
                <input
                  type="text"
                  inputMode="numeric"
                  value={statementBalance}
                  onChange={(event) =>
                    setStatementBalance(event.target.value.replace(/[^\d-]/g, ''))
                  }
                  required
                />
              </label>
            </div>
            {variance !== null ? (
              <p className="accounting-hub__meta">
                {ar ? 'الفرق بعد الاختيار' : 'Variance after selection'}:{' '}
                <strong>{formatMoney(variance.toString(), 'OMR', locale)}</strong>
              </p>
            ) : null}
            <button className="button button--primary" type="submit" disabled={busy}>
              {ar
                ? `إكمال المطابقة (${selected.size})`
                : `Complete reconciliation (${selected.size})`}
            </button>
          </form>
        ) : null}
        {data?.sessions && data.sessions.length ? (
          <p className="accounting-hub__meta">
            {ar ? 'آخر المطابقات:' : 'Recent sessions:'}{' '}
            {data.sessions
              .slice(0, 5)
              .map(
                (row) =>
                  `${row.statementOn} · ${formatMoney(row.statementBalanceMinor, row.currency, locale)}`,
              )
              .join(' · ')}
          </p>
        ) : null}
      </AccountingWorkspaceSection>
    </>
  );
}
