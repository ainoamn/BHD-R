'use client';

import { useState } from 'react';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  CLAIM_MESSAGE_MAX,
  CLAIM_NOTE_MIN,
  claimKindLabel,
  claimStatusLabel,
  claimStatusTone,
  type DepositClaimView,
} from '@/lib/stay-deposit-claims';

const THREE_DECIMALS = new Set(['OMR', 'BHD', 'KWD', 'JOD']);

function minorToDecimal(value: string | null, currency: string): string {
  if (!value || !/^\d+$/.test(value)) return '';
  const digits = THREE_DECIMALS.has(currency) ? 3 : 2;
  const padded = value.padStart(digits + 1, '0');
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

function stamp(value: string, ar: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

/**
 * The guest's deposit requests and objections on one stay, for the host to accept or decline.
 * Accepting a missing transfer sends it back to the accountant; accepting a deduction objection
 * adds the agreed amount to the refund.
 */
export function DepositClaimsAdmin({
  claims,
  currency,
  canDecide,
  locale,
  onDone,
}: {
  claims: DepositClaimView[];
  currency: string;
  canDecide: boolean;
  locale: 'ar' | 'en';
  onDone: (notice: { tone: 'success' | 'error'; text: string }, reload: boolean) => void;
}) {
  const ar = locale === 'ar';
  const money = (minor: string) => formatMoney(minor, currency, locale);
  const [answering, setAnswering] = useState<{ id: string; decision: 'accept' | 'reject' } | null>(
    null,
  );
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  if (!claims.length) return null;

  async function submit(claim: DepositClaimView, decision: 'accept' | 'reject') {
    setTried(true);
    if (note.trim().length < CLAIM_NOTE_MIN) return;
    setBusy(true);
    try {
      await browserNextMutation(
        `/api/owner/accounting/deposit-claims/${encodeURIComponent(claim.id)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            note: note.trim(),
            ...(decision === 'accept' && claim.kind !== 'not_received' && amount.trim()
              ? { amount: amount.trim() }
              : {}),
          }),
        },
      );
      setAnswering(null);
      onDone(
        {
          tone: 'success',
          text:
            decision === 'reject'
              ? ar
                ? 'سُجّل رفضك للطلب وأُبلغ الضيف بردك.'
                : 'The request was declined and the guest told.'
              : claim.kind === 'not_received'
                ? ar
                  ? 'قُبل البلاغ: أُعيد التحويل للمحاسب ليحوّله من جديد، وأُبلغ الضيف.'
                  : 'Accepted: the transfer is back with the accountant to send again.'
                : ar
                  ? 'قُبل الطلب: أُضيف المبلغ لاسترداد الضيف وهو الآن لدى المحاسب للتحويل.'
                  : 'Accepted: the amount was added to the refund for the accountant to transfer.',
        },
        true,
      );
    } catch (error) {
      const code = error instanceof ApiError ? error.code : null;
      onDone(
        {
          tone: 'error',
          text:
            error instanceof ApiError && error.message
              ? error.message
              : ar
                ? 'تعذّر حفظ الرد. حاول مجدداً.'
                : 'Could not save the answer.',
        },
        code === 'claim_closed',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deposit-claims-admin">
      <strong className="deposit-claims-admin__title">
        {ar ? 'طلبات التأمين أو الاعتراضات من الضيف' : 'Guest deposit requests and objections'}
      </strong>
      <ul className="deposit-claims-admin__list">
        {[...claims].reverse().map((claim) => {
          const open = answering?.id === claim.id;
          return (
            <li key={claim.id} className="deposit-claims-admin__item">
              <div className="deposit-claims-admin__head">
                <span>
                  {claimKindLabel(claim.kind, ar)}
                  {claim.amountMinor ? (
                    <>
                      {' · '}
                      <bdi dir="ltr">{money(claim.amountMinor)}</bdi>
                    </>
                  ) : null}
                </span>
                <span className={`pmh-badge pmh-badge--${claimStatusTone(claim.status)}`}>
                  {claimStatusLabel(claim.status, ar)}
                </span>
              </div>
              <small className="muted">{stamp(claim.createdAt, ar)}</small>
              <p className="deposit-claims-admin__message">{claim.message}</p>
              {claim.response ? (
                <small className="deposit-claims-admin__reply">
                  {claim.response.decision === 'accepted'
                    ? ar
                      ? 'قُبل'
                      : 'Accepted'
                    : ar
                      ? 'رُفض'
                      : 'Declined'}
                  {claim.response.by ? ` · ${claim.response.by}` : ''}
                  {claim.response.amountMinor ? ` · ${money(claim.response.amountMinor)}` : ''}
                  {claim.response.note ? `: ${claim.response.note}` : ''}
                </small>
              ) : null}
              {claim.escalation ? (
                <small className="deposit-claims-admin__reply is-escalated">
                  {ar ? 'شكوى لإدارة الموقع' : 'Complaint to the site administration'} ·{' '}
                  {stamp(claim.escalation.at, ar)}
                  {claim.escalation.message ? `: ${claim.escalation.message}` : ''}
                </small>
              ) : null}
              {claim.resolution ? (
                <small className="deposit-claims-admin__reply is-resolved">
                  {claim.resolution.outcome === 'guest'
                    ? ar
                      ? 'قرار الإدارة لصالح الضيف'
                      : 'Decided for the guest'
                    : ar
                      ? 'قرار الإدارة لصالح المالك'
                      : 'Decided for the host'}
                  {claim.resolution.amountMinor ? ` · ${money(claim.resolution.amountMinor)}` : ''}
                  {claim.resolution.note ? `: ${claim.resolution.note}` : ''}
                </small>
              ) : null}
              {claim.status === 'open' && canDecide ? (
                open ? (
                  <form
                    className="deposit-claims-admin__form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submit(claim, answering.decision);
                    }}
                  >
                    {answering.decision === 'accept' && claim.kind !== 'not_received' ? (
                      <label className="field">
                        <span>
                          {ar
                            ? 'المبلغ الذي يُضاف لاسترداد الضيف (اتركه فارغاً بلا مبلغ)'
                            : 'Amount added to the refund (leave empty for none)'}
                        </span>
                        <input
                          inputMode="decimal"
                          dir="ltr"
                          value={amount}
                          onChange={(event) => setAmount(event.target.value)}
                        />
                      </label>
                    ) : null}
                    {answering.decision === 'accept' && claim.kind === 'not_received' ? (
                      <small className="muted">
                        {ar
                          ? 'بالقبول يُلغى التحويل الأخير ويعود للمحاسب ليحوّل المبلغ من جديد.'
                          : 'Accepting voids the last transfer; the accountant sends it again.'}
                      </small>
                    ) : null}
                    <label className="field">
                      <span>{ar ? 'ردّك (يظهر للضيف)' : 'Your answer (shown to the guest)'}</span>
                      <textarea
                        rows={3}
                        maxLength={CLAIM_MESSAGE_MAX}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        aria-invalid={tried && note.trim().length < CLAIM_NOTE_MIN}
                      />
                    </label>
                    {tried && note.trim().length < CLAIM_NOTE_MIN ? (
                      <small className="field-error" role="alert">
                        {ar ? 'اكتب ردّك على الطلب.' : 'Write your answer.'}
                      </small>
                    ) : null}
                    <div className="deposit-claims-admin__actions">
                      <button type="submit" className="button button--primary" disabled={busy}>
                        {answering.decision === 'accept'
                          ? ar
                            ? 'تأكيد القبول'
                            : 'Confirm accept'
                          : ar
                            ? 'تأكيد الرفض'
                            : 'Confirm decline'}
                      </button>
                      <button
                        type="button"
                        className="button button--quiet"
                        disabled={busy}
                        onClick={() => setAnswering(null)}
                      >
                        {ar ? 'إلغاء' : 'Cancel'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="deposit-claims-admin__actions">
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => {
                        setNote('');
                        setTried(false);
                        setAmount(minorToDecimal(claim.amountMinor, currency));
                        setAnswering({ id: claim.id, decision: 'accept' });
                      }}
                    >
                      {ar ? 'قبول' : 'Accept'}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => {
                        setNote('');
                        setTried(false);
                        setAnswering({ id: claim.id, decision: 'reject' });
                      }}
                    >
                      {ar ? 'رفض' : 'Decline'}
                    </button>
                  </div>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
