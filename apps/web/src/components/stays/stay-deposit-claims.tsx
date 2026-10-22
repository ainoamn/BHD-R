'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/format';
import {
  CLAIM_MESSAGE_MAX,
  CLAIM_MESSAGE_MIN,
  MAX_REGULAR_CLAIMS_PER_STAY,
  PROPERTY_RESPONSE_BUSINESS_DAYS,
  RECEIPT_CONFIRM_HOURS,
  SITE_DECISION_DAYS,
  claimIsActive,
  claimKindLabel,
  claimStatusLabel,
  claimStatusTone,
  claimsOpenFrom,
  guestDepositNextStep,
  sortClaimsNewestFirst,
  type DepositClaimView,
  type TrackClaimKind,
} from '@/lib/stay-deposit-claims';
import type { GuestDepositRefund } from '@/lib/stay-deposit-refund';

type Whatsapp = { number: string; url: string };

function stamp(value: string, ar: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

function guestDecisionLabel(
  decision: 'accepted' | 'rejected' | 'referred',
  ar: boolean,
): string {
  if (decision === 'referred') {
    return ar ? 'أُحيل الموضوع للمحاسب' : 'Referred to accounting';
  }
  if (decision === 'accepted') {
    return ar ? 'اعتُمد طلبك وأُغلق' : 'Your request was approved and closed';
  }
  return ar ? 'رُفض طلبك وأُغلق' : 'Your request was declined and closed';
}

async function send(body: Record<string, unknown>, ar: boolean): Promise<{ whatsapp: Whatsapp[] }> {
  const response = await fetch('/api/public/stays/guest/deposit-claims', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-requested-with': 'BHD-R',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => null)) as {
    whatsapp?: Whatsapp[];
    error?: { messageAr?: string; message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(
      (ar ? payload?.error?.messageAr : payload?.error?.message) ??
        (ar ? 'تعذّر تنفيذ الطلب. أعد المحاولة.' : 'Could not complete the request.'),
    );
  }
  return { whatsapp: payload?.whatsapp ?? [] };
}

/**
 * After the deposit refund: confirm the transfer arrived (or say it did not) within 24 hours,
 * send the host a deposit request or objection, and escalate it to the site administration
 * when the answer is not satisfying.
 */
export function StayDepositClaims({
  referenceCode,
  refund,
  claims,
  depositMinor,
  whatsapp: initialWhatsapp,
  ar,
}: {
  referenceCode: string;
  refund: GuestDepositRefund;
  claims: DepositClaimView[];
  depositMinor: string | null;
  /** Site administration WhatsApp links for an escalated complaint. */
  whatsapp: Whatsapp[];
  ar: boolean;
}) {
  const router = useRouter();
  const locale = ar ? 'ar' : 'en';
  const money = (minor: string) => formatMoney(minor, refund.currency, locale);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState<'claim' | 'not_received' | TrackClaimKind | null>(null);
  const [kind, setKind] = useState<'deduction' | 'other'>('deduction');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [whatsapp, setWhatsapp] = useState<Whatsapp[]>(initialWhatsapp);
  const [openId, setOpenId] = useState<string | null>(() => {
    const active = sortClaimsNewestFirst(claims).find((claim) => claimIsActive(claim.status));
    return active?.id ?? null;
  });

  const deposit = depositMinor && /^\d+$/.test(depositMinor) ? BigInt(depositMinor) : 0n;
  const kept =
    refund.status === 'rejected'
      ? deposit
      : refund.status !== 'requested' && deposit > BigInt(refund.amountMinor)
        ? deposit - BigInt(refund.amountMinor)
        : 0n;
  const lastPaid = refund.lastPaidMinor ?? refund.paidMinor;
  const partial = lastPaid !== refund.paidMinor;
  const activeOpen = claims.some((claim) => claimIsActive(claim.status));
  const ordered = sortClaimsNewestFirst(claims);
  const [now] = useState(() => Date.now());
  const opensFrom = claimsOpenFrom(refund);
  const waiting = opensFrom !== null && Date.parse(opensFrom) > now;
  const nextStep = waiting || activeOpen ? { step: 'none' as const } : guestDepositNextStep(claims);
  const canClaim = !waiting && nextStep.step === 'claim';
  const trackStep =
    nextStep.step === 'property_complaint' ||
    nextStep.step === 'appeal' ||
    nextStep.step === 'site_complaint'
      ? nextStep.step
      : null;

  function run(body: Record<string, unknown>, success: string) {
    startTransition(async () => {
      setError(null);
      setDone(null);
      try {
        const result = await send({ referenceCode, ...body }, ar);
        if (result.whatsapp.length) setWhatsapp(result.whatsapp);
        setForm(null);
        setMessage('');
        setAmount('');
        setDone(success);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    });
  }

  const messageField = (id: string, placeholder: string) => (
    <label className="stay-deposit-claims__field" htmlFor={id}>
      <span>{ar ? 'اكتب التفاصيل' : 'Details'}</span>
      <textarea
        id={id}
        rows={4}
        maxLength={CLAIM_MESSAGE_MAX}
        value={message}
        placeholder={placeholder}
        onChange={(event) => setMessage(event.target.value)}
      />
      <small className="muted">
        {ar ? `${CLAIM_MESSAGE_MIN} أحرف على الأقل.` : `At least ${CLAIM_MESSAGE_MIN} characters.`}
      </small>
    </label>
  );

  return (
    <section
      className="guest-stay-detail__card stay-deposit-claims"
      id="deposit-claims"
      aria-labelledby="deposit-claims-title"
    >
      {refund.receipt ? (
        <div className={`stay-deposit-claims__receipt is-${refund.receipt}`}>
          <h2 id="deposit-claims-title">
            {ar ? 'تأكيد استلام مبلغ التأمين' : 'Confirm you received the deposit'}
          </h2>
          {refund.receipt === 'pending' ? (
            <>
              <p>
                {ar
                  ? `حُوّل إليك ${money(lastPaid)}${refund.paidTo ? ` إلى ${refund.paidTo}` : ''}${
                      partial ? ` (إجمالي المحوَّل ${money(refund.paidMinor)})` : ''
                    }. أكّد الاستلام أو أبلغ بعدم وصول المبلغ خلال ${RECEIPT_CONFIRM_HOURS} ساعة${
                      refund.receiptDeadline ? ` (حتى ${stamp(refund.receiptDeadline, ar)})` : ''
                    }؛ بعدها يُعتبر المبلغ مستلَماً تلقائياً.`
                  : `${money(lastPaid)} was transferred to you${
                      refund.paidTo ? ` (${refund.paidTo})` : ''
                    }${partial ? `, ${money(refund.paidMinor)} in total` : ''}. Confirm it arrived, or report it missing, within ${RECEIPT_CONFIRM_HOURS} hours${
                      refund.receiptDeadline ? ` (by ${stamp(refund.receiptDeadline, ar)})` : ''
                    }; after that it counts as received.`}
              </p>
              <div className="stay-deposit-claims__actions">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={pending}
                  onClick={() =>
                    run(
                      { action: 'confirm_receipt' },
                      ar ? 'شكراً، سُجّل استلامك للمبلغ.' : 'Thanks, your receipt is recorded.',
                    )
                  }
                >
                  {ar ? 'استلمت المبلغ' : 'I received it'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={pending}
                  aria-expanded={form === 'not_received'}
                  onClick={() => {
                    setMessage('');
                    setForm(form === 'not_received' ? null : 'not_received');
                  }}
                >
                  {ar ? 'لم يصلني المبلغ' : 'It did not arrive'}
                </button>
              </div>
            </>
          ) : (
            <p>
              {refund.receipt === 'confirmed'
                ? ar
                  ? `أكّدت استلام ${money(refund.paidMinor)}`
                  : `You confirmed receiving ${money(refund.paidMinor)}.`
                : refund.receipt === 'auto'
                  ? ar
                    ? `اعتُبر مبلغ ${money(refund.paidMinor)} مستلَماً تلقائياً بعد ${RECEIPT_CONFIRM_HOURS} ساعة دون رد. إن لم يصلك فعلاً، أرسل طلباً للمالك أدناه.`
                    : `${money(refund.paidMinor)} counts as received after ${RECEIPT_CONFIRM_HOURS} hours without an answer. If it did not arrive, send the host a request below.`
                  : ar
                    ? 'أبلغت بعدم وصول المبلغ، ووصل بلاغك للمالك للبتّ فيه.'
                    : 'You reported the transfer missing; the host has been asked to look into it.'}
            </p>
          )}
          {form === 'not_received' ? (
            <form
              className="stay-deposit-claims__form"
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  { action: 'not_received', message: message.trim() || undefined },
                  ar
                    ? 'وصل بلاغك للمالك؛ سيُراجع التحويل ويصلك الرد.'
                    : 'The host has your report and will check the transfer.',
                );
              }}
            >
              {messageField(
                'deposit-not-received',
                ar
                  ? 'مثال: راجعت حسابي ولم يصل أي تحويل حتى الآن.'
                  : 'E.g. I checked my account and nothing arrived.',
              )}
              <div className="stay-deposit-claims__actions">
                <button type="submit" className="button button--primary" disabled={pending}>
                  {ar ? 'أرسل البلاغ للمالك' : 'Send to the host'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setForm(null)}
                >
                  {ar ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="stay-deposit-claims__requests">
        <h2 id={refund.receipt ? undefined : 'deposit-claims-title'}>
          {ar ? 'طلبات التأمين أو الاعتراضات' : 'Deposit requests and objections'}
        </h2>
        <p className="muted">
          {ar
            ? `يحق لك طلبان أو اعتراضان فقط (${MAX_REGULAR_CLAIMS_PER_STAY}). بعدهما تقدّم شكوى لإدارة العقار؛ إن لم تُجب خلال ${PROPERTY_RESPONSE_BUSINESS_DAYS} أيام عمل تُحال تلقائياً لإدارة الموقع. بعد إغلاق الشكوى يمكنك التظلُّم (نفس المهلة)، ثم شكوى نهائية لإدارة الموقع مع إرفاق السجل السابق. مهلة بث إدارة الموقع ${SITE_DECISION_DAYS} يوماً.`
            : `You may open only ${MAX_REGULAR_CLAIMS_PER_STAY} requests. Then file a property-management complaint; unanswered after ${PROPERTY_RESPONSE_BUSINESS_DAYS} working days it auto-escalates to the site. After a closed complaint you may appeal (same SLA), then a final site complaint with prior threads attached. Site decisions are due within ${SITE_DECISION_DAYS} days.`}
        </p>

        {ordered.length ? (
          <ul className="stay-deposit-claims__list">
            {ordered.map((claim) => {
              const expanded = openId === claim.id;
              const autoDue =
                claim.escalateFrom && claim.status === 'open'
                  ? Date.parse(claim.escalateFrom)
                  : null;
              return (
                <li key={claim.id} className="stay-deposit-claims__item">
                  <button
                    type="button"
                    className="stay-deposit-claims__summary"
                    aria-expanded={expanded}
                    onClick={() => setOpenId(expanded ? null : claim.id)}
                  >
                    <span className="stay-deposit-claims__summary-main">
                      <strong dir="ltr">{claim.referenceCode}</strong>
                      <span className="stay-deposit-claims__summary-kind">
                        {claimKindLabel(claim.kind, ar)}
                      </span>
                    </span>
                    <span className="stay-deposit-claims__summary-meta">
                      <span className={`pmh-badge pmh-badge--${claimStatusTone(claim.status)}`}>
                        {claimStatusLabel(claim.status, ar)}
                      </span>
                      <small className="muted">{stamp(claim.createdAt, ar)}</small>
                    </span>
                  </button>

                  {expanded ? (
                    <div className="stay-deposit-claims__panel">
                      {claim.amountMinor ? (
                        <small className="muted">{money(claim.amountMinor)}</small>
                      ) : null}
                      <p className="stay-deposit-claims__message">{claim.message}</p>
                      {claim.status === 'open' && !claim.response ? (
                        <div className="stay-deposit-claims__reply">
                          <strong>
                            {ar ? 'وصل طلبك للمالك / الإدارة' : 'Received by the owner / management'}
                          </strong>
                          <p>
                            {ar
                              ? 'سيراجعونه ويردّون عليك هنا. الشكاوى والتظلمات بلا رد تُحال تلقائياً لإدارة الموقع بعد المهلة.'
                              : 'They will review and reply here. Unanswered complaints/appeals auto-escalate after the deadline.'}
                          </p>
                        </div>
                      ) : null}
                      {claim.response ? (
                        <div className="stay-deposit-claims__reply">
                          <strong>
                            {guestDecisionLabel(claim.response.decision, ar)}
                            {claim.response.amountMinor
                              ? ` · ${money(claim.response.amountMinor)}`
                              : ''}
                          </strong>
                          {claim.response.note ? <p>{claim.response.note}</p> : null}
                          <small className="muted">{stamp(claim.response.at, ar)}</small>
                        </div>
                      ) : null}
                      {claim.escalation ? (
                        <div className="stay-deposit-claims__reply is-escalated">
                          <strong>
                            {ar ? 'لدى إدارة الموقع' : 'With the site administration'} ·{' '}
                            {stamp(claim.escalation.at, ar)}
                          </strong>
                          {claim.escalation.message ? <p>{claim.escalation.message}</p> : null}
                        </div>
                      ) : null}
                      {claim.resolution ? (
                        <div className="stay-deposit-claims__reply is-resolved">
                          <strong>
                            {claim.resolution.outcome === 'guest'
                              ? ar
                                ? 'قرار الإدارة: لصالحك'
                                : 'Decided in your favour'
                              : ar
                                ? 'قرار الإدارة: لصالح المالك'
                                : 'Decided for the host'}
                            {claim.resolution.amountMinor
                              ? ` · ${money(claim.resolution.amountMinor)}`
                              : ''}
                          </strong>
                          {claim.resolution.note ? <p>{claim.resolution.note}</p> : null}
                        </div>
                      ) : null}
                      {autoDue !== null && autoDue > now ? (
                        <small className="muted">
                          {ar
                            ? `إن لم يُردّ، يُحال لإدارة الموقع ابتداءً من ${stamp(claim.escalateFrom!, ar)}.`
                            : `If unanswered, escalates to the site from ${stamp(claim.escalateFrom!, ar)}.`}
                        </small>
                      ) : null}
                      {claim.status === 'escalated' && whatsapp.length ? (
                        <div className="stay-deposit-claims__actions">
                          {whatsapp.map((link) => (
                            <a
                              key={link.number}
                              className="button button--quiet"
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {ar ? 'أرسل عبر واتساب' : 'Send on WhatsApp'}{' '}
                              <bdi dir="ltr">{link.number}</bdi>
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {canClaim ? (
          form === 'claim' ? (
            <form
              className="stay-deposit-claims__form"
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  {
                    action: 'open',
                    kind,
                    amount: amount.trim() || undefined,
                    message: message.trim(),
                  },
                  ar
                    ? 'وصل طلبك للمالك/الإدارة برقم مستقل، ويصلك التحديث هنا وعلى بريدك.'
                    : 'Your request reached the owner/management with its own number; updates appear here.',
                );
              }}
            >
              <label className="stay-deposit-claims__field" htmlFor="deposit-claim-kind">
                <span>{ar ? 'نوع الطلب' : 'Request type'}</span>
                <select
                  id="deposit-claim-kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as 'deduction' | 'other')}
                >
                  <option value="deduction">{claimKindLabel('deduction', ar)}</option>
                  <option value="other">{claimKindLabel('other', ar)}</option>
                </select>
              </label>
              {kept > 0n ? (
                <label className="stay-deposit-claims__field" htmlFor="deposit-claim-amount">
                  <span>
                    {ar
                      ? `المبلغ الذي تطلب استرداده (اختياري، حتى ${money(kept.toString())})`
                      : `Amount you ask back (optional, up to ${money(kept.toString())})`}
                  </span>
                  <input
                    id="deposit-claim-amount"
                    inputMode="decimal"
                    dir="ltr"
                    value={amount}
                    placeholder="0.000"
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </label>
              ) : null}
              {messageField(
                'deposit-claim-message',
                ar ? 'اشرح طلبك أو اعتراضك بوضوح.' : 'Explain your request or objection clearly.',
              )}
              <div className="stay-deposit-claims__actions">
                <button type="submit" className="button button--primary" disabled={pending}>
                  {ar ? 'أرسل الطلب للمالك' : 'Send to the host'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setForm(null)}
                >
                  {ar ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="button button--quiet stay-deposit-claims__new"
              disabled={pending}
              onClick={() => {
                setMessage('');
                setAmount('');
                setForm('claim');
              }}
            >
              {ar ? 'طلب أو اعتراض جديد' : 'New request or objection'}
            </button>
          )
        ) : trackStep ? (
          form === trackStep ? (
            <form
              className="stay-deposit-claims__form"
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  { action: 'open_track', kind: trackStep, message: message.trim() },
                  trackStep === 'site_complaint'
                    ? ar
                      ? 'وصلت شكواك النهائية لإدارة الموقع مع سجل الطلبات السابقة.'
                      : 'Your final site complaint was filed with the prior thread attached.'
                    : trackStep === 'appeal'
                      ? ar
                        ? 'وُصِل تظلُّمك لإدارة العقار برقم مستقل.'
                        : 'Your appeal reached property management with its own number.'
                      : ar
                        ? 'وصلت شكواك لإدارة العقار برقم مستقل.'
                        : 'Your property-management complaint was filed with its own number.',
                );
              }}
            >
              {messageField(
                `deposit-track-${trackStep}`,
                trackStep === 'site_complaint'
                  ? ar
                    ? 'اشرح المشكلة بالتفصيل؛ سيُرفق النظام طلباتك وشكاواك السابقة لإدارة الموقع.'
                    : 'Describe the problem in detail; prior requests and complaints are attached for the site.'
                  : ar
                    ? 'اشرح اعتراضك أو تظلُّمك بوضوح.'
                    : 'Explain your complaint or appeal clearly.',
              )}
              <div className="stay-deposit-claims__actions">
                <button type="submit" className="button button--primary" disabled={pending}>
                  {ar ? 'أرسل' : 'Send'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setForm(null)}
                >
                  {ar ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="button button--quiet stay-deposit-claims__new"
              disabled={pending}
              onClick={() => {
                setMessage('');
                setForm(trackStep);
              }}
            >
              {claimKindLabel(trackStep, ar)}
            </button>
          )
        ) : activeOpen ? (
          <small className="muted">
            {ar
              ? 'لديك طلباً قيد المعالجة برقم مستقل؛ انتظر إغلاقه قبل المتابعة.'
              : 'You already have a request in progress; wait until it closes before continuing.'}
          </small>
        ) : waiting ? (
          <p className="stay-deposit-claims__wait">
            {ar
              ? `يُتاح تقديم طلب أو اعتراض فور تحويل مبلغ التأمين إليك، أو ابتداءً من ${stamp(opensFrom, ar)} إن لم يُحوَّل حتى ذلك الحين (أسبوعا عمل من طلب الاسترداد).`
              : `You can send a request or objection as soon as the deposit is transferred, or from ${stamp(opensFrom, ar)} if it has not been by then (two working weeks after the refund request).`}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="notice notice--success" role="status">
          {done}
        </p>
      ) : null}
    </section>
  );
}
