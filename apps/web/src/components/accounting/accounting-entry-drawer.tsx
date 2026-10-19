'use client';

import { useEffect, useState } from 'react';
import {
  accountingDisplayText,
  accountingJournalStatusLabel,
  accountingSourceTypeLabel,
} from '@/lib/accounting-i18n';
import { AccountingRecordActions } from '@/components/accounting/accounting-record-actions';
import { ApiError, browserNextMutation } from '@/lib/api';
import {
  accountingMailtoShare,
  accountingWhatsappShare,
  printAccountingJournal,
} from '@/lib/accounting-print';
import { formatMoney } from '@/lib/format';

type JournalDetail = {
  id: string;
  reference: string;
  occurredOn: string;
  description: string;
  status: string;
  sourceType: string | null;
  sourceId: string | null;
  postedAt: string | null;
  createdAt: string;
  totals: { debitMinor: string; creditMinor: string };
  partyEmail?: string | null;
  partyPhone?: string | null;
  partyName?: string | null;
  lines: Array<{
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    debitMinor: string;
    creditMinor: string;
    currency: string;
    memo: string | null;
    partyName: string | null;
    propertyNameAr: string | null;
    unitCode: string | null;
  }>;
  trail: Array<{
    id: string;
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    note: string | null;
    occurredAt: string;
  }>;
};

function money(minor: string, currency: string, ar: boolean) {
  if (!minor || minor === '0') return '—';
  return formatMoney(minor, currency, ar ? 'ar' : 'en');
}

const EVENT_LABEL: Record<string, { ar: string; en: string }> = {
  'journal.created': { ar: 'إنشاء مسودة', en: 'Draft created' },
  'journal.posted': { ar: 'ترحيل القيد', en: 'Posted' },
  'journal.reversed': { ar: 'عكس القيد', en: 'Reversed' },
};

