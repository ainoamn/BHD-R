'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { StayRefundMoment } from '@/lib/stay-guest-greeting';
import {
  OMAN_BANKS,
  REFUND_CONSENT,
  REFUND_NOTE_MAX,
  validPayoutAccount,
  type RefundPayoutMethod,
} from '@/lib/stay-deposit-refund';

type TrackState = 'done' | 'current' | 'upcoming' | 'stopped';

/** Request → host decision → transfer, as a small tracker under the refund screen. */
function RefundTrack({ moment, ar }: { moment: StayRefundMoment; ar: boolean }) {
  const { state } = moment;
  const steps: Array<{ label: string; detail: string | null; state: TrackState }> = [
    {
      label: ar ? 'طلب الاسترداد' : 'Refund requested',
      detail: moment.requestedAt,
      state: state === 'open' ? 'current' : 'done',
    },
    {
      label:
        state === 'rejected'
          ? ar
            ? 'رفض المالك'
            : 'Host declined'
          : ar
            ? 'موافقة المالك'
            : 'Host approval',
      detail: moment.decidedAt,
      state:
        state === 'rejected'
          ? 'stopped'
          : state === 'approved' || state === 'paid'
            ? 'done'
            : state === 'requested'
              ? 'current'
              : 'upcoming',
    },
    {
      label: ar ? 'تحويل المبلغ' : 'Money transferred',
      detail: moment.paidAt,
      state: state === 'paid' ? 'done' : state === 'approved' ? 'current' : 'upcoming',
    },
  ];
  return (
    <ol className="stay-refund__track" aria-label={ar ? 'مراحل الاسترداد' : 'Refund progress'}>
      {steps.map((step, index) => (
        <li key={step.label} className={`stay-refund__step stay-refund__step--${step.state}`}>
          <span className="stay-refund__dot" aria-hidden="true">
            {step.state === 'done' ? '✓' : step.state === 'stopped' ? '✕' : index + 1}
          </span>
          <span className="stay-refund__label">{step.label}</span>
          {step.detail ? <small>{step.detail}</small> : null}
        </li>
      ))}
    </ol>
  );
}

