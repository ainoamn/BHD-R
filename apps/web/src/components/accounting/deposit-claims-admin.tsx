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
  sortClaimsNewestFirst,
  type DepositClaimView,
} from '@/lib/stay-deposit-claims';

const THREE_DECIMALS = new Set(['OMR', 'BHD', 'KWD', 'JOD']);

type Decision = 'accept' | 'reject' | 'refer';

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
 * Guest deposit requests on one stay.
 * Owner/management on `open`: refer to accountant or reject.
 * Accountant on `with_accountant`: accept or reject and close.
 */
export function DepositClaimsAdmin({
  claims,
  currency,
  canRefer = false,
  canDecide = false,
  locale,
  preferOpen = false,
  onDone,
}: {
  claims: DepositClaimView[];
  currency: string;
  /** Owner/management may refer or reject while status is `open`. */
  canRefer?: boolean;
  /** Accountant may accept/reject while status is `with_accountant`. */
  canDecide?: boolean;
  locale: 'ar' | 'en';
  /** When deep-linked from approvals, open the first actionable claim form. */
  preferOpen?: boolean;
  onDone: (notice: { tone: 'success' | 'error'; text: string }, reload: boolean) => void;
}) {
  const ar = locale === 'ar';
  const money = (minor: string) => formatMoney(minor, currency, locale);
  const ordered = sortClaimsNewestFirst(claims);
  const [openId, setOpenId] = useState<string | null>(() => {
    const active = ordered.find(
      (claim) =>
        (claim.status === 'open' && canRefer) || (claim.status === 'with_accountant' && canDecide),
    );
    return active?.id ?? ordered[0]?.id ?? null;
  });
  const [answering, setAnswering] = useState<{ id: string; decision: Decision } | null>(null);
  const [note, setNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const autoOpened = useRef(false);

  useEffect(() => {
    if (!preferOpen || autoOpened.current) return;
    const first = ordered.find(
      (claim) =>
        (claim.status === 'open' && canRefer) || (claim.status === 'with_accountant' && canDecide),
    );
    if (!first) return;
    autoOpened.current = true;
    setOpenId(first.id);
    setNote('');
    setInternalNote('');
    setTried(false);
    setAmount(minorToDecimal(first.amountMinor, currency));
    setAnswering({
      id: first.id,
      decision: first.status === 'open' ? 'refer' : 'accept',
    });
  }, [preferOpen, ordered, canRefer, canDecide, currency]);

  if (!claims.length) return null;

  async function submit(claim: DepositClaimView, decision: Decision) {
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
            ...(internalNote.trim() ? { internalNote: internalNote.trim() } : {}),
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
            decision === 'refer'
              ? ar
                ? 'أُحيل الطلب للمحاسب، وأُبلغ الضيف.'
                : 'Referred to accounting; guest notified.'
              : decision === 'reject'
                ? ar
                  ? 'رُفض الطلب وأُغلق، وأُبلغ الضيف.'
                  : 'Request declined and closed; guest notified.'
                : claim.kind === 'not_received'
                  ? ar
                    ? 'تأكيد عدم الوصول: أُلغي التحويل الأخير وعاد للمحاسب ليحوّل مجدداً، وأُبلغ الضيف.'
                    : 'Confirmed: last transfer voided; accountant will send again. Guest notified.'
                  : ar
                    ? 'قُبل الطلب وأُغلق: أُضيف المبلغ لاسترداد الضيف إن لزم.'
                    : 'Accepted and closed: amount added to the refund if needed.',
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
    <div className="deposit-claims-admin" id="deposit-claims">
      <strong className="deposit-claims-admin__title">
        {ar ? 'طلبات واعتراضات التأمين' : 'Deposit requests and objections'}
      </strong>
      <ul className="deposit-claims-admin__list">
        {ordered.map((claim) => {
          const expanded = openId === claim.id;
          const formOpen = answering?.id === claim.id;
          const notReceived = claim.kind === 'not_received';
          const ownerAction = claim.status === 'open' && canRefer;
          const accountantAction = claim.status === 'with_accountant' && canDecide;
          return (
            <li
              key={claim.id}
              className={`deposit-claims-admin__item${
                (claim.status === 'open' || claim.status === 'with_accountant') && notReceived
                  ? ' is-urgent'
                  : ''
              }`}
            >
              <button
                type="button"
                className="deposit-claims-admin__summary"
                aria-expanded={expanded}
                onClick={() => setOpenId(expanded ? null : claim.id)}
              >
                <span className="deposit-claims-admin__summary-main">
                  <strong dir="ltr">{claim.referenceCode}</strong>
                  <span>
                    {claimKindLabel(claim.kind, ar)}
                    {claim.amountMinor ? (
                      <>
                        {' · '}
                        <bdi dir="ltr">{money(claim.amountMinor)}</bdi>
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="deposit-claims-admin__summary-meta">
                  <span className={`pmh-badge pmh-badge--${claimStatusTone(claim.status)}`}>
                    {claimStatusLabel(claim.status, ar)}
                  </span>
                  <small className="muted">{stamp(claim.createdAt, ar)}</small>
                </span>
              </button>

              {expanded ? (
                <div className="deposit-claims-admin__panel">
                  <p className="deposit-claims-admin__message">{claim.message}</p>

                  {ownerAction ? (
                    <div className="deposit-claims-admin__procedure" role="note">
                      <p>
                        {ar
                          ? 'دور المالك / إدارة المبنى: تحقّق ثم أحِل للمحاسب، أو ارفض مع ملاحظة تظهر للضيف. ملاحظة الإحالة الداخلية لا تظهر للضيف.'
                          : 'Owner / building management: verify, then refer to accounting, or decline with a guest-visible note. Internal referral notes stay staff-only.'}
                      </p>
                    </div>
                  ) : null}

                  {accountantAction && notReceived ? (
                    <div className="deposit-claims-admin__procedure" role="note">
                      <p>
                        {ar
                          ? 'دور المحاسب: تحقق من التحويل ثم اعتمد (إعادة تحويل) أو ارفض. الملاحظة العامة تظهر للضيف؛ الداخلية للمالك/الإدارة فقط.'
                          : 'Accountant: verify the transfer, then approve (re-send) or decline. Public note goes to the guest; internal note is for owner/management only.'}
                      </p>
                      <ol>
                        <li>
                          {ar
                            ? '«تأكيد عدم الوصول» — يُلغى التحويل الأخير ويعود للتحويل مجدداً.'
                            : '“Confirm not received” — voids the last transfer for a new payout.'}
                        </li>
                        <li>
                          {ar
                            ? '«المبلغ وصل — رفض» — إن تبيّن أن الضيف استلم المبلغ.'
                            : '“Amount arrived — decline” — if the guest did receive it.'}
                        </li>
                      </ol>
                    </div>
                  ) : null}

                  {claim.ownerInternalNote ? (
                    <small className="deposit-claims-admin__reply is-internal">
                      {ar ? 'ملاحظة داخلية للمالك → المحاسب' : 'Internal owner → accountant'}
                      {claim.referredBy ? ` · ${claim.referredBy}` : ''}
                      {`: ${claim.ownerInternalNote}`}
                    </small>
                  ) : null}
                  {claim.accountantInternalNote ? (
                    <small className="deposit-claims-admin__reply is-internal">
                      {ar ? 'ملاحظة داخلية من المحاسب' : 'Internal accountant note'}
                      {`: ${claim.accountantInternalNote}`}
                    </small>
                  ) : null}

                  {claim.response ? (
                    <small className="deposit-claims-admin__reply">
                      {claim.response.decision === 'referred'
                        ? ar
                          ? 'أُحيل للمحاسب'
                          : 'Referred to accounting'
                        : claim.response.decision === 'accepted'
                          ? ar
                            ? notReceived
                              ? 'تأكيد عدم الوصول — أُعيد للتحويل'
                              : 'قُبل وأُغلق'
                            : notReceived
                              ? 'Confirmed not received — back for transfer'
                              : 'Accepted & closed'
                          : ar
                            ? 'رُفض وأُغلق'
                            : 'Declined & closed'}
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
                      {claim.resolution.amountMinor
                        ? ` · ${money(claim.resolution.amountMinor)}`
                        : ''}
                      {claim.resolution.note ? `: ${claim.resolution.note}` : ''}
                    </small>
                  ) : null}

                  {(ownerAction || accountantAction) && formOpen && answering ? (
                    <form
                      className="deposit-claims-admin__form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submit(claim, answering.decision);
                      }}
                    >
                      <p className="deposit-claims-admin__choice" role="status">
                        {answering.decision === 'refer'
                          ? ar
                            ? 'الإجراء: إحالة للمحاسب مع ملاحظة عامة للضيف وملاحظة داخلية اختيارية.'
                            : 'Action: refer to accounting with a guest note and optional internal note.'
                          : answering.decision === 'accept'
                            ? notReceived
                              ? ar
                                ? 'الإجراء: تأكيد عدم الوصول → إلغاء التحويل الأخير وإعادته للتحويل.'
                                : 'Action: confirm not received → void last transfer for a new payout.'
                              : ar
                                ? 'الإجراء: قبول الطلب وإضافة المبلغ لاسترداد الضيف إن لزم، ثم إغلاق الطلب.'
                                : 'Action: accept, add an amount to the refund if needed, then close.'
                            : ar
                              ? 'الإجراء: رفض وإغلاق الطلب — توضّح للضيف في الملاحظة العامة لماذا.'
                              : 'Action: decline and close — explain why in the public note.'}
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
                          {ar ? 'ملاحظة عامة (تظهر للضيف)' : 'Public note (shown to the guest)'}
                        </span>
                        <textarea
                          rows={3}
                          maxLength={CLAIM_MESSAGE_MAX}
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          aria-invalid={tried && note.trim().length < CLAIM_NOTE_MIN}
                          placeholder={
                            ar
                              ? answering.decision === 'refer'
                                ? 'مثال: راجعنا بلاغك وأحلناه للمحاسب للتحقق من التحويل.'
                                : notReceived
                                  ? answering.decision === 'accept'
                                    ? 'مثال: راجعنا التحويل ولم يُقيَّد — سنعيد التحويل خلال يوم عمل.'
                                    : 'مثال: التحويل ظهر في كشف البنك بتاريخ … برقم مرجعي …'
                                  : 'اكتب ردّك على الطلب.'
                              : answering.decision === 'refer'
                                ? 'e.g. We reviewed your report and referred it to accounting.'
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
                      <label className="field">
                        <span>
                          {ar
                            ? 'ملاحظة داخلية (للمالك/الإدارة/المحاسب فقط — لا تظهر للضيف)'
                            : 'Internal note (owner/management/accountant only — not shown to guest)'}
                        </span>
                        <textarea
                          rows={2}
                          maxLength={CLAIM_MESSAGE_MAX}
                          value={internalNote}
                          onChange={(event) => setInternalNote(event.target.value)}
                          placeholder={
                            ar
                              ? answering.decision === 'refer'
                                ? 'مثال للمحاسب: راجع إيصال 22 أكتوبر ورقم المعاملة…'
                                : 'مثال للمالك: تم التحقق من كشف البنك — لا حاجة لإعادة التحويل.'
                              : answering.decision === 'refer'
                                ? 'e.g. for accountant: check 22 Oct slip and txn…'
                                : 'e.g. for owner: bank statement verified — no re-transfer needed.'
                          }
                        />
                      </label>
                      {tried && note.trim().length < CLAIM_NOTE_MIN ? (
                        <small className="field-error" role="alert">
                          {ar
                            ? 'اكتب الملاحظة العامة قبل التأكيد.'
                            : 'Write the public note before confirming.'}
                        </small>
                      ) : null}
                      <div className="deposit-claims-admin__actions">
                        <button type="submit" className="button button--primary" disabled={busy}>
                          {answering.decision === 'refer'
                            ? ar
                              ? 'تأكيد الإحالة للمحاسب'
                              : 'Confirm refer to accounting'
                            : answering.decision === 'accept'
                              ? notReceived
                                ? ar
                                  ? 'تأكيد: لم يصل — أعد للتحويل'
                                  : 'Confirm: not received — return for transfer'
                                : ar
                                  ? 'تأكيد القبول والإغلاق'
                                  : 'Confirm accept & close'
                              : ar
                                ? 'تأكيد الرفض والإغلاق'
                                : 'Confirm decline & close'}
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
                  ) : ownerAction || accountantAction ? (
                    <div className="deposit-claims-admin__actions">
                      {ownerAction ? (
                        <>
                          <button
                            type="button"
                            className="button button--primary"
                            onClick={() => {
                              setNote('');
                              setInternalNote('');
                              setTried(false);
                              setAnswering({ id: claim.id, decision: 'refer' });
                            }}
                          >
                            {ar ? 'إحالة للمحاسب' : 'Refer to accounting'}
                          </button>
                          <button
                            type="button"
                            className="button button--quiet"
                            onClick={() => {
                              setNote('');
                              setInternalNote('');
                              setTried(false);
                              setAnswering({ id: claim.id, decision: 'reject' });
                            }}
                          >
                            {ar ? 'رفض وإغلاق' : 'Decline & close'}
                          </button>
                        </>
                      ) : null}
                      {accountantAction ? (
                        <>
                          <button
                            type="button"
                            className="button button--primary"
                            onClick={() => {
                              setNote('');
                              setInternalNote('');
                              setTried(false);
                              setAmount(minorToDecimal(claim.amountMinor, currency));
                              setAnswering({ id: claim.id, decision: 'accept' });
                            }}
                          >
                            {notReceived
                              ? ar
                                ? 'تأكيد: لم يصل — أعد للتحويل'
                                : 'Confirm: not received — return for transfer'
                              : ar
                                ? 'قبول وإغلاق'
                                : 'Accept & close'}
                          </button>
                          <button
                            type="button"
                            className="button button--quiet"
                            onClick={() => {
                              setNote('');
                              setInternalNote('');
                              setTried(false);
                              setAnswering({ id: claim.id, decision: 'reject' });
                            }}
                          >
                            {notReceived
                              ? ar
                                ? 'المبلغ وصل — رفض وإغلاق'
                                : 'Amount arrived — decline & close'
                              : ar
                                ? 'رفض وإغلاق'
                                : 'Decline & close'}
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