export function AccountingEntryDrawer({
  journalId,
  locale,
  onClose,
  onPost,
  onReverse,
  onChanged,
  canPost,
  busy,
}: {
  journalId: string | null;
  locale: 'ar' | 'en';
  onClose: () => void;
  onPost?: (id: string) => void;
  onReverse?: (id: string) => void;
  onChanged?: () => void;
  canPost: boolean;
  busy: boolean;
}) {
  const ar = locale === 'ar';
  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!journalId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/owner/accounting/journals/${encodeURIComponent(journalId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
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
        return response.json() as Promise<{ journal: JournalDetail }>;
      })
      .then((data) => {
        if (!cancelled) setDetail(data.journal);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : ar ? 'تعذر التحميل' : 'Load failed');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ar, journalId]);

  if (!journalId) return null;

  return (
    <div className="accounting-drawer" role="dialog" aria-modal="true" aria-labelledby="gl-drawer-title">
      <button type="button" className="accounting-drawer__backdrop" aria-label="Close" onClick={onClose} />
      <aside className="accounting-drawer__panel">
        <header className="accounting-drawer__head">
          <div>
            <p className="accounting-drawer__eyebrow">{ar ? 'تفاصيل المعاملة' : 'Transaction detail'}</p>
            <h2 id="gl-drawer-title">{detail?.reference ?? '…'}</h2>
          </div>
          <button type="button" className="button button--quiet button--sm" onClick={onClose}>
            {ar ? 'إغلاق' : 'Close'}
          </button>
        </header>

        {loading ? <p className="accounting-hub__muted">{ar ? 'جاري التحميل…' : 'Loading…'}</p> : null}
        {error ? <p className="accounting-hub__error">{error}</p> : null}

        {detail ? (
          <>
            <div className="accounting-drawer__meta">
              <div>
                <span>{ar ? 'التاريخ' : 'Date'}</span>
                <strong>{detail.occurredOn}</strong>
              </div>
              <div>
                <span>{ar ? 'الحالة' : 'Status'}</span>
                <strong className={`accounting-hub__status accounting-hub__status--${detail.status}`}>
                  {accountingJournalStatusLabel(detail.status, locale)}
                </strong>
              </div>
              <div>
                <span>{ar ? 'المصدر' : 'Source'}</span>
                <strong>{accountingSourceTypeLabel(detail.sourceType, locale)}</strong>
              </div>
              <div>
                <span>{ar ? 'الإجمالي' : 'Total'}</span>
                <strong>{money(detail.totals.debitMinor, 'OMR', ar)}</strong>
              </div>
            </div>

            <p className="accounting-drawer__desc">
              {accountingDisplayText(detail.description, locale)}
            </p>

            <h3>{ar ? 'أسطر القيد' : 'Journal lines'}</h3>
            <div className="accounting-hub__table-wrap">
              <table className="accounting-hub__table">
                <thead>
                  <tr>
                    <th>{ar ? 'الحساب' : 'Account'}</th>
                    <th>{ar ? 'البُعد' : 'Dimension'}</th>
                    <th>{ar ? 'البيان' : 'Memo'}</th>
                    <th className="num">{ar ? 'مدين' : 'Debit'}</th>
                    <th className="num">{ar ? 'دائن' : 'Credit'}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        {line.code} · {ar ? line.nameAr : line.nameEn}
                      </td>
                      <td>
                        {[line.partyName, line.propertyNameAr, line.unitCode]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </td>
                      <td>{accountingDisplayText(line.memo, locale)}</td>
                      <td className="num">
                        {line.debitMinor !== '0' ? money(line.debitMinor, line.currency, ar) : '—'}
                      </td>
                      <td className="num">
                        {line.creditMinor !== '0' ? money(line.creditMinor, line.currency, ar) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3>{ar ? 'سجل التتبع' : 'Audit trail'}</h3>
            {detail.trail.length ? (
              <ol className="accounting-drawer__trail">
                {detail.trail.map((event) => (
                  <li key={event.id}>
                    <strong>
                      {EVENT_LABEL[event.eventType]
                        ? ar
                          ? EVENT_LABEL[event.eventType]!.ar
                          : EVENT_LABEL[event.eventType]!.en
                        : event.eventType}
                    </strong>
                    <span>{new Date(event.occurredAt).toLocaleString(ar ? 'ar-OM' : 'en-GB')}</span>
                    {event.note ? <em>{event.note}</em> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="accounting-hub__muted">{ar ? 'لا أحداث مسجّلة بعد' : 'No events yet'}</p>
            )}

            <div className="accounting-hub__actions">
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  void printAccountingJournal(detail, locale).then((failed) => {
                    if (failed) setError(failed);
                  });
                }}
              >
                {ar ? '⬇ طباعة / PDF بترويسة' : '⬇ Print / letterhead PDF'}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={sending}
                onClick={() => {
                  void (async () => {
                    setSending(true);
                    setSendNotice(null);
                    try {
                      const result = await browserNextMutation<{
                        emailed: number;
                        whatsappUrl: string | null;
                      }>('/api/owner/accounting/send', {
                        method: 'POST',
                        body: JSON.stringify({
                          kind: 'journal',
                          id: detail.id,
                          channel: 'both',
                          locale,
                          ...(detail.partyEmail ? { email: detail.partyEmail } : {}),
                          ...(detail.partyPhone ? { phone: detail.partyPhone } : {}),
                        }),
                      });
                      if (result.whatsappUrl) {
                        window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer');
                      }
                      setSendNotice(
                        ar
                          ? result.emailed
                            ? `أُرسل بالبريد (${result.emailed}) وفُتح واتساب`
                            : 'فُتح واتساب — لا بريد للمستلم'
                          : result.emailed
                            ? `Emailed (${result.emailed}) and opened WhatsApp`
                            : 'Opened WhatsApp — no recipient email',
                      );
                    } catch (err) {
                      setError(
                        err instanceof ApiError
                          ? err.message
                          : ar
                            ? 'تعذر الإرسال'
                            : 'Send failed',
                      );
                    } finally {
                      setSending(false);
                    }
                  })();
                }}
              >
                {ar ? 'بريد + واتساب' : 'Email + WhatsApp'}
              </button>
              <a
                className="button button--quiet"
                href={accountingWhatsappShare({
                  ...(detail.partyPhone ? { phone: detail.partyPhone } : {}),
                  title: ar ? 'قيد يومية' : 'Journal entry',
                  reference: detail.reference,
                  amountText: money(detail.totals.debitMinor, 'OMR', ar),
                  occurredOn: detail.occurredOn,
                  locale,
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ar ? 'واتساب' : 'WhatsApp'}
              </a>
              <a
                className="button button--quiet"
                href={accountingMailtoShare({
                  ...(detail.partyEmail ? { email: detail.partyEmail } : {}),
                  title: ar ? 'قيد يومية' : 'Journal entry',
                  reference: detail.reference,
                  body: `${detail.description}\n${money(detail.totals.debitMinor, 'OMR', ar)}`,
                })}
              >
                {ar ? 'بريد' : 'Email'}
              </a>
              {detail.status === 'draft' && canPost && onPost ? (
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => onPost(detail.id)}
                >
                  {ar ? 'ترحيل القيد' : 'Post entry'}
                </button>
              ) : null}
              {detail ? (
                <AccountingRecordActions
                  locale={locale}
                  kind="journal"
                  id={detail.id}
                  status={detail.status}
                  sourceType={detail.sourceType}
                  disabled={busy}
                  onDone={() => onChanged?.()}
                  onError={(message) => setError(message)}
                />
              ) : null}
              {detail.status === 'posted' && canPost && onReverse ? (
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy}
                  onClick={() => onReverse(detail.id)}
                >
                  {ar ? 'عكس القيد' : 'Reverse'}
                </button>
              ) : null}
            </div>
            {sendNotice ? <p className="accounting-hub__muted">{sendNotice}</p> : null}
          </>
        ) : null}
      </aside>
    </div>
  );
}
