'use client';

import { useMemo, useState } from 'react';
import { browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { ledgerStatusLabel, type LedgerLineStatus } from '@/lib/tenant-ledger';

type Row = {
  id: string;
  chequeNumber: string;
  amountMinor: string;
  paidMinor?: string;
  currency: string;
  dueOn: string;
  reviewStatus: string;
  lineStatus?: string;
  tenantName: string | null;
  propertyName: string | null;
  unitCode: string | null;
};

type WindowStat = { amountMinor: string; count: number };

export type CollectionOutlook = {
  cheques: Row[];
  summary: {
    currency: string;
    windows: {
      today: WindowStat;
      week: WindowStat;
      month: WindowStat;
      year: WindowStat;
    };
  };
};

type Horizon = 'today' | 'week' | 'month' | 'year';

function plusDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function openRow(row: Row): boolean {
  return (
    row.lineStatus !== 'paid' &&
    row.reviewStatus !== 'cleared' &&
    row.reviewStatus !== 'cancelled' &&
    row.reviewStatus !== 'rejected'
  );
}

/** Clickable collection totals for today, 7 days, this month, and this year. */
export function AccountingCollectionBoard({
  locale,
  outlook,
  canManage,
  onChanged,
}: {
  locale: 'ar' | 'en';
  outlook: CollectionOutlook | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const ar = locale === 'ar';
  const [horizon, setHorizon] = useState<Horizon | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const currency = outlook?.summary.currency || 'OMR';
  const windows = outlook?.summary.windows;

  const rows = useMemo(() => {
    if (!horizon || !outlook) return [];
    const weekEnd = plusDays(today, 7);
    const monthStart = `${today.slice(0, 7)}-01`;
    const last = new Date(
      Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0),
    ).getUTCDate();
    const monthEnd = `${today.slice(0, 7)}-${String(last).padStart(2, '0')}`;
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const yearEnd = `${today.slice(0, 4)}-12-31`;
    return outlook.cheques.filter((row) => {
      if (!openRow(row)) return false;
      if (horizon === 'today') return row.dueOn === today;
      if (horizon === 'week') return row.dueOn >= today && row.dueOn <= weekEnd;
      if (horizon === 'month') return row.dueOn >= monthStart && row.dueOn <= monthEnd;
      return row.dueOn >= yearStart && row.dueOn <= yearEnd;
    });
  }, [horizon, outlook, today]);

  const cards: Array<{ id: Horizon; icon: string; label: string; stat?: WindowStat | undefined }> =
    [
      { id: 'today', icon: '📅', label: ar ? 'تحصيل اليوم' : 'Due today', stat: windows?.today },
      { id: 'week', icon: '🗓️', label: ar ? 'خلال ٧ أيام' : 'Next 7 days', stat: windows?.week },
      { id: 'month', icon: '📊', label: ar ? 'هذا الشهر' : 'This month', stat: windows?.month },
      { id: 'year', icon: '🏦', label: ar ? 'هذا العام' : 'This year', stat: windows?.year },
    ];

  return (
    <section
      className="accounting-collect"
      aria-label={ar ? 'التحصيل المتوقع' : 'Expected collections'}
    >
      <header>
        <h3>{ar ? 'المبالغ الواجبة التحصيل' : 'Amounts to collect'}</h3>
        <p>
          {ar
            ? 'اضغط البطاقة لعرض الأقساط والشيكات. بعد القبض أكّد الاستلام ليُغلق البند.'
            : 'Open a card to see the installments. Confirm receipt after the money is in.'}
        </p>
      </header>
      <div className="accounting-collect__cards">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`accounting-collect__card accounting-collect__card--${card.id}${horizon === card.id ? ' is-on' : ''}`}
            aria-pressed={horizon === card.id}
            onClick={() => setHorizon((current) => (current === card.id ? null : card.id))}
          >
            <span className="accounting-collect__icon" aria-hidden="true">
              {card.icon}
            </span>
            <span>{card.label}</span>
            <strong>{formatMoney(card.stat?.amountMinor ?? '0', currency, locale)}</strong>
            <small>{ar ? `${card.stat?.count ?? 0} بند` : `${card.stat?.count ?? 0} items`}</small>
          </button>
        ))}
      </div>
      {horizon ? (
        <div className="accounting-collect__detail">
          {notice ? <p className="accounting-hub__meta">{notice}</p> : null}
          {rows.length === 0 ? (
            <p className="accounting-hub__muted">
              {ar ? 'لا بنود مفتوحة في هذه الفترة.' : 'Nothing open in this window.'}
            </p>
          ) : (
            <ul>
              {rows.map((row) => {
                const uuid = /^[0-9a-f-]{36}$/i.test(row.id);
                return (
                  <li key={row.id}>
                    <div>
                      <strong>
                        <bdi>{row.tenantName || row.chequeNumber}</bdi>
                      </strong>
                      <small>
                        {[row.propertyName, row.unitCode].filter(Boolean).join(' · ') || '—'}
                        {' · '}
                        <bdi>{row.dueOn}</bdi>
                      </small>
                    </div>
                    <span
                      className={`accounting-hub__status accounting-hub__status--${row.lineStatus || row.reviewStatus}`}
                    >
                      {row.lineStatus
                        ? ledgerStatusLabel(row.lineStatus as LedgerLineStatus, ar)
                        : row.reviewStatus}
                    </span>
                    <bdi>{formatMoney(row.amountMinor, row.currency || currency, locale)}</bdi>
                    {canManage && uuid ? (
                      <button
                        type="button"
                        className="accounting-act accounting-act--send"
                        disabled={busyId === row.id}
                        onClick={() => {
                          setBusyId(row.id);
                          setNotice(null);
                          void (async () => {
                            try {
                              await browserNextMutation('/api/owner/accounting/cheques', {
                                method: 'POST',
                                body: JSON.stringify({ confirmId: row.id }),
                              });
                              setNotice(ar ? 'تم تأكيد استلام المبلغ.' : 'Receipt confirmed.');
                              onChanged();
                            } catch {
                              setNotice(ar ? 'تعذر تأكيد الاستلام.' : 'Could not confirm receipt.');
                            } finally {
                              setBusyId(null);
                            }
                          })();
                        }}
                      >
                        {ar ? 'تأكيد الاستلام' : 'Confirm receipt'}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
