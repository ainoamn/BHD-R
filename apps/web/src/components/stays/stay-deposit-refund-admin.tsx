'use client';

import { useRef, useState } from 'react';
import { formatMoney } from '@/lib/format';
import {
  OMAN_BANKS,
  REFUND_NOTE_MAX,
  REFUND_RECEIPT_MAX,
  hasDeposit,
  validPayoutAccount,
  type RefundPayoutMethod,
} from '@/lib/stay-deposit-refund';
import type { PropertyRecordRow } from '@/lib/property-records-neon';
import { NoteTranslateBar, TranslatableNote } from '@/components/note-translate';
import { hasNoteTranslation } from '@/lib/note-translation';
import { StampDateTimeField } from './stamp-date-time-field';
import { compressDocument } from './stay-handover-form';

export type RefundFormMode = 'approve' | 'reject' | 'payout';

export type RefundSubmit =
  | { action: 'refund_decide'; decision: 'approve' | 'reject'; amount?: string; note?: string }
  | {
      action: 'refund_payout';
      method: RefundPayoutMethod;
      account: string;
      bank: string;
      holder?: string;
      reference?: string;
      note?: string;
      at: string;
      receipt: string;
    };

function formatStamp(value: string, ar: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Muscat',
  }).format(date);
}

function receiptStateLabel(state: string, deadline: string | null | undefined, ar: boolean) {
  switch (state) {
    case 'pending':
      return ar
        ? `التحويل مكتمل — تأكيد الاستلام اختياري من الضيف${deadline ? ` حتى ${formatStamp(deadline, ar)}` : ''}`
        : `Transfer complete — optional guest confirmation${deadline ? ` by ${formatStamp(deadline, ar)}` : ''}`;
    case 'confirmed':
      return ar ? '✓ أكّد الضيف استلام المبلغ' : '✓ The guest confirmed receipt';
    case 'not_received':
      return ar
        ? 'بلاغ على نفس التحويل: لم يستلم الضيف المبلغ — مهمة مفتوحة للمحاسب'
        : 'Note on this transfer: guest did not receive it — open task for the accountant';
    default:
      return ar
        ? 'التحويل مكتمل (اعتُبر مستلَماً بعد المهلة)'
        : 'Transfer complete (counted received after the window)';
  }
}

function methodLabel(method: string | null | undefined, ar: boolean): string {
  if (method === 'phone') return ar ? 'رقم هاتف' : 'Phone';
  return ar ? 'حساب بنكي' : 'Bank account';
}

/**
 * The guest's own value for a transfer method. Requests before 0.8.9 have no separate phone,
 * and a phone request kept the number in the account field.
 */
function guestPayoutValue(row: PropertyRecordRow, method: RefundPayoutMethod): string {
  if (!row.refundGuestPhone)
    return row.refundGuestMethod === method ? (row.refundGuestAccount ?? '') : '';
  return (method === 'phone' ? row.refundGuestPhone : row.refundGuestAccount) ?? '';
}

/** Where the guest asked the money to go (as typed in their request). */
function GuestPayout({ row, ar }: { row: PropertyRecordRow; ar: boolean }) {
  if (!row.refundGuestAccount) return null;
  if (!row.refundGuestPhone) {
    return (
      <span className="psr-refund__line">
        {ar ? 'يحوَّل إلى' : 'Send to'}: {methodLabel(row.refundGuestMethod, ar)}{' '}
        <bdi dir="ltr">{row.refundGuestAccount}</bdi>
        {row.refundGuestBank ? ` · ${row.refundGuestBank}` : ''}
        {row.refundGuestHolder ? ` · ${row.refundGuestHolder}` : ''}
      </span>
    );
  }
  const byPhone = row.refundGuestMethod === 'phone';
  return (
    <>
      <span className="psr-refund__line">
        {ar ? 'يفضّل الضيف' : 'Guest prefers'}:{' '}
        {byPhone
          ? ar
            ? 'تحويل عبر رقم الهاتف'
            : 'Transfer to phone'
          : ar
            ? 'تحويل إلى الحساب البنكي'
            : 'Transfer to bank account'}
      </span>
      <span className="psr-refund__line">
        {ar ? 'الحساب' : 'Account'}: <bdi dir="ltr">{row.refundGuestAccount}</bdi>
        {row.refundGuestBank ? ` · ${row.refundGuestBank}` : ''}
        {row.refundGuestHolder ? ` · ${row.refundGuestHolder}` : ''}
      </span>
      <span className="psr-refund__line">
        {byPhone
          ? ar
            ? 'هاتف التحويل'
            : 'Transfer phone'
          : ar
            ? 'هاتف للتواصل فقط'
            : 'Contact phone only'}
        : <bdi dir="ltr">{row.refundGuestPhone}</bdi>
      </span>
    </>
  );
}

