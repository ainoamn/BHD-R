'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/format';
import {
  CLAIM_MESSAGE_MAX,
  CLAIM_MESSAGE_MIN,
  ESCALATION_BUSINESS_DAYS,
  MAX_CLAIMS_PER_STAY,
  RECEIPT_CONFIRM_HOURS,
  claimKindLabel,
  claimStatusLabel,
  claimStatusTone,
  type DepositClaimView,
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
  const [form, setForm] = useState<'claim' | 'not_received' | null>(null);
  const [escalating, setEscalating] = useState<string | null>(null);
  const [kind, setKind] = useState<'deduction' | 'other'>('deduction');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [whatsapp, setWhatsapp] = useState<Whatsapp[]>(initialWhatsapp);

  const deposit = depositMinor && /^\d+$/.test(depositMinor) ? BigInt(depositMinor) : 0n;
  const kept =
    refund.status === 'rejected'
      ? deposit
      : deposit > BigInt(refund.amountMinor)
        ? deposit - BigInt(refund.amountMinor)
        : 0n;
  const lastPaid = refund.lastPaidMinor ?? refund.paidMinor;
  const partial = lastPaid !== refund.paidMinor;
  const open = claims.some((claim) => claim.status === 'open');
  const canClaim = refund.status !== 'requested' && !open && claims.length < MAX_CLAIMS_PER_STAY;
  const [now] = useState(() => Date.now());

  function run(body: Record<string, unknown>, success: string) {
    startTransition(async () => {
      setError(null);
      setDone(null);
      try {
        const result = await send({ referenceCode, ...body }, ar);
        if (result.whatsapp.length) setWhatsapp(result.whatsapp);
        setForm(null);
        setEscalating(null);
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
            ? `إن لم يصلك المبلغ أو اعترضت على الخصم، أرسل طلبك للمالك مباشرة ليبتّ فيه. وإن لم تصل لحل مرضٍ، يمكنك بعد ${ESCALATION_BUSINESS_DAYS} أيام عمل من استرداد التأمين رفع شكوى لإدارة الموقع.`
            : `If the money did not arrive or you object to a deduction, send your request to the host. If the answer is not satisfying, ${ESCALATION_BUSINESS_DAYS} working days after the refund you can complain to the site administration.`}
        </p>

        {claims.length ? (
          <ul className="stay-deposit-claims__list">
            {[...claims].reverse().map((claim) => {
              const from = claim.escalateFrom ? Date.parse(claim.escalateFrom) : null;
              const canEscalate =
                from !== null &&
                from <= now &&
                (claim.status === 'rejected' ||
                  claim.status === 'open' ||
                  claim.status === 'accepted');
              return (
                <li key={claim.id} className="stay-deposit-claims__item">
                  <div className="stay-deposit-claims__item-head">
                    <strong>{claimKindLabel(claim.kind, ar)}</strong>
                    <span className={`pmh-badge pmh-badge--${claimStatusTone(claim.status)}`}>
                      {claimStatusLabel(claim.status, ar)}
                    </span>
                  </div>
                  <small className="muted">
                    {stamp(claim.createdAt, ar)}
                    {claim.amountMinor ? ` · ${money(claim.amountMinor)}` : ''}
                  </small>
                  <p className="stay-deposit-claims__message">{claim.message}</p>
                  {claim.response ? (
                    <div className="stay-deposit-claims__reply">
                      <strong>
                        {claim.response.decision === 'accepted'
                          ? ar
                            ? 'قبِل المالك طلبك'
                            : 'The host accepted'
                          : ar
                            ? 'لم يقبل المالك طلبك'
                            : 'The host declined'}
                        {claim.response.amountMinor
                          ? ` · ${money(claim.response.amountMinor)}`
                          : ''}
                      </strong>
                      {claim.response.note ? <p>{claim.response.note}</p> : null}
                    </div>
                  ) : null}
                  {claim.escalation ? (
                    <div className="stay-deposit-claims__reply is-escalated">
                      <strong>
                        {ar ? 'شكواك لإدارة الموقع' : 'Your complaint'} ·{' '}
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
                          {ar ? 'أرسل الشكوى عبر واتساب' : 'Send on WhatsApp'}{' '}
                          <bdi dir="ltr">{link.number}</bdi>
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {canEscalate ? (
                    escalating === claim.id ? (
                      <form
                        className="stay-deposit-claims__form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          run(
                            { action: 'escalate', claimId: claim.id, message: message.trim() },
                            ar
                              ? 'وصلت شكواك لإدارة الموقع، وسيصلك قرارها.'
                              : 'The site administration has your complaint.',
                          );
                        }}
                      >
                        {messageField(
                          `deposit-escalate-${claim.id}`,
                          ar
                            ? 'لماذا لم يكن رد المالك مرضياً؟ وما الذي تطلبه؟'
                            : 'Why was the host’s answer not satisfying, and what do you ask for?',
                        )}
                        <div className="stay-deposit-claims__actions">
                          <button
                            type="submit"
                            className="button button--primary"
                            disabled={pending}
                          >
                            {ar ? 'أرسل الشكوى لإدارة الموقع' : 'Send the complaint'}
                          </button>
                          <button
                            type="button"
                            className="button button--quiet"
                            onClick={() => setEscalating(null)}
                          >
                            {ar ? 'إلغاء' : 'Cancel'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="button button--quiet stay-deposit-claims__escalate"
                        disabled={pending}
                        onClick={() => {
                          setMessage('');
                          setForm(null);
                          setEscalating(claim.id);
                        }}
                      >
                        {ar ? 'تقديم شكوى لإدارة الموقع' : 'Complain to the site administration'}
                      </button>
                    )
                  ) : from !== null && from > now && claim.status !== 'accepted' ? (
                    <small className="muted">
                      {ar
                        ? `يمكنك رفع شكوى لإدارة الموقع ابتداءً من ${stamp(claim.escalateFrom!, ar)}.`
                        : `You can complain to the site administration from ${stamp(claim.escalateFrom!, ar)}.`}
                    </small>
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
                    ? 'وصل طلبك للمالك مباشرة، ويصلك رده هنا وعلى بريدك.'
                    : 'Your request went to the host; the answer will appear here.',
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
                setEscalating(null);
                setForm('claim');
              }}
            >
              {ar ? 'طلب أو اعتراض جديد' : 'New request or objection'}
            </button>
          )
        ) : open ? (
          <small className="muted">
            {ar
              ? 'لديك طلب بانتظار رد المالك؛ يصلك رده هنا وعلى بريدك.'
              : 'Your request is waiting for the host; the answer will appear here.'}
          </small>
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
