'use client';

import { useEffect, useState } from 'react';
import {
  AccountingWorkspace,
} from '@/components/accounting/accounting-workspace';
import {
  fetchAccountingJson,
  getAccountingCache,
} from '@/lib/accounting-client-cache';
import { accountingIntegrityGapKindLabel } from '@/lib/accounting-i18n';
import { formatMoney } from '@/lib/format';
import type { IntegrityBoardPayload } from '@/lib/accounting-integrity-board';

export function AccountingIntegrityPanel({
  locale,
  active,
}: {
  locale: 'ar' | 'en';
  active: boolean;
}) {
  const ar = locale === 'ar';
  const [board, setBoard] = useState<IntegrityBoardPayload | null>(() =>
    getAccountingCache<IntegrityBoardPayload>('/api/owner/accounting/integrity'),
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active && board !== null) return;
    const cached = getAccountingCache<IntegrityBoardPayload>('/api/owner/accounting/integrity');
    if (cached && board === null) setBoard(cached);
    const controller = new AbortController();
    void (async () => {
      try {
        const payload = await fetchAccountingJson<IntegrityBoardPayload>(
          '/api/owner/accounting/integrity',
          { preferCache: board !== null, signal: controller.signal },
        );
        setBoard(payload);
        setFailed(false);
      } catch {
        if (!controller.signal.aborted && board === null) setFailed(true);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keep last board; refetch when tab opens
  }, [active]);

  const summary = board?.summary;
  const gaps = board?.gaps ?? [];

  return (
    <AccountingWorkspace
      title={ar ? 'سلامة الدفتر والمطابقة' : 'Ledger integrity & recon'}
      hint={
        ar
          ? 'فجوات الترحيل وفرق ذمم المستأجر مقابل حساب 1200 — مصدر الحقيقة هو القيود المرحّلة فقط.'
          : 'Posting gaps and tenant AR vs account 1200 — posted journals are the only source of truth.'
      }
      {...(summary
        ? {
            metrics: [
              {
                key: 'pay',
                label: ar ? 'دفعات بلا قيد' : 'Payments unposted',
                value: String(summary.paymentUnposted),
                tone: 'expense' as const,
                icon: '!',
              },
              {
                key: 'chq',
                label: ar ? 'شيكات بلا تحصيل' : 'Cheques unposted',
                value: String(summary.chequeUnposted),
                tone: 'cash' as const,
                icon: '⌬',
              },
              {
                key: 'ar',
                label: ar ? 'فروق ذمم' : 'AR variances',
                value: String(summary.arVariance),
                tone: 'profit' as const,
                icon: 'Σ',
              },
              {
                key: 'draft',
                label: ar ? 'مسودات غير متوازنة' : 'Unbalanced drafts',
                value: String(summary.draftUnbalanced),
                tone: 'revenue' as const,
                icon: '✎',
              },
            ],
          }
        : {})}
    >
      {failed ? (
        <p className="fin-dash__empty">
          {ar ? 'تعذر تحميل لوحة السلامة.' : 'Could not load the integrity board.'}
        </p>
      ) : !board ? (
        <p className="fin-dash__empty">{ar ? 'جاري التحميل…' : 'Loading…'}</p>
      ) : gaps.length === 0 ? (
        <p className="fin-dash__empty">
          {ar
            ? 'لا فجوات ظاهرة — الدفعات والشيكات المحصّلة والذمم متوافقة مع الدفتر.'
            : 'No gaps found — payments, cleared cheques, and AR align with the ledger.'}
        </p>
      ) : (
        <div className="accounting-hub__table-wrap">
          <table className="accounting-hub__table">
            <thead>
              <tr>
                <th>{ar ? 'النوع' : 'Kind'}</th>
                <th>{ar ? 'البيان' : 'Detail'}</th>
                <th>{ar ? 'المرجع' : 'Ref'}</th>
                <th className="num">{ar ? 'المبلغ / الفرق' : 'Amount / variance'}</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((gap) => (
                <tr key={gap.id}>
                  <td>
                    <span className={`accounting-hub__chip accounting-hub__chip--${gap.kind}`}>
                      {accountingIntegrityGapKindLabel(gap.kind, locale)}
                    </span>
                  </td>
                  <td>{ar ? gap.labelAr : gap.labelEn}</td>
                  <td dir="ltr">{gap.ref}</td>
                  <td className="num">
                    {gap.amountMinor
                      ? formatMoney(gap.amountMinor, gap.currency, locale)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AccountingWorkspace>
  );
}
