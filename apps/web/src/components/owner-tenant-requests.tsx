'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { CurrencyCode } from '@bhd-r/contracts';
import { NoteTranslateBar, OWNER_NOTE_SERVICE } from '@/components/note-translate';
import { ClosureProofPanel } from '@/components/request-media';
import { RequestSummary } from '@/components/tenant-requests-list';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney, toMinorUnits } from '@/lib/format';
import { NOTE_TRANSLATE_MAX } from '@/lib/note-translation';
import { PENDING_APPROVALS_CHANGED_EVENT } from '@/lib/pending-approvals-shared';
import type { ChargePayment } from '@/lib/tenant-charges-shared';
import {
  OPEN_TENANT_REQUEST,
  closureProofMissing,
  isTenantReport,
  requestNeedsCheque,
  tenantRequestErrorText,
  type OwnerTenantRequest,
} from '@/lib/tenant-requests-shared';

type Action =
  | 'approve'
  | 'reject'
  | 'in_progress'
  | 'on_hold'
  | 'complete'
  | 'reply'
  | 'emergency_confirm'
  | 'emergency_deny'
  | 'charge_paid';

export type PaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'cheque';

/** A typed amount in minor units, or '0' when it is not a valid amount. */
export function minorOf(value: string, currency: CurrencyCode): string {
  try {
    return toMinorUnits(value, currency);
  } catch {
    return '0';
  }
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, { ar: string; en: string }> = {
  cash: { ar: 'نقداً', en: 'Cash' },
  bank_transfer: { ar: 'تحويل بنكي', en: 'Bank transfer' },
  card: { ar: 'بطاقة', en: 'Card' },
  cheque: { ar: 'شيك', en: 'Cheque' },
};

function OwnerRequestItem({
  request,
  locale,
  focused,
  canRecordPayments,
  onChanged,
}: {
  request: OwnerTenantRequest;
  locale: 'ar' | 'en';
  focused: boolean;
  canRecordPayments: boolean;
  onChanged?: (() => void) | undefined;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const refresh = onChanged ?? (() => startRefresh(() => router.refresh()));
  const proofMissing = request.type === 'maintenance' ? closureProofMissing(request.media) : [];
  const [note, setNote] = useState('');
  const [date, setDate] = useState(request.proposedDate ?? '');
  const [charged, setCharged] = useState(false);
  const [amount, setAmount] = useState('');
  const [payment, setPayment] = useState<ChargePayment>('before_work');
  const [dueOn, setDueOn] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = OPEN_TENANT_REQUEST.has(request.status);
  const cheque = requestNeedsCheque(request.type);
  const currency = (request.currency ?? 'OMR') as CurrencyCode;

  async function act(action: Action) {
    if (
      (action === 'reject' || action === 'reply' || action === 'emergency_deny') &&
      !note.trim()
    ) {
      setError(ar ? 'اكتب ملاحظة للمستأجر أولاً.' : 'Write a note for the tenant first.');
      return;
    }
    let charge: { amountMinor: string; payment: ChargePayment; dueOn?: string } | undefined;
    if (action === 'approve' && charged) {
      const amountMinor = minorOf(amount, currency);
      if (amountMinor === '0' || (payment === 'deferred' && !dueOn)) {
        setError(
          ar
            ? 'أدخل تكلفة الصيانة، وتاريخ السداد إن كانت مؤجلة.'
            : 'Enter the maintenance cost, and the due date if deferred.',
        );
        return;
      }
      charge = { amountMinor, payment, ...(payment === 'deferred' ? { dueOn } : {}) };
    }
    setBusy(action);
    setError(null);
    try {
      await browserNextMutation(`/api/owner/tenant-requests/${encodeURIComponent(request.id)}`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          note: note.trim() || undefined,
          ...(action === 'approve' && request.type === 'cheque_postpone' && date ? { date } : {}),
          ...(charge ? { charge } : {}),
          ...(action === 'charge_paid' ? { method } : {}),
        }),
      });
      setNote('');
      setCharged(false);
      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
      refresh();
    } catch (caught) {
      setError(tenantRequestErrorText(caught instanceof ApiError ? caught.code : null, ar));
    } finally {
      setBusy(null);
    }
  }

  const property = ar
    ? request.propertyNameAr || request.propertyNameEn
    : request.propertyNameEn || request.propertyNameAr;

  return (
    <li
      id={`request-${request.id}`}
      className={`tenant-request${focused ? ' tenant-request--focus' : ''}`}
    >
      <RequestSummary
        request={request}
        ar={ar}
        locale={locale}
        extra={
          <>
            <div>
              <dt>{ar ? 'المستأجر' : 'Tenant'}</dt>
              <dd>{request.tenantName ?? '—'}</dd>
            </div>
            {property ? (
              <div>
                <dt>{ar ? 'العقار' : 'Property'}</dt>
                <dd>{property}</dd>
              </div>
            ) : null}
            {request.arrearsMinor ? (
              <div className="tenant-request__owes">
                <dt>{ar ? 'متأخرات على المستأجر' : 'Tenant’s arrears'}</dt>
                <dd>{formatMoney(request.arrearsMinor, currency, locale)}</dd>
              </div>
            ) : null}
          </>
        }
      />
      {request.charge && !request.charge.paidAt && canRecordPayments ? (
        <div className="tenant-request__charge-pay">
          <span>
            {ar
              ? `تكلفة الصيانة ${formatMoney(request.charge.amountMinor, request.charge.currency, locale)} غير مسددة بعد.`
              : `The maintenance cost of ${formatMoney(request.charge.amountMinor, request.charge.currency, locale)} is not paid yet.`}
          </span>
          <select
            className="input"
            value={method}
            aria-label={ar ? 'طريقة السداد' : 'Payment method'}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          >
            {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((item) => (
              <option key={item} value={item}>
                {ar ? PAYMENT_METHOD_LABEL[item].ar : PAYMENT_METHOD_LABEL[item].en}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button--primary button--tiny"
            disabled={busy !== null}
            onClick={() => void act('charge_paid')}
          >
            {ar ? 'تسجيل السداد' : 'Record payment'}
          </button>
        </div>
      ) : null}
      {open ? (
        <div className="tenant-request__act">
          {request.emergency && request.emergency.verified === null ? (
            <div className="tenant-request__verify">
              <strong>
                {ar ? 'طلب مستعجل — تحقّق من صحة الحالة' : 'Urgent request — verify the situation'}
              </strong>
              <div className="tenant-request__buttons">
                <button
                  type="button"
                  className="button button--primary button--tiny"
                  disabled={busy !== null}
                  onClick={() => void act('emergency_confirm')}
                >
                  {ar ? 'تأكيد أنه مستعجل' : 'Confirm urgent'}
                </button>
                <button
                  type="button"
                  className="button button--quiet button--tiny"
                  disabled={busy !== null}
                  onClick={() => void act('emergency_deny')}
                >
                  {ar ? 'ليس مستعجلاً (اكتب السبب)' : 'Not urgent (write why)'}
                </button>
              </div>
            </div>
          ) : null}
          {request.type === 'maintenance' && request.status === 'pending' && !request.charge ? (
            <fieldset className="tenant-request__cost">
              <label className="tenant-request-form__check">
                <input
                  type="checkbox"
                  checked={charged}
                  onChange={(event) => setCharged(event.target.checked)}
                />
                <span>
                  {ar
                    ? 'الصيانة على حساب المستأجر (تكلفة يدفعها)'
                    : 'The tenant pays for this maintenance'}
                </span>
              </label>
              {charged ? (
                <div className="tenant-request__cost-fields">
                  <label>
                    <span>{ar ? `التكلفة (${currency})` : `Cost (${currency})`}</span>
                    <input
                      className="input"
                      dir="ltr"
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
                    />
                  </label>
                  <label>
                    <span>{ar ? 'موعد السداد' : 'When to pay'}</span>
                    <select
                      className="input"
                      value={payment}
                      onChange={(event) => setPayment(event.target.value as ChargePayment)}
                    >
                      <option value="before_work">
                        {ar ? 'قبل تنفيذ العمل' : 'Before the work'}
                      </option>
                      <option value="deferred">
                        {ar ? 'تأجيل السداد إلى وقت لاحق' : 'Later (deferred)'}
                      </option>
                    </select>
                  </label>
                  {payment === 'deferred' ? (
                    <label>
                      <span>{ar ? 'يُسدد حتى' : 'Due by'}</span>
                      <input
                        className="input"
                        type="date"
                        dir="ltr"
                        value={dueOn}
                        onChange={(event) => setDueOn(event.target.value)}
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
            </fieldset>
          ) : null}
          {request.type === 'cheque_postpone' && request.status === 'pending' ? (
            <label className="tenant-request__date">
              <span>{ar ? 'تاريخ الشيك الجديد عند الموافقة' : 'New cheque date if approved'}</span>
              <input
                className="input"
                type="date"
                dir="ltr"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          ) : null}
          {request.type === 'maintenance' && request.status !== 'pending' ? (
            <ClosureProofPanel
              requestId={request.id}
              media={request.media}
              locale={locale}
              onAdded={refresh}
            />
          ) : null}
          <textarea
            className="input"
            rows={2}
            maxLength={Math.min(1000, NOTE_TRANSLATE_MAX)}
            placeholder={
              ar
                ? 'ملاحظة أو رد للمستأجر (مطلوب عند الرفض)…'
                : 'Note for the tenant (required to reject)…'
            }
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <NoteTranslateBar
            value={note}
            onChange={setNote}
            locale={locale}
            max={Math.min(1000, NOTE_TRANSLATE_MAX)}
            disabled={busy !== null}
            service={OWNER_NOTE_SERVICE}
          />
          <div className="tenant-request__buttons">
            {request.status === 'pending' ? (
              <button
                type="button"
                className="button button--primary button--tiny"
                disabled={busy !== null}
                onClick={() => void act('approve')}
              >
                {cheque
                  ? request.type === 'cheque_postpone'
                    ? ar
                      ? 'موافقة وتأجيل الشيك'
                      : 'Approve and move the cheque'
                    : ar
                      ? 'موافقة وإيقاف الشيك'
                      : 'Approve and stop the cheque'
                  : charged
                    ? ar
                      ? 'موافقة بتكلفة على المستأجر'
                      : 'Approve at the tenant’s cost'
                    : isTenantReport(request.type)
                      ? ar
                        ? 'تأكيد الاستلام والمتابعة'
                        : 'Acknowledge and follow up'
                      : ar
                        ? 'موافقة'
                        : 'Approve'}
              </button>
            ) : null}
            {!cheque && request.status !== 'in_progress' ? (
              <button
                type="button"
                className="button button--quiet button--tiny"
                disabled={busy !== null}
                onClick={() => void act('in_progress')}
              >
                {ar ? 'قيد التنفيذ' : 'In progress'}
              </button>
            ) : null}
            {!cheque && request.status !== 'pending' ? (
              <button
                type="button"
                className="button button--quiet button--tiny"
                disabled={busy !== null || proofMissing.length > 0}
                title={
                  proofMissing.length
                    ? ar
                      ? 'أرفق صورة بعد الإصلاح وسيلفي من أنجز العمل أولاً'
                      : 'Attach the after photo and the selfie first'
                    : undefined
                }
                onClick={() => void act('complete')}
              >
                {proofMissing.length
                  ? ar
                    ? '🔒 تم الإنجاز (يلزم الإثبات)'
                    : '🔒 Completed (proof needed)'
                  : ar
                    ? 'تم الإنجاز'
                    : 'Completed'}
              </button>
            ) : null}
            {request.status !== 'on_hold' ? (
              <button
                type="button"
                className="button button--quiet button--tiny"
                disabled={busy !== null}
                onClick={() => void act('on_hold')}
              >
                {ar ? 'تعليق' : 'On hold'}
              </button>
            ) : null}
            <button
              type="button"
              className="button button--quiet button--tiny"
              disabled={busy !== null}
              onClick={() => void act('reply')}
            >
              {ar ? 'رد فقط' : 'Reply only'}
            </button>
            <button
              type="button"
              className="button button--danger button--tiny"
              disabled={busy !== null}
              onClick={() => void act('reject')}
            >
              {ar ? 'رفض' : 'Reject'}
            </button>
          </div>
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function OwnerTenantRequests({
  requests,
  locale,
  focus,
  canRecordPayments,
  onChanged,
  showReports = true,
}: {
  requests: OwnerTenantRequest[];
  locale: 'ar' | 'en';
  focus: string | null;
  canRecordPayments: boolean;
  /** Reload after an action when the list is not server-rendered. */
  onChanged?: () => void;
  showReports?: boolean;
}) {
  const ar = locale === 'ar';
  const [filter, setFilter] = useState<'open' | 'reports' | 'all'>('open');
  const reports = requests.filter((item) => isTenantReport(item.type));
  const shown =
    filter === 'open'
      ? requests.filter((item) => OPEN_TENANT_REQUEST.has(item.status))
      : filter === 'reports'
        ? reports
        : requests;
  const openCount = requests.filter((item) => OPEN_TENANT_REQUEST.has(item.status)).length;

  useEffect(() => {
    if (!focus) return;
    document.getElementById(`request-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus]);

  return (
    <>
      <div className="tenant-requests__filter" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'open'}
          className={`button button--tiny ${filter === 'open' ? 'button--primary' : 'button--quiet'}`}
          onClick={() => setFilter('open')}
        >
          {ar ? `المفتوحة (${openCount})` : `Open (${openCount})`}
        </button>
        {showReports ? (
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'reports'}
            className={`button button--tiny ${filter === 'reports' ? 'button--primary' : 'button--quiet'}`}
            onClick={() => setFilter('reports')}
          >
            {ar ? `البلاغات (${reports.length})` : `Reports (${reports.length})`}
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={`button button--tiny ${filter === 'all' ? 'button--primary' : 'button--quiet'}`}
          onClick={() => setFilter('all')}
        >
          {ar ? `الكل (${requests.length})` : `All (${requests.length})`}
        </button>
      </div>
      {shown.length ? (
        <ul className="tenant-requests">
          {shown.map((request) => (
            <OwnerRequestItem
              key={request.id}
              request={request}
              locale={locale}
              focused={request.id === focus}
              canRecordPayments={canRecordPayments}
              onChanged={onChanged}
            />
          ))}
        </ul>
      ) : (
        <p className="dash-alerts__empty">
          {ar ? 'لا طلبات مفتوحة من المستأجرين الآن.' : 'No open tenant requests right now.'}
        </p>
      )}
    </>
  );
}
