'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Link } from '@/i18n/navigation';
import { DepositClaimsAdmin } from '@/components/accounting/deposit-claims-admin';
import { ModalPortal } from '@/components/modal-portal';
import { StayAvailabilityCalendar } from '@/components/stays/stay-availability-calendar';
import type { StayBookingPendingReschedule } from '@/components/stays/stay-booking-contract';
import { RejectStayNoteForm } from '@/components/stays/reject-stay-note-form';
import { ApiError, browserMutation, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { LIVE_CHANGE_EVENT } from '@/lib/live-sync-shared';
import { PENDING_APPROVALS_CHANGED_EVENT } from '@/lib/pending-approvals-shared';
import type { DepositClaimView } from '@/lib/stay-deposit-claims';
import { REFUND_NOTE_MAX } from '@/lib/stay-deposit-refund';
import { displayStayCheckoutOn } from '@/lib/stay-period-times';
import { stayTypeLabel } from '@/lib/ui-labels';

const CANCELABLE = new Set(['request_pending', 'payment_pending', 'confirmed', 'pre_arrival']);
const NO_SHOWABLE = new Set(['confirmed', 'pre_arrival']);

type CancelStep = 'note' | 'refund';

export function StayBookingDetailOps({
  locale,
  portal,
  bookingId,
  unitId,
  status,
  checkInOn,
  checkOutOn,
  stayListingSlug,
  propertyId,
  paidAmountMinor,
  paidCurrency,
  paymentSucceeded,
  pendingReschedule,
  currency,
  stayType,
  depositClaims = [],
  canReferDepositClaims = false,
  canDecideDepositClaims = false,
}: {
  locale: string;
  portal: 'owner' | 'developer';
  bookingId: string;
  unitId: string;
  status: string;
  checkInOn: string;
  checkOutOn: string;
  stayListingSlug?: string | null | undefined;
  propertyId: string;
  paidAmountMinor?: string | null | undefined;
  paidCurrency?: string | null | undefined;
  paymentSucceeded?: boolean | undefined;
  pendingReschedule?: StayBookingPendingReschedule | null | undefined;
  currency?: string | null | undefined;
  stayType?: string | null | undefined;
  depositClaims?: DepositClaimView[];
  canReferDepositClaims?: boolean;
  canDecideDepositClaims?: boolean;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [claimNotice, setClaimNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [reschedule, setReschedule] = useState(pendingReschedule ?? null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveConfirm, setApproveConfirm] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelStep, setCancelStep] = useState<CancelStep>('note');
  const [note, setNote] = useState('');
  const [refundDecision, setRefundDecision] = useState<'refund' | 'keep' | null>(null);

  const canCancel = CANCELABLE.has(currentStatus);
  const canNoShow = NO_SHOWABLE.has(currentStatus);
  const isReject = currentStatus === 'request_pending';
  const amountMinor =
    typeof paidAmountMinor === 'string' && /^\d+$/.test(paidAmountMinor) && BigInt(paidAmountMinor) > 0n
      ? paidAmountMinor
      : null;
  const paid = paymentSucceeded === true && Boolean(amountMinor);
  const paidLabel =
    paid && amountMinor && paidCurrency
      ? formatMoney(amountMinor, paidCurrency, locale === 'en' ? 'en' : 'ar')
      : null;

  const rejectLabel = isReject
    ? ar
      ? 'رفض الطلب'
      : 'Reject request'
    : ar
      ? 'إلغاء الحجز'
      : 'Cancel booking';

  function openCancel() {
    setError(null);
    setNote('');
    setRefundDecision(null);
    setCancelStep('note');
    setCancelOpen(true);
  }

  function closeCancel() {
    if (busy || pending) return;
    setCancelOpen(false);
  }

  function continueFromNote() {
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      setError(ar ? 'أدخل ملاحظة عن السبب (٣ أحرف على الأقل).' : 'Enter a reason (at least 3 characters).');
      return;
    }
    setError(null);
    if (paid) {
      setCancelStep('refund');
      return;
    }
    void submitCancel(null);
  }

  async function submitCancel(decision: 'refund' | 'keep' | null) {
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      setError(ar ? 'أدخل ملاحظة عن السبب.' : 'Enter a reason note.');
      setCancelStep('note');
      return;
    }
    if (paid && decision !== 'refund' && decision !== 'keep') {
      setError(
        ar ? 'اختر استرجاع المبلغ أو خصمه.' : 'Choose whether to refund or keep the payment.',
      );
      setCancelStep('refund');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const payload = await browserNextMutation<{ id: string; status: string }>(
        `/api/owner/stays/bookings/${encodeURIComponent(bookingId)}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({
            note: trimmed,
            ...(paid && decision ? { refundDecision: decision } : {}),
          }),
        },
      );
      setCurrentStatus(payload.status ?? 'cancelled');
      setCancelOpen(false);
      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
      window.dispatchEvent(new Event('bhd-r-live-change'));
      startTransition(() => router.refresh());
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : '';
      setError(
        code === 'cancel_note_required'
          ? ar
            ? 'أدخل ملاحظة عن السبب.'
            : 'Enter a reason note.'
          : code === 'refund_decision_required'
            ? ar
              ? 'اختر استرجاع المبلغ أو خصمه.'
              : 'Choose refund or keep.'
            : caught instanceof ApiError
              ? caught.message
              : ar
                ? 'فشل تحديث الحجز'
                : 'Failed to update booking',
      );
    } finally {
      setBusy(false);
    }
  }

  async function runNoShow() {
    const confirmMessage = ar ? 'تأكيد عدم حضور الضيف؟' : 'Mark guest as no-show?';
    if (!window.confirm(confirmMessage)) return;

    setError(null);
    setBusy(true);
    try {
      const result = await browserMutation<{ id: string; status: string }>(
        `/v1/stays/bookings/${encodeURIComponent(bookingId)}/no-show`,
        { method: 'POST', body: '{}' },
      );
      setCurrentStatus(result.status);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : ar
            ? 'فشل تحديث الحجز'
            : 'Failed to update booking',
      );
    } finally {
      setBusy(false);
    }
  }

  async function decideReschedule(
    action: 'approve_reschedule' | 'reject_reschedule',
    note?: string | null,
  ) {
    if (!reschedule) return;

    setError(null);
    setBusy(true);
    try {
      const result = await browserNextMutation<{
        applied?: boolean;
        awaitsGuestPayment?: boolean;
      }>(`/api/owner/properties/${encodeURIComponent(propertyId)}/records`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          bookingId,
          ...(action === 'reject_reschedule' && note ? { note } : {}),
        }),
      });
      window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
      window.dispatchEvent(new Event(LIVE_CHANGE_EVENT));
      if (action === 'reject_reschedule' || result.applied) {
        setReschedule(null);
        setRejectOpen(false);
        setApproveConfirm(false);
      } else if (result.awaitsGuestPayment && reschedule) {
        setReschedule({ ...reschedule, status: 'awaiting_guest_payment' });
        setApproveConfirm(false);
      }
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : ar
            ? 'فشل تحديث طلب التعديل'
            : 'Failed to update the date-change request',
      );
    } finally {
      setBusy(false);
    }
  }

  const fromDisplayOut = displayStayCheckoutOn(stayType, checkInOn, checkOutOn);
  const toDisplayOut = reschedule
    ? displayStayCheckoutOn(reschedule.stayType, reschedule.checkInOn, reschedule.checkOutOn)
    : null;

  const moneyCurrency = currency ?? paidCurrency ?? 'OMR';

  return (
    <section className="stay-booking-ops" aria-label={ar ? 'مراجعة تشغيلية' : 'Ops review'}>
      {reschedule ? (
        <div className="stay-booking-ops__change" role="region" aria-label={ar ? 'تعديل التواريخ' : 'Date change'}>
          <h2>
            {reschedule.status === 'awaiting_owner'
              ? ar
                ? 'طلب تعديل التواريخ بانتظار اعتمادك'
                : 'Date change awaiting your approval'
              : ar
                ? 'تعديل التواريخ بانتظار دفع الضيف'
                : 'Date change awaiting guest payment'}
          </h2>
          <table className="stay-booking-ops__change-table">
            <thead>
              <tr>
                <th>{ar ? 'البيان' : 'Item'}</th>
                <th>{ar ? 'من' : 'From'}</th>
                <th>{ar ? 'إلى' : 'To'}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{ar ? 'الفترة' : 'Dates'}</th>
                <td className="is-from" dir="ltr">
                  {checkInOn}
                  {fromDisplayOut !== checkInOn.slice(0, 10) ? ` → ${fromDisplayOut}` : ''}
                </td>
                <td className="is-to" dir="ltr">
                  {reschedule.checkInOn}
                  {toDisplayOut && toDisplayOut !== reschedule.checkInOn.slice(0, 10)
                    ? ` → ${toDisplayOut}`
                    : ''}
                </td>
              </tr>
              <tr>
                <th scope="row">{ar ? 'نوع الإقامة' : 'Stay type'}</th>
                <td className="is-from">
                  {stayType ? stayTypeLabel(stayType, ar) : '—'}
                </td>
                <td className="is-to">{stayTypeLabel(reschedule.stayType, ar)}</td>
              </tr>
              {reschedule.extraDueMinor !== '0' ? (
                <tr>
                  <th scope="row">{ar ? 'فرق الدفع' : 'Top-up'}</th>
                  <td>—</td>
                  <td className="is-to" dir="ltr">
                    {formatMoney(reschedule.extraDueMinor, moneyCurrency, locale === 'en' ? 'en' : 'ar')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {reschedule.status === 'awaiting_owner' ? (
            <div className="stay-booking-ops__change-actions">
              {!approveConfirm ? (
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy || pending}
                  onClick={() => {
                    setRejectOpen(false);
                    setApproveConfirm(true);
                  }}
                >
                  {ar ? 'اعتماد التعديل' : 'Approve change'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={busy || pending}
                    onClick={() => void decideReschedule('approve_reschedule')}
                  >
                    {busy
                      ? ar
                        ? 'جارٍ…'
                        : 'Working…'
                      : ar
                        ? 'تأكيد الاعتماد'
                        : 'Confirm approval'}
                  </button>
                  <button
                    type="button"
                    className="button button--quiet"
                    disabled={busy || pending}
                    onClick={() => setApproveConfirm(false)}
                  >
                    {ar ? 'رجوع' : 'Back'}
                  </button>
                </>
              )}
              <button
                type="button"
                className="button button--quiet"
                disabled={busy || pending}
                aria-expanded={rejectOpen}
                onClick={() => {
                  setApproveConfirm(false);
                  setRejectOpen((open) => !open);
                }}
              >
                {ar ? 'رفض التعديل' : 'Reject change'}
              </button>
            </div>
          ) : null}
          {rejectOpen && reschedule.status === 'awaiting_owner' ? (
            <RejectStayNoteForm
              kind="reschedule"
              reference={bookingId.slice(0, 8).toUpperCase()}
              locale={locale === 'en' ? 'en' : 'ar'}
              busy={busy || pending}
              fromRange={
                fromDisplayOut !== checkInOn.slice(0, 10)
                  ? `${checkInOn} → ${fromDisplayOut}`
                  : checkInOn
              }
              toRange={
                toDisplayOut && toDisplayOut !== reschedule.checkInOn.slice(0, 10)
                  ? `${reschedule.checkInOn} → ${toDisplayOut}`
                  : reschedule.checkInOn
              }
              onConfirm={(note) => void decideReschedule('reject_reschedule', note)}
              onCancel={() => setRejectOpen(false)}
            />
          ) : null}
        </div>
      ) : null}

      <div className="stay-booking-ops__links">
        <Link className="button button--quiet" href={`/${portal}/properties/${propertyId}`}>
          {ar ? 'تفاصيل العقار في البوابة' : 'Property in portal'}
        </Link>
        <Link className="button button--quiet" href={`/${portal}/stays/calendar`}>
          {ar ? 'التقويم الكامل للإقامات' : 'Full stays calendar'}
        </Link>
        {stayListingSlug ? (
          <a
            className="button button--quiet"
            href={`/${locale === 'en' ? 'en' : 'ar'}/stays/${stayListingSlug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ar ? 'صفحة العقار العامة' : 'Public stay page'}
          </a>
        ) : (
          <a
            className="button button--quiet"
            href={`/${locale === 'en' ? 'en' : 'ar'}/properties/${propertyId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ar ? 'عرض العقار للعامة' : 'Public property page'}
          </a>
        )}
      </div>

      {(canCancel || canNoShow) && currentStatus !== 'cancelled' && currentStatus !== 'no_show' ? (
        <div className="stay-booking-ops__actions">
          {canCancel ? (
            <button
              type="button"
              className="button button--danger"
              disabled={busy || pending}
              onClick={openCancel}
            >
              {busy ? (ar ? 'جارٍ…' : 'Working…') : rejectLabel}
            </button>
          ) : null}
          {canNoShow ? (
            <button
              type="button"
              className="button button--quiet"
              disabled={busy || pending}
              onClick={() => void runNoShow()}
            >
              {ar ? 'عدم حضور' : 'No-show'}
            </button>
          ) : null}
        </div>
      ) : null}

      {error && !cancelOpen ? (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      ) : null}

      {cancelOpen ? (
        <ModalPortal onClose={closeCancel}>
          <div
            className="ops-modal guest-stay-dialog guest-stay-dialog--cancel"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeCancel();
            }}
          >
            <section
              className="ops-modal__card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="owner-cancel-title"
              dir={ar ? 'rtl' : 'ltr'}
            >
              <header>
                <div>
                  <span className="ops-kicker">
                    {cancelStep === 'refund'
                      ? ar
                        ? 'الخطوة ٢ من ٢'
                        : 'Step 2 of 2'
                      : paid
                        ? ar
                          ? 'الخطوة ١ من ٢'
                          : 'Step 1 of 2'
                        : ar
                          ? 'تأكيد'
                          : 'Confirm'}
                  </span>
                  <h2 id="owner-cancel-title">
                    {cancelStep === 'refund'
                      ? ar
                        ? 'المبلغ المدفوع'
                        : 'Paid amount'
                      : rejectLabel}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeCancel}
                  disabled={busy || pending}
                  aria-label={ar ? 'إغلاق' : 'Close'}
                >
                  ×
                </button>
              </header>

              <div className="guest-stay-dialog__body">
                {cancelStep === 'note' ? (
                  <>
                    <p className="muted">
                      {isReject
                        ? ar
                          ? 'اكتب سبب عدم قبول الطلب. سيُلغى الحجز ويتحرّر التاريخ فوراً.'
                          : 'Enter why you are rejecting. The booking will cancel and the dates free immediately.'
                        : ar
                          ? 'اكتب سبب الإلغاء. سيتحرّر العقار فوراً بعد التأكيد.'
                          : 'Enter the cancellation reason. The unit frees immediately after confirm.'}
                    </p>
                    <label className="field">
                      <span>{ar ? 'الملاحظة / السبب' : 'Note / reason'}</span>
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={REFUND_NOTE_MAX}
                        rows={4}
                        required
                        disabled={busy || pending}
                        placeholder={
                          ar ? 'مثال: تعارض في التواريخ / طلب الضيف…' : 'e.g. date conflict / guest request…'
                        }
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <div className="guest-stay-dialog__warning" role="note">
                      <strong>{ar ? 'تأكيد بخصوص المبلغ' : 'Confirm the payment outcome'}</strong>
                      <p>
                        {ar
                          ? `المبلغ المدفوع ${paidLabel ?? ''}. اختر إرجاعه للضيف (سيظهر طلب للمحاسب) أو خصمه دون إرجاع.`
                          : `Paid amount ${paidLabel ?? ''}. Refund to the guest (creates an accountant request) or keep it.`}
                      </p>
                    </div>
                    <div className="stay-booking-ops__refund-choices" role="group">
                      <button
                        type="button"
                        className={`button ${refundDecision === 'refund' ? 'button--primary' : 'button--quiet'}`}
                        disabled={busy || pending}
                        onClick={() => setRefundDecision('refund')}
                      >
                        {ar ? 'استرجاع المبلغ' : 'Refund the payment'}
                      </button>
                      <button
                        type="button"
                        className={`button ${refundDecision === 'keep' ? 'button--danger' : 'button--quiet'}`}
                        disabled={busy || pending}
                        onClick={() => setRefundDecision('keep')}
                      >
                        {ar ? 'خصم المبلغ (لا يُسترد)' : 'Keep the payment (no refund)'}
                      </button>
                    </div>
                    {refundDecision === 'keep' ? (
                      <p className="muted">
                        {ar
                          ? 'سيظهر للضيف أن الحجز ملغى وأن المبلغ لا يُسترد مع ملاحظتك.'
                          : 'The guest will see the booking is cancelled, payment is kept, and your note.'}
                      </p>
                    ) : null}
                    {refundDecision === 'refund' ? (
                      <p className="muted">
                        {ar
                          ? 'سيظهر للمحاسب طلب إرجاع المبلغ المدفوع.'
                          : 'Accounting will see a request to return the paid amount.'}
                      </p>
                    ) : null}
                  </>
                )}

                {error ? (
                  <p className="field__error" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>

              <footer className="ops-modal__actions">
                {cancelStep === 'refund' ? (
                  <button
                    type="button"
                    className="button button--quiet"
                    disabled={busy || pending}
                    onClick={() => {
                      setError(null);
                      setCancelStep('note');
                    }}
                  >
                    {ar ? 'رجوع' : 'Back'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button--quiet"
                    disabled={busy || pending}
                    onClick={closeCancel}
                  >
                    {ar ? 'إلغاء' : 'Dismiss'}
                  </button>
                )}
                {cancelStep === 'note' ? (
                  <button
                    type="button"
                    className="button button--danger"
                    disabled={busy || pending || note.trim().length < 3}
                    onClick={() => void continueFromNote()}
                  >
                    {busy
                      ? ar
                        ? 'جارٍ…'
                        : 'Working…'
                      : paid
                        ? ar
                          ? 'متابعة'
                          : 'Continue'
                        : ar
                          ? 'تأكيد'
                          : 'Confirm'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button--danger"
                    disabled={busy || pending || !refundDecision}
                    onClick={() => void submitCancel(refundDecision)}
                  >
                    {busy ? (ar ? 'جارٍ…' : 'Working…') : ar ? 'تأكيد الإلغاء' : 'Confirm cancel'}
                  </button>
                )}
              </footer>
            </section>
          </div>
        </ModalPortal>
      ) : null}

      {depositClaims.length ? (
        <div className="stay-booking-ops__claims">
          {claimNotice ? (
            <p
              className={`notice notice--${claimNotice.tone === 'error' ? 'error' : 'success'}`}
              role={claimNotice.tone === 'error' ? 'alert' : 'status'}
            >
              {claimNotice.text}
            </p>
          ) : null}
          <DepositClaimsAdmin
            claims={depositClaims}
            currency={currency || paidCurrency || 'OMR'}
            canRefer={canReferDepositClaims}
            canDecide={canDecideDepositClaims}
            locale={locale === 'en' ? 'en' : 'ar'}
            preferOpen
            onDone={(next, reload) => {
              setClaimNotice(next);
              if (!reload) return;
              window.dispatchEvent(new Event(PENDING_APPROVALS_CHANGED_EVENT));
              router.refresh();
            }}
          />
        </div>
      ) : null}

      <div className="stay-booking-ops__calendar">
        <h2>{ar ? 'تقويم الوحدة حول هذا الحجز' : 'Unit calendar around this booking'}</h2>
        <p className="muted">
          {ar
            ? 'الأيام المحددة أدناه هي فترة هذا الحجز. راجع الحجوزات المجاورة قبل القبول أو الرفض.'
            : 'Highlighted dates are this booking. Review neighbors before accepting or rejecting.'}
        </p>
        <StayAvailabilityCalendar
          locale={locale}
          mode="ops"
          unitId={unitId}
          monthCount={2}
          size="large"
          selectedCheckIn={checkInOn}
          selectedCheckOut={checkOutOn}
        />
      </div>
    </section>
  );
}