export function StayDepositRefund({ moment, ar }: { moment: StayRefundMoment; ar: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<RefundPayoutMethod>('bank');
  const [account, setAccount] = useState('');
  const [bank, setBank] = useState('');
  const [holder, setHolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [consent, setConsent] = useState(false);
  const accountGiven = account.trim().length > 0;
  const accountOk = !accountGiven || validPayoutAccount(method, account);

  function submit() {
    setTried(true);
    if (!accountOk || !consent) return;
    startTransition(async () => {
      setError(null);
      try {
        const response = await fetch('/api/public/stays/guest/deposit-refund', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-requested-with': 'BHD-R',
          },
          body: JSON.stringify({
            referenceCode: moment.referenceCode,
            consent: true,
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(accountGiven
              ? {
                  payout: {
                    method,
                    account: account.trim(),
                    ...(bank.trim() ? { bank: bank.trim() } : {}),
                    ...(holder.trim() ? { holder: holder.trim() } : {}),
                  },
                }
              : {}),
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: { messageAr?: string; message?: string };
          } | null;
          throw new Error(
            (ar ? payload?.error?.messageAr : payload?.error?.message) ??
              (ar ? 'تعذّر إرسال الطلب. أعد المحاولة.' : 'Could not send the request. Try again.'),
          );
        }
        setFormOpen(false);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    });
  }

  return (
    <div className={`stay-refund stay-refund--${moment.state}`}>
      <RefundTrack moment={moment} ar={ar} />
      {moment.note ? (
        <div className="guest-stay-detail__moment stay-refund__note">
          <span>
            {moment.state === 'rejected'
              ? ar
                ? 'سبب الرفض'
                : 'Reason'
              : ar
                ? 'ملاحظة المالك'
                : 'Host note'}
          </span>
          <strong>{moment.note}</strong>
        </div>
      ) : null}
      {moment.state === 'open' && !formOpen ? (
        <button
          type="button"
          className="button button--primary stay-refund__ask"
          onClick={() => setFormOpen(true)}
        >
          {ar ? 'طلب استرداد التأمين' : 'Request my deposit back'}
        </button>
      ) : null}
      {moment.state === 'open' && formOpen ? (
        <form
          className="stay-refund__form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <section
            className="stay-refund__consent stay-refund__wide"
            aria-labelledby="stay-refund-consent-title"
          >
            <h3 id="stay-refund-consent-title">
              {ar ? 'قبل إرسال الطلب' : 'Before you send the request'}
            </h3>
            <ul>
              {REFUND_CONSENT[ar ? 'ar' : 'en'].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <label className="stay-refund__agree">
              <input
                type="checkbox"
                checked={consent}
                aria-invalid={tried && !consent}
                onChange={(event) => setConsent(event.target.checked)}
              />{' '}
              {ar ? 'قرأت ما سبق وأوافق عليه' : 'I have read the above and agree'}
            </label>
          </section>
          <fieldset className="stay-refund__methods">
            <legend>{ar ? 'أين نحوّل المبلغ؟' : 'Where should we send it?'}</legend>
            {(['bank', 'phone'] as const).map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="stay-refund-method"
                  checked={method === value}
                  onChange={() => setMethod(value)}
                />{' '}
                {value === 'bank'
                  ? ar
                    ? 'حساب بنكي / IBAN'
                    : 'Bank account / IBAN'
                  : ar
                    ? 'رقم هاتف (تحويل عبر الهاتف)'
                    : 'Phone number (mobile transfer)'}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>
              {method === 'bank'
                ? ar
                  ? 'رقم الحساب أو IBAN'
                  : 'Account number or IBAN'
                : ar
                  ? 'رقم الهاتف'
                  : 'Phone number'}
            </span>
            <input
              className="input"
              dir="ltr"
              autoComplete="off"
              maxLength={64}
              placeholder={method === 'bank' ? 'OM•• •••• ••••' : '+968 9X XXX XXX'}
              value={account}
              aria-invalid={tried && !accountOk}
              onChange={(event) => setAccount(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{ar ? 'البنك' : 'Bank'}</span>
            <input
              className="input"
              list="stay-refund-banks"
              maxLength={120}
              value={bank}
              onChange={(event) => setBank(event.target.value)}
            />
            <datalist id="stay-refund-banks">
              {OMAN_BANKS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>{ar ? 'اسم صاحب الحساب' : 'Account holder'}</span>
            <input
              className="input"
              maxLength={120}
              value={holder}
              onChange={(event) => setHolder(event.target.value)}
            />
          </label>
          <label className="field stay-refund__wide">
            <span>{ar ? 'ملاحظة للمالك (اختياري)' : 'Note for the host (optional)'}</span>
            <textarea
              className="textarea"
              rows={2}
              maxLength={REFUND_NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {tried && !accountOk ? (
            <p className="field__error stay-refund__wide" role="alert">
              {method === 'bank'
                ? ar
                  ? 'رقم الحساب أو IBAN غير صحيح.'
                  : 'The account number or IBAN looks wrong.'
                : ar
                  ? 'رقم الهاتف غير صحيح.'
                  : 'The phone number looks wrong.'}
            </p>
          ) : null}
          <p className="muted stay-refund__wide">
            {ar
              ? 'تصل بياناتك إلى المالك والمحاسب فقط لإتمام التحويل. يمكنك تركها فارغة وسيتواصلون معك.'
              : 'Only the host and accountant see these details, to make the transfer. You may leave them empty and they will contact you.'}
          </p>
          <div className="form-actions stay-refund__wide">
            <button type="submit" className="button button--primary" disabled={pending || !consent}>
              {pending ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : ar ? 'إرسال الطلب' : 'Send request'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={pending}
              onClick={() => setFormOpen(false)}
            >
              {ar ? 'تراجع' : 'Back'}
            </button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
