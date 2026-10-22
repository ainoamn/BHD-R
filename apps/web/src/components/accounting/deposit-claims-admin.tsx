'use client';

import { useEffect, useRef, useState } from 'react';
import { NoteTranslateBar } from '@/components/note-translate';
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
 * Guest deposit requests on one stay. For «transfer not received», the accountant verifies the
 * payout then either voids it for a re-transfer or declines the report — always with a note.
 */
export function DepositClaimsAdmin({
  claims,
  currency,
  canDecide,
  locale,
  preferOpen = false,
  onDone,
}: {
  claims: DepositClaimView[];
  currency: string;
  canDecide: boolean;
  locale: 'ar' | 'en';
  /** When deep-linked from approvals, open the first actionable claim form. */
  preferOpen?: boolean;
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
  const autoOpened = useRef(false);

  useEffect(() => {
    if (!preferOpen || autoOpened.current || !canDecide) return;
    const first = [...claims].reverse().find((claim) => claim.status === 'open');
    if (!first) return;
    autoOpened.current = true;
    setNote('');
    setTried(false);
    setAmount(minorToDecimal(first.amountMinor, currency));
    setAnswering({ id: first.id, decision: 'accept' });
  }, [preferOpen, claims, canDecide, currency]);

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
                ? 'سُجّل رفض البلاغ وأُبلغ الضيف بردك.'
                : 'The report was declined and the guest told.'
              : claim.kind === 'not_received'
                ? ar
                  ? 'تأكيد عدم الوصول: أُلغي التحويل الأخير وعاد للمحاسب ليحوّل المبلغ من جديد، وأُبلغ الضيف.'
                  : 'Confirmed: last transfer voided; accountant will send again. Guest notified.'
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
        {ar ? 'بلاغات الضيف عن التأمين' : 'Guest deposit reports'}
      </strong>
      <ul className="deposit-claims-admin__list">
        {[...claims].reverse().map((claim) => {
          const open = answering?.id === claim.id;
          const notReceived = claim.kind === 'not_received';
          return (
            <li
              key={claim.id}
              className={`deposit-claims-admin__item${
                claim.status === 'open' && notReceived ? ' is-urgent' : ''
              }`}
            >
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

              {claim.status === 'open' && notReceived ? (
                <div className="deposit-claims-admin__procedure" role="note">
                  <p>
                    {ar
                      ? 'هذا بلاغ للمحاسب (وليس اعتماد عقد). تحقق من إيصال التحويل والمعاملة ثم اختر:'
                      : 'This is an accountant follow-up (not a contract approval). Verify the transfer slip, then choose:'}
                  </p>
                  <ol>
                    <li>
                      {ar
                        ? '«تأكيد عدم الوصول» — يُلغى التحويل الأخير ويعود للمحاسب لتحويل المبلغ مجدداً بعد كتابة ملاحظة.'
                        : '“Confirm not received” — voids the last transfer so accounting can send again, after your note.'}
                    </li>
                    <li>
                      {ar
                        ? '«المبلغ وصل — رفض البلاغ» — إن تبيّن أن الضيف استلم المبلغ؛ اكتب ملاحظة توضّح ذلك.'
                        : '“Amount arrived — decline report” — if the guest did receive it; write a clarifying note.'}
                    </li>
                  </ol>
                </div>
              ) : null}

              {claim.response ? (
                <small className="deposit-claims-admin__reply">
                  {claim.response.decision === 'accepted'
                    ? ar
                      ? notReceived
                        ? 'تأكيد عدم الوصول — أُعيد للمحاسب'
                        : 'قُبل'
                      : notReceived
                        ? 'Confirmed not received — back to accountant'
                        : 'Accepted'
                    : ar
                      ? 'رُفض البلاغ'
                      : 'Report declined'}
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
                    <p className="deposit-claims-admin__choice" role="status">
                      {answering.decision === 'accept'
                        ? notReceived
                          ? ar
                            ? 'الإجراء: تأكيد عدم الوصول → إلغاء التحويل الأخير وإعادته للمحاسب مع ملاحظتك.'
                            : 'Action: confirm not received → void last transfer for the accountant, with your note.'
                          : ar
                            ? 'الإجراء: قبول الطلب وإضافة المبلغ لاسترداد الضيف إن لزم.'
                            : 'Action: accept the request and add an amount to the refund if needed.'
                        : ar
                          ? 'الإجراء: رفض البلاغ بعد التحقق — توضّح للضيف في الملاحظة لماذا.'
                          : 'Action: decline the report after verification — explain why in the note.'}
                    </p>
                    {answering.decision === 'accept' && !notReceived ? (
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
                    <label className="field">
                      <span>
                        {ar
                          ? 'ملاحظة المحاسب / المالك (تظهر للضيف)'
                          : 'Accountant / host note (shown to the guest)'}
                      </span>
                      <textarea
                        rows={3}
                        maxLength={CLAIM_MESSAGE_MAX}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        aria-invalid={tried && note.trim().length < CLAIM_NOTE_MIN}
                        placeholder={
                          ar
                            ? notReceived
                              ? answering.decision === 'accept'
                                ? 'مثال: راجعنا التحويل ولم يُقيَّد — سنعيد التحويل خلال يوم عمل.'
                                : 'مثال: التحويل ظهر في كشف البنك بتاريخ … برقم مرجعي …'
                              : 'اكتب ردّك على الطلب.'
                            : notReceived
                              ? answering.decision === 'accept'
                                ? 'e.g. Transfer not credited — we will resend within one business day.'
                                : 'e.g. Bank statement shows the credit on … ref …'
                              : 'Write your answer.'
                        }
                      />
                    </label>
                    <NoteTranslateBar
                      value={note}
                      onChange={setNote}
                      locale={locale}
                      max={CLAIM_MESSAGE_MAX}
                      disabled={busy}
                    />
                    {tried && note.trim().length < CLAIM_NOTE_MIN ? (
                      <small className="field-error" role="alert">
                        {ar ? 'اكتب ملاحظة التحقق قبل التأكيد.' : 'Write a verification note before confirming.'}
                      </small>
                    ) : null}
                    <div className="deposit-claims-admin__actions">
                      <button type="submit" className="button button--primary" disabled={busy}>
                        {answering.decision === 'accept'
                          ? notReceived
                            ? ar
                              ? 'تأكيد: لم يصل — أعد للمحاسب'
                              : 'Confirm: not received — return to accountant'
                            : ar
                              ? 'تأكيد القبول'
                              : 'Confirm accept'
                          : ar
                            ? 'تأكيد رفض البلاغ'
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
                      {notReceived
                        ? ar
                          ? 'تأكيد: لم يصل — أعد للمحاسب'
                          : 'Confirm: not received — return to accountant'
                        : ar
                          ? 'قبول'
                          : 'Accept'}
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
                      {notReceived
                        ? ar
                          ? 'المبلغ وصل — رفض البلاغ'
                          : 'Amount arrived — decline report'
                        : ar
                          ? 'رفض'
                          : 'Decline'}
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