/**
 * Refund of a stay row (bookings tab) or of a refund row (accounting tab): deposit, where the
 * refund stands, and its details.
 */
export function DepositRefundCell({
  row,
  locale,
  receiptHref,
  compact = false,
}: {
  row: PropertyRecordRow;
  locale: 'ar' | 'en';
  receiptHref: string | null;
  /** Table summary: badge + amount only (full details in the preview modal). */
  compact?: boolean;
}) {
  const ar = locale === 'ar';
  if ((row.kind !== 'stay' && row.kind !== 'deposit_refund') || !hasDeposit(row.depositMinor)) {
    return <span className="muted">—</span>;
  }
  const currency = row.currency ?? 'OMR';
  const money = (minor: string | null | undefined) =>
    minor ? formatMoney(minor, currency, locale) : '—';
  const depositPayBadge = (() => {
    switch (row.depositStatus) {
      case 'paid':
        return (
          <span className="pmh-badge pmh-badge--ready">{ar ? 'مدفوع' : 'Paid'}</span>
        );
      case 'waived':
        return (
          <span className="pmh-badge pmh-badge--info">{ar ? 'معفى' : 'Waived'}</span>
        );
      case 'unpaid':
        return (
          <span className="pmh-badge pmh-badge--warn">{ar ? 'غير مدفوع' : 'Unpaid'}</span>
        );
      default:
        return null;
    }
  })();
  const deposit = (
    <span className="psr-refund__deposit">
      {ar ? 'التأمين' : 'Deposit'} <bdi dir="ltr">{money(row.depositMinor)}</bdi>
      {depositPayBadge}
    </span>
  );
  const lateLabel = ar ? row.lateReturnLabelAr : row.lateReturnLabelEn;
  const lateNote =
    row.lateReturnMinutes && Number(row.lateReturnMinutes) > 0 ? (
      <span className="psr-refund__line psr-refund__late">
        {ar ? 'تأخير التسليم' : 'Late return'}: {lateLabel || row.lateReturnMinutes}
        {ar
          ? ' · قرار الخصم من التأمين أو المطالبة للمالك'
          : ' · deposit deduction or claim is the owner’s choice'}
      </span>
    ) : null;

  if (!row.refundStatus) {
    if (row.status !== 'checked_out') return <div className="psr-refund">{deposit}</div>;
    return (
      <div className="psr-refund">
        {deposit}
        <span className="pmh-badge pmh-badge--warn">
          {ar ? 'لم يُطلب بعد · بانتظار قرارك' : 'Not requested · your decision'}
        </span>
        {lateNote}
      </div>
    );
  }

  const badges: Record<string, [string, string]> = {
    requested: ['warn', ar ? 'طلب الضيف الاسترداد' : 'Guest requested a refund'],
    approved: [
      'info',
      ar ? 'معتمد · لدى المحاسب للتحويل' : 'Approved · with the accountant to transfer',
    ],
    rejected: ['muted', ar ? 'رُفض الاسترداد' : 'Refund rejected'],
    executed: ['ready', ar ? 'مكتمل · حوّله المحاسب' : 'Completed · transferred by the accountant'],
  };
  const badge = badges[row.refundStatus] ?? ['warn', row.refundStatus];

  if (compact) {
    return (
      <div className="psr-refund psr-refund--compact">
        {deposit}
        <span className={`pmh-badge pmh-badge--${badge[0]}`}>{badge[1]}</span>
        {lateNote}
        {row.refundStatus === 'executed' && row.refundAmountMinor ? (
          <span className="psr-refund__line">
            <bdi dir="ltr">{money(row.refundAmountMinor)}</bdi>
          </span>
        ) : null}
        {row.refundReceiptState === 'not_received' ? (
          <span className="psr-refund__line psr-refund__receipt-state is-not_received">
            {ar ? 'بلاغ: لم يصل المبلغ' : 'Report: not received'}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="psr-refund">
      {deposit}
      <span className={`pmh-badge pmh-badge--${badge[0]}`}>{badge[1]}</span>
      {lateNote}
      {row.refundRequestedAt && row.refundRequestedBy === 'guest' ? (
        <span className="psr-refund__line">
          {ar ? 'طُلب في' : 'Requested'} {formatStamp(row.refundRequestedAt, ar)}
        </span>
      ) : null}
      {row.refundGuestNote ? (
        <small className="psr-refund__note">
          {ar ? 'ملاحظة الضيف' : 'Guest note'}: {row.refundGuestNote}
        </small>
      ) : null}
      {row.refundStatus === 'requested' ? <GuestPayout row={row} ar={ar} /> : null}
      {row.refundStatus === 'approved' || row.refundStatus === 'executed' ? (
        <span className="psr-refund__line">
          {ar ? 'المبلغ المعتمد' : 'Approved amount'}{' '}
          <bdi dir="ltr">{money(row.refundAmountMinor)}</bdi>
          {row.refundDecidedBy ? ` · ${row.refundDecidedBy}` : ''}
        </span>
      ) : null}
      {row.refundStatus === 'approved' ? <GuestPayout row={row} ar={ar} /> : null}
      {row.refundDecisionNote ? (
        <small className="psr-refund__note">
          {row.refundStatus === 'rejected'
            ? ar
              ? 'سبب الرفض'
              : 'Reason'
            : ar
              ? 'ملاحظة المالك'
              : 'Host note'}
          : {row.refundDecisionNote}
        </small>
      ) : null}
      {row.refundStatus === 'executed' && row.refundPaidAt ? (
        <span className="psr-refund__line">
          {formatStamp(row.refundPaidAt, ar)} · {methodLabel(row.refundPaidMethod, ar)}{' '}
          <bdi dir="ltr">{row.refundPaidAccount}</bdi>
          {row.refundPaidBank ? ` · ${row.refundPaidBank}` : ''}
          {row.refundPaidReference ? (
            <>
              {' · '}
              {ar ? 'مرجع' : 'Ref'} <bdi dir="ltr">{row.refundPaidReference}</bdi>
            </>
          ) : null}
          {row.refundPaidBy ? ` · ${row.refundPaidBy}` : ''}
        </span>
      ) : null}
      {row.refundStatus === 'executed' && row.refundPaidNote ? (
        <small className="psr-refund__note">
          {ar ? 'ملاحظة التحويل' : 'Transfer note'}: {row.refundPaidNote}{' '}
          {hasNoteTranslation(row.refundPaidNote) ? null : (
            <TranslatableNote text={row.refundPaidNote} locale={locale} />
          )}
        </small>
      ) : null}
      {row.refundReceiptState ? (
        <span className={`psr-refund__line psr-refund__receipt-state is-${row.refundReceiptState}`}>
          {receiptStateLabel(row.refundReceiptState, row.refundReceiptDeadline, ar)}
        </span>
      ) : null}
      {row.refundReceipt && receiptHref ? (
        <a className="psr-refund__receipt" href={receiptHref} target="_blank" rel="noreferrer">
          🧾 {ar ? 'إيصال التحويل' : 'Transfer receipt'}
        </a>
      ) : null}
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable'));
    reader.onerror = () => reject(new Error('unreadable'));
    reader.readAsDataURL(file);
  });
}

/** Host approval / rejection of a deposit refund, or the accountant's transfer record. */
export function DepositRefundForm({
  mode,
  row,
  locale,
  busy,
  defaultAmount,
  onSubmit,
  onCancel,
}: {
  mode: RefundFormMode;
  row: PropertyRecordRow;
  locale: 'ar' | 'en';
  busy: boolean;
  /** Deposit as a decimal string, the approval's default amount. */
  defaultAmount: string;
  onSubmit: (value: RefundSubmit) => void;
  onCancel: () => void;
}) {
  const ar = locale === 'ar';
  const id = `refund-${mode}-${row.id ?? ''}`;
  const currency = row.currency ?? 'OMR';
  const kept =
    mode === 'payout' &&
    /^\d+$/.test(row.depositMinor ?? '') &&
    /^\d+$/.test(row.refundAmountMinor ?? '')
      ? BigInt(row.depositMinor!) - BigInt(row.refundAmountMinor!)
      : 0n;
  const [amount, setAmount] = useState(defaultAmount);
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<RefundPayoutMethod>(
    row.refundGuestMethod === 'phone' ? 'phone' : 'bank',
  );
  const [account, setAccount] = useState(() => guestPayoutValue(row, method));
  const [bank, setBank] = useState(row.refundGuestBank ?? '');
  const [holder, setHolder] = useState(row.refundGuestHolder ?? '');
  const [reference, setReference] = useState('');
  const [at, setAt] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const accountOk = validPayoutAccount(method, account);
  const noteMissing = mode === 'reject' && note.trim().length < 3;
  const payoutMissing = mode === 'payout' && (!accountOk || bank.trim().length < 2 || !receipt);
  const ready = !noteMissing && !payoutMissing && !reading && (mode !== 'payout' || Boolean(at));

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setFileError(null);
    setReading(true);
    try {
      if (file.type === 'application/pdf') {
        const dataUrl = await readAsDataUrl(file);
        if (dataUrl.length > REFUND_RECEIPT_MAX) throw new Error('too_large');
        setReceipt(dataUrl);
      } else if (file.type.startsWith('image/')) {
        setReceipt(await compressDocument(file));
      } else {
        throw new Error('type');
      }
    } catch {
      setFileError(
        ar
          ? 'اختر صورة الإيصال (JPG/PNG) أو ملف PDF أصغر من 0.9 ميجابايت.'
          : 'Choose a receipt image (JPG/PNG) or a PDF under 0.9 MB.',
      );
    } finally {
      setReading(false);
    }
  }

  const title =
    mode === 'approve'
      ? ar
        ? `اعتماد استرداد التأمين — ${row.reference ?? ''}`
        : `Approve deposit refund — ${row.reference ?? ''}`
      : mode === 'reject'
        ? ar
          ? `رفض استرداد التأمين — ${row.reference ?? ''}`
          : `Reject deposit refund — ${row.reference ?? ''}`
        : ar
          ? `تسجيل تحويل التأمين — ${row.reference ?? ''}`
          : `Record deposit transfer — ${row.reference ?? ''}`;

  return (
    <form
      className="psr-form psr-refund-form"
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!ready) return;
        if (mode === 'payout') {
          if (!at || !receipt) return;
          onSubmit({
            action: 'refund_payout',
            method,
            account: account.trim(),
            bank: bank.trim(),
            ...(holder.trim() ? { holder: holder.trim() } : {}),
            ...(reference.trim() ? { reference: reference.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
            at,
            receipt,
          });
          return;
        }
        onSubmit({
          action: 'refund_decide',
          decision: mode,
          ...(mode === 'approve' && amount.trim() ? { amount: amount.trim() } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }}
    >
      <h3>{title}</h3>
      <p className="psr-refund-form__facts">
        {ar ? 'مبلغ التأمين' : 'Deposit'}{' '}
        <bdi dir="ltr">{formatMoney(row.depositMinor ?? '0', currency, locale)}</bdi>
        {row.refundAmountMinor && mode === 'payout' ? (
          <>
            {' · '}
            {row.refundPaidMinor && row.refundDueMinor ? (
              <>
                {ar ? 'المتبقي للتحويل' : 'Left to transfer'}{' '}
                <strong dir="ltr">{formatMoney(row.refundDueMinor, currency, locale)}</strong>
                {ar ? ' (حُوّل سابقاً ' : ' (already transferred '}
                <bdi dir="ltr">{formatMoney(row.refundPaidMinor, currency, locale)}</bdi>
                {ar ? ' من أصل ' : ' of '}
                <bdi dir="ltr">{formatMoney(row.refundAmountMinor, currency, locale)}</bdi>)
              </>
            ) : (
              <>
                {ar ? 'المبلغ المعتمد للتحويل' : 'Approved to transfer'}{' '}
                <strong dir="ltr">{formatMoney(row.refundAmountMinor, currency, locale)}</strong>
              </>
            )}
            {kept > 0n ? (
              <>
                <br />
                {ar
                  ? 'يُسجَّل الفرق دخلاً للعقار بعد التحويل، بإيصال مرتبط بإيصال الاسترداد'
                  : 'The difference is booked as property income after the transfer, with a receipt linked to the refund receipt'}
                {': '}
                <strong dir="ltr">{formatMoney(kept.toString(), currency, locale)}</strong>
              </>
            ) : null}
          </>
        ) : null}
        {row.refundGuestNote ? (
          <>
            <br />
            {ar ? 'ملاحظة الضيف' : 'Guest note'}: <bdi>{row.refundGuestNote}</bdi>{' '}
            <TranslatableNote text={row.refundGuestNote} locale={locale} />
          </>
        ) : null}
        {row.refundDecisionNote && mode === 'payout' ? (
          <>
            <br />
            {ar ? 'ملاحظة المالك' : 'Host note'}:{' '}
            <span className="psr-refund-form__note">{row.refundDecisionNote}</span>
          </>
        ) : null}
      </p>

      <div className="form-grid">
        {mode === 'approve' ? (
          <div className="field">
            <label htmlFor={`${id}-amount`}>
              {ar ? `المبلغ المسترد (${currency})` : `Refund amount (${currency})`}
            </label>
            <input
              id={`${id}-amount`}
              className="input"
              dir="ltr"
              inputMode="decimal"
              pattern="\d{1,12}(\.\d{1,3})?"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <small className="muted">
              {ar
                ? 'كامل التأمين افتراضياً؛ يمكنك تخفيضه عند وجود خصم، مع ذكر السبب في الملاحظة. المخصوم يُسجَّل دخلاً للعقار بالملاحظة نفسها بعد تحويل الاسترداد.'
                : 'The full deposit by default; lower it for a deduction and give the reason in the note. The deduction is booked as property income, with the same note, once the refund is transferred.'}
            </small>
          </div>
        ) : null}

        {mode === 'payout' ? (
          <>
            <fieldset className="field span-2 psr-refund-form__method">
              <legend>{ar ? 'طريقة التحويل' : 'Transfer to'}</legend>
              {(['bank', 'phone'] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`${id}-method`}
                    checked={method === value}
                    onChange={() => {
                      if (account.trim() === guestPayoutValue(row, method).trim()) {
                        setAccount(guestPayoutValue(row, value));
                      }
                      setMethod(value);
                    }}
                  />{' '}
                  {value === 'bank'
                    ? ar
                      ? 'رقم الحساب / IBAN'
                      : 'Account number / IBAN'
                    : ar
                      ? 'رقم الهاتف (تحويل عبر الهاتف)'
                      : 'Phone number (mobile transfer)'}
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor={`${id}-account`}>
                {method === 'bank'
                  ? ar
                    ? 'رقم الحساب أو IBAN المحوَّل إليه *'
                    : 'Account number or IBAN sent to *'
                  : ar
                    ? 'رقم الهاتف المحوَّل إليه *'
                    : 'Phone number sent to *'}
              </label>
              <input
                id={`${id}-account`}
                className="input"
                dir="ltr"
                autoComplete="off"
                maxLength={64}
                value={account}
                aria-invalid={tried && !accountOk}
                onChange={(event) => setAccount(event.target.value)}
              />
              {tried && !accountOk ? (
                <small className="stamp-dt__error" role="alert">
                  {method === 'bank'
                    ? ar
                      ? 'أدخل رقم حساب أو IBAN صحيحاً (حروف وأرقام).'
                      : 'Enter a valid account number or IBAN.'
                    : ar
                      ? 'أدخل رقم هاتف صحيحاً.'
                      : 'Enter a valid phone number.'}
                </small>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor={`${id}-bank`}>{ar ? 'البنك *' : 'Bank *'}</label>
              <input
                id={`${id}-bank`}
                className="input"
                list={`${id}-banks`}
                maxLength={120}
                value={bank}
                aria-invalid={tried && bank.trim().length < 2}
                onChange={(event) => setBank(event.target.value)}
              />
              <datalist id={`${id}-banks`}>
                {OMAN_BANKS.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor={`${id}-holder`}>
                {ar ? 'اسم صاحب الحساب (اختياري)' : 'Account holder (optional)'}
              </label>
              <input
                id={`${id}-holder`}
                className="input"
                maxLength={120}
                value={holder}
                onChange={(event) => setHolder(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`${id}-ref`}>
                {ar ? 'رقم مرجع التحويل (اختياري)' : 'Transfer reference (optional)'}
              </label>
              <input
                id={`${id}-ref`}
                className="input"
                dir="ltr"
                maxLength={80}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </div>
            <StampDateTimeField
              id={`${id}-at`}
              locale={locale}
              onChange={setAt}
              label={ar ? 'تاريخ ووقت التحويل' : 'Transfer date and time'}
            />
            <div className="field span-2">
              <label htmlFor={`${id}-note`}>
                {ar
                  ? 'ملاحظة التحويل (اختياري · تظهر للضيف والمالك)'
                  : 'Transfer note (optional · shown to the guest and host)'}
              </label>
              <textarea
                id={`${id}-note`}
                className="textarea"
                rows={2}
                maxLength={REFUND_NOTE_MAX}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={
                  ar
                    ? 'مثال: حُوّل المبلغ بعد خصم رسوم التحويل البنكي 0.500 ر.ع.…'
                    : 'e.g. sent after a 0.500 OMR bank transfer fee…'
                }
              />
              <NoteTranslateBar
                value={note}
                onChange={setNote}
                locale={locale}
                max={REFUND_NOTE_MAX}
                disabled={busy}
              />
            </div>
            <div
              className={`field span-2 handover-doc${tried && !receipt ? ' handover-doc--missing' : ''}`}
            >
              <span className="handover-doc__label">
                {ar ? 'إيصال التحويل *' : 'Transfer receipt *'}
              </span>
              {receipt?.startsWith('data:image/') ? (
                <figure className="handover-doc__preview">
                  <img src={receipt} alt={ar ? 'إيصال التحويل' : 'Transfer receipt'} />
                </figure>
              ) : receipt ? (
                <span className="psr-refund__line">📄 PDF</span>
              ) : null}
              <div className="handover-doc__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={reading}
                  onClick={() => fileRef.current?.click()}
                >
                  ⬆{' '}
                  {receipt
                    ? ar
                      ? 'تغيير الإيصال'
                      : 'Replace receipt'
                    : ar
                      ? 'إرفاق الإيصال'
                      : 'Attach receipt'}
                </button>
                {receipt ? (
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => setReceipt(null)}
                  >
                    {ar ? 'إزالة' : 'Remove'}
                  </button>
                ) : null}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                hidden
                onChange={(event) => {
                  void pickFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {reading ? (
                <small className="muted">{ar ? 'جارٍ تجهيز الملف…' : 'Preparing file…'}</small>
              ) : fileError ? (
                <small className="stamp-dt__error" role="alert">
                  {fileError}
                </small>
              ) : tried && !receipt ? (
                <small className="stamp-dt__error" role="alert">
                  {ar ? 'إيصال التحويل مطلوب.' : 'The transfer receipt is required.'}
                </small>
              ) : (
                <small className="muted">
                  {ar
                    ? 'يُحفظ الإيصال بشكل خاص؛ يراه المالك والمحاسب فقط، ولا يظهر للضيف.'
                    : 'Stored privately for the host and accountant; the guest does not see it.'}
                </small>
              )}
            </div>
          </>
        ) : (
          <div className="field span-2">
            <label htmlFor={`${id}-note`}>
              {mode === 'reject'
                ? ar
                  ? 'سبب الرفض * (يظهر للضيف)'
                  : 'Reason * (shown to the guest)'
                : ar
                  ? 'ملاحظة للضيف والمحاسب (اختياري)'
                  : 'Note for the guest and accountant (optional)'}
            </label>
            <textarea
              id={`${id}-note`}
              className="textarea"
              rows={2}
              maxLength={REFUND_NOTE_MAX}
              value={note}
              aria-invalid={tried && noteMissing}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                mode === 'reject'
                  ? ar
                    ? 'مثال: أضرار في الوحدة موثّقة عند المغادرة…'
                    : 'e.g. damage recorded at check-out…'
                  : ar
                    ? 'مثال: خُصم 10 ر.ع. لتنظيف إضافي…'
                    : 'e.g. 10 OMR deducted for extra cleaning…'
              }
            />
            <NoteTranslateBar
              value={note}
              onChange={setNote}
              locale={locale}
              max={REFUND_NOTE_MAX}
              disabled={busy}
            />
            {tried && noteMissing ? (
              <small className="stamp-dt__error" role="alert">
                {ar ? 'اكتب سبب الرفض.' : 'Write the reason for rejecting.'}
              </small>
            ) : null}
          </div>
        )}
      </div>
      <p className="muted">
        {mode === 'approve'
          ? ar
            ? 'بعد الاعتماد ينتقل الطلب إلى المحاسب ليحوّل المبلغ من قسم «الحسابات»، ويرى الضيف أن طلبه قيد الإجراء.'
            : 'Once approved it moves to the accountant, who transfers it from Accounting; the guest sees it in progress.'
          : mode === 'reject'
            ? ar
              ? 'يرى الضيف الرفض مع السبب، ويُغلق الحجز.'
              : 'The guest sees the rejection and reason, and the booking is closed.'
            : ar
              ? 'بتأكيد التحويل يكتمل الطلب ويُغلق الحجز: تراه الإدارة مكتملاً، ويرى الضيف أن المبلغ حُوّل مع التاريخ والبنك (برقم حساب مخفي).'
              : 'Confirming completes the request and closes the booking: management sees it completed, and the guest sees the transfer date and bank (account masked).'}
      </p>
      <div className="form-actions">
        <button
          type="submit"
          className={mode === 'reject' ? 'button button--danger' : 'button button--primary'}
          disabled={busy || reading}
        >
          {busy
            ? ar
              ? 'جارٍ الحفظ…'
              : 'Saving…'
            : mode === 'approve'
              ? ar
                ? 'اعتماد الاسترداد'
                : 'Approve refund'
              : mode === 'reject'
                ? ar
                  ? 'رفض الاسترداد'
                  : 'Reject refund'
                : ar
                  ? 'تأكيد التحويل'
                  : 'Confirm transfer'}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel} disabled={busy}>
          {ar ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </form>
  );
}
