'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from 'react';

import { DocFileThumb } from '@/components/doc-file-thumb';
import { FilePreviewDialog, type PreviewFile } from '@/components/file-preview';
import {
  LeaseContractForm,
  type LeaseBankAccountOption,
  type LeaseContractPayload,
} from '@/components/lease-contract-form';
import { LeaseRequirementsPicker } from '@/components/lease-requirements-picker';
import { DocStatusMark, docStatusLabel } from '@/components/doc-status-mark';
import { NoteTranslateBar, OWNER_NOTE_SERVICE } from '@/components/note-translate';
import { compressPhoto } from '@/components/stays/stay-handover-form';
import { ApiError, browserNextMutation } from '@/lib/api';
import {
  bankAccountPayeeName,
  resolveRentBankAccount,
  type AccountingSettings,
} from '@/lib/accounting-integrity';
import { formatMoney } from '@/lib/format';
import { NOTE_TRANSLATE_MAX } from '@/lib/note-translation';
import { HANDOVER_PHOTO_MAX } from '@/lib/stay-handover';

const BOOKING_NOTE_MAX = Math.min(1000, NOTE_TRANSLATE_MAX);
import type { ApprovalPolicy } from '@/lib/approval-policy';
import { DEFAULT_LEASE_DOCUMENT_RULES, type LeaseDocumentRules } from '@/lib/lease-document-rules';
import { buildBookingLeaseTermsDraft } from '@/lib/lease-terms-draft-from';
import {
  BOOKING_IDENTITY_DOC_LABELS,
  bookingIdentityFileKind,
  chequesToVerify,
  documentsPhase,
  documentsToVerify,
  bookingDocsReturnOpen,
  handoverBlockedByUnverifiedDocs,
  leaseJourneyStageIndex,
  leaseJourneyStageLabels,
  leasePhaseLabel,
  listBookingIdentityDocs,
  packageNeedsManualVerification,
  REQUIREMENT_CATALOGUE,
  type BookingIdentityDocCode,
  type LeaseJourneyPhase,
  type ReservationChequeSubmission,
  type ReservationLifecycle,
  type ReservationRequirement,
} from '@/lib/lease-reservation-lifecycle';
import { minorDigitsFor, type LeaseTermsDraft } from '@/lib/lease-terms';
import { PartyNationalityTag } from '@/components/party-nationality-tag';
import {
  partyDisplayName,
  partyToLeaseTenant,
  type ReservationParty,
} from '@/lib/reservation-party';
import type { PropertyRecordTenant, PropertyRecordUnit } from '@/lib/property-records-neon';

const ERROR_TEXT: Record<string, [string, string]> = {
  forbidden: [
    'لا تملك صلاحية هذا الإجراء. يلزم صلاحية إدارة الحجوزات (واعتماد العقود لاعتماد العقد).',
    'You do not have permission for this step.',
  ],
  reservation_not_ready: [
    'هذه الخطوة غير متاحة في المرحلة الحالية — حدّث الصفحة.',
    'This step is not open at the current stage — refresh the page.',
  ],
  reservation_closed: ['هذا الحجز ملغى أو منتهٍ.', 'This booking is cancelled or expired.'],
  unit_already_reserved: [
    'لا يمكن الاسترجاع: توجد حجز نشط آخر على نفس الوحدة.',
    'Cannot restore: another active booking already holds this unit.',
  ],
  documents_incomplete: [
    'لم تكتمل المستندات المطلوبة أو لم تُراجع كلها بعد.',
    'Required documents are missing or not all reviewed yet.',
  ],
  requirements_invalid: [
    'تحقّق من قائمة المستندات المطلوبة.',
    'Check the required documents list.',
  ],
  handover_invalid: ['أدخل تاريخ التسليم واسم المستلم.', 'Enter the handover date and recipient.'],
  municipal_registration_invalid: [
    'أدخل رقم استمارة العقد البلدي ورقم العقد البلدي.',
    'Enter the municipal form number and municipal contract number.',
  ],
  lease_overlap: [
    'يوجد عقد إيجار آخر على الوحدة في نفس الفترة.',
    'Another lease overlaps this period on the unit.',
  ],
  cheque_number_taken: ['رقم شيك مستخدم من قبل.', 'A cheque number is already used.'],
  meters_required: [
    'أدخل قراءات الكهرباء والماء، أو أجّلها حتى التسليم من سياسة الاعتماد.',
    'Enter electricity and water readings, or defer them until handover in the approval policy.',
  ],
  handover_required: ['أدخل تاريخ التسليم.', 'Enter the handover date.'],
  bank_account_required: [
    'اختر حساب البنك واسم المستفيد للشيكات.',
    'Choose the bank account and cheque payee name.',
  ],
  invalid_amount: ['المبلغ غير صحيح.', 'The amount is invalid.'],
  invalid_dates: ['تحقّق من التواريخ.', 'Check the dates.'],
  invalid_schedule: ['جدول الدفع غير مكتمل.', 'The payment schedule is incomplete.'],
  invalid_terms: ['تحقّق من بنود العقد.', 'Check the contract terms.'],
  invalid_body: ['البيانات غير مكتملة.', 'Incomplete data.'],
};

export type LeaseReservationWorkflowProps = {
  reservationId: string;
  referenceCode: string;
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  mode: 'rent' | 'sale';
  phase: LeaseJourneyPhase;
  lifecycle: ReservationLifecycle;
  propertyId: string;
  unit: PropertyRecordUnit;
  tenant: PropertyRecordTenant;
  /** Tenant or buyer details the customer filled in while booking. */
  party: ReservationParty | null;
  salePriceMinor: string | null;
  currency: string;
  depositLabel: string;
  /** Paid arabon amount in minor units — frozen after payment. */
  depositMinor: string;
  depositPaidAt: string | null;
  termsAcceptedAt: string | null;
  hasEsign: boolean;
  canManage: boolean;
  canSign: boolean;
  /** Controlled stepper review index (completed stage), or null for the live stage. */
  viewing?: number | null | undefined;
  onViewingChange?: ((next: number | null) => void) | undefined;
};

type Props = LeaseReservationWorkflowProps;

const PreviewContext = createContext<(file: PreviewFile) => void>(() => undefined);

function ViewFileButton({ href, label, ar }: { href: string; label: string; ar: boolean }) {
  const preview = useContext(PreviewContext);
  return (
    <button type="button" className="button button--quiet" onClick={() => preview({ href, label })}>
      {ar ? 'عرض الملف' : 'View file'}
    </button>
  );
}

/** A decision shown before the server confirms it; dropped once the page reflects it. */
type DocumentDecision = Pick<ReservationRequirement, 'status' | 'verifiedAt' | 'note'>;

function decisionSettled(item: ReservationRequirement, decision: DocumentDecision): boolean {
  return decision.verifiedAt ? Boolean(item.verifiedAt) : item.status === decision.status;
}

function errorText(error: unknown, ar: boolean): string {
  if (error instanceof ApiError) {
    const known = ERROR_TEXT[error.code];
    if (known) return known[ar ? 0 : 1];
    return error.message;
  }
  return ar ? 'تعذّر إكمال الطلب. أعد المحاولة.' : 'Could not complete the request. Try again.';
}

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date());
}

function decimal(minor: string | null, digits: number): string {
  if (!minor || !/^\d+$/.test(minor)) return '';
  const padded = minor.padStart(digits + 1, '0');
  const whole = padded.slice(0, padded.length - digits);
  const fraction = padded.slice(padded.length - digits).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

const STATUS_TEXT: Record<ReservationRequirement['status'], [string, string]> = {
  pending: ['بانتظار العميل', 'Awaiting client'],
  submitted: ['بانتظار مراجعتك', 'Awaiting your review'],
  approved: ['مقبول', 'Accepted'],
  rejected: ['مرفوض — بانتظار بديل', 'Rejected — awaiting a new file'],
};

function requirementStatusText(item: ReservationRequirement, ar: boolean): string {
  if (item.autoApproved && item.status === 'approved') {
    return item.verifiedAt
      ? ar
        ? 'قُبل إلكترونياً وتحقّق منه الفريق ✓'
        : 'Accepted electronically, verified by the team ✓'
      : ar
        ? 'قُبل إلكترونياً — بانتظار تحقق الفريق'
        : 'Accepted electronically — awaiting team verification';
  }
  return STATUS_TEXT[item.status][ar ? 0 : 1];
}

function cancelReasonText(
  reason: NonNullable<ReservationLifecycle['cancellation']>['reason'],
  ar: boolean,
): string {
  return reason === 'documents_invalid'
    ? ar
      ? 'أُلغي الحجز لأن المستندات المرفوعة خالفت الاشتراطات أو لم تكن ملائمة، وأُلغي العقد المرتبط به إن وُجد.'
      : 'Cancelled because the uploaded documents broke the requirements or were unsuitable; any linked contract was voided.'
    : ar
      ? 'أُلغي الحجز لعدم استلام مبلغ العربون.'
      : 'Cancelled because the deposit was not received.';
}

function RestoreCancelledBooking({
  locale,
  busy,
  canManage,
  cancellation,
  onRestore,
}: {
  locale: 'ar' | 'en';
  busy: boolean;
  canManage: boolean;
  cancellation: NonNullable<ReservationLifecycle['cancellation']>;
  onRestore: (note: string) => Promise<void>;
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  return (
    <div className="lrw__card lrw__card--cancelled">
      <h3>{t('الحجز ملغى', 'Booking cancelled')}</h3>
      <p>{cancelReasonText(cancellation.reason, ar)}</p>
      {cancellation.note ? (
        <p className="muted">
          {t('الملاحظة المرسلة للعميل: ', 'Note sent to the client: ')}
          {cancellation.note}
        </p>
      ) : null}
      <p className="muted">
        {new Date(cancellation.at).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
          timeZone: 'Asia/Muscat',
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
        {cancellation.byName ? ` · ${cancellation.byName}` : ''}
      </p>
      {canManage ? (
        open ? (
          <form
            className="lrw__reject"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (note.trim().length < 2) return;
              void onRestore(note.trim()).then(() => {
                setOpen(false);
                setNote('');
              });
            }}
          >
            <label htmlFor="restore-booking-note">
              {t('سبب الاسترجاع (يظهر للعميل)', 'Reason for restore (shown to the client)')}
            </label>
            <textarea
              id="restore-booking-note"
              className="textarea"
              rows={3}
              maxLength={BOOKING_NOTE_MAX}
              required
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t(
                'مثال: رُفض المستند بالخطأ — يُعاد فتح الحجز لرفع بديل',
                'e.g. Document was rejected by mistake — reopening so a replacement can be uploaded',
              )}
            />
            <NoteTranslateBar
              value={note}
              onChange={setNote}
              locale={locale}
              max={BOOKING_NOTE_MAX}
              disabled={busy}
              service={OWNER_NOTE_SERVICE}
            />
            <p className="notice notice--info">
              {t(
                'يُعاد فتح الحجز ويُبلَّغ العميل. إن وُجد عقد ملغى يبقى ملغى ويُستكمل المسار من المستندات/العقد.',
                'The booking reopens and the client is notified. A voided contract stays void; the journey continues from documents/contract.',
              )}
            </p>
            <button
              type="submit"
              className="button button--primary"
              disabled={busy || note.trim().length < 2}
            >
              {busy
                ? t('جارٍ الاسترجاع…', 'Restoring…')
                : t('تأكيد استرجاع الحجز', 'Confirm restore booking')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setNote('');
              }}
            >
              {t('إلغاء', 'Cancel')}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => setOpen(true)}
          >
            {t('استرجاع الحجز', 'Restore booking')}
          </button>
        )
      ) : null}
    </div>
  );
}

const OWNER_BOOKING_ACTION_PHASES = new Set<LeaseJourneyPhase>([
  'awaiting_owner_approval',
  'awaiting_contract_draft',
  'awaiting_documents',
  'awaiting_documents_review',
  'awaiting_contract_approval',
  'awaiting_tenant_signature',
]);

/**
 * Return the booking for document fixes, or cancel it — available before handover while
 * the owner still controls the journey (including while preparing the contract).
 */
function OwnerBookingActionsCard({
  locale,
  phase,
  canManage,
  busy,
  hasIssuedContract,
  hasEsign,
  party,
  fileHref,
  onReturnDocs,
  onCancel,
}: {
  locale: 'ar' | 'en';
  phase: LeaseJourneyPhase;
  canManage: boolean;
  busy: boolean;
  hasIssuedContract: boolean;
  hasEsign: boolean;
  party: ReservationParty | null;
  fileHref: (file: string) => string;
  onReturnDocs: (note: string, rejected: BookingIdentityDocCode[]) => Promise<void>;
  onCancel: (note: string) => Promise<void>;
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const preview = useContext(PreviewContext);
  const [mode, setMode] = useState<'return' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const [rejected, setRejected] = useState<Set<BookingIdentityDocCode>>(() => new Set());
  const identityDocs = useMemo(
    () => listBookingIdentityDocs({ hasEsign, party }),
    [hasEsign, party],
  );

  if (!canManage || !OWNER_BOOKING_ACTION_PHASES.has(phase)) return null;
  const canReturn =
    !hasIssuedContract && phase !== 'awaiting_tenant_signature' && identityDocs.length > 0;
  const returnReady = note.trim().length >= 2 && rejected.size > 0;

  function toggleRejected(code: BookingIdentityDocCode) {
    setRejected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  return (
    <div className="lrw__card lrw__card--action">
      <h3>{t('إجراء على الحجز', 'Booking action')}</h3>
      <p className="muted">
        {t(
          'إن كانت مستندات الحجز أو الهوية غير مطابقة للاشتراطات، اختر المستندات المطلوب تعديلها وأرجعها للعميل، أو ألغِ الحجز عند المخالفة الجسيمة.',
          'If booking or identity documents break the rules, select the ones that need fixing and return them, or cancel the booking for a serious violation.',
        )}
      </p>
      <div className="form-actions" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        {canReturn ? (
          <button
            type="button"
            className="button button--secondary"
            disabled={busy}
            onClick={() => {
              setMode(mode === 'return' ? null : 'return');
              setNote('');
              setRejected(new Set());
            }}
          >
            {t('طلب تعديل مستندات الحجز', 'Request booking document fixes')}
          </button>
        ) : null}
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => {
            setMode(mode === 'cancel' ? null : 'cancel');
            setNote('');
            setRejected(new Set());
          }}
        >
          {t('إلغاء الحجز', 'Cancel booking')}
        </button>
      </div>
      {mode ? (
        <form
          className="lrw__reject"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (note.trim().length < 2) return;
            const text = note.trim();
            if (mode === 'return') {
              if (!rejected.size) return;
              void onReturnDocs(text, [...rejected]).then(() => {
                setMode(null);
                setNote('');
                setRejected(new Set());
              });
              return;
            }
            void onCancel(text).then(() => {
              setMode(null);
              setNote('');
              setRejected(new Set());
            });
          }}
        >
          {mode === 'return' ? (
            <div className="lrw__return-docs">
              <p className="lrw__return-docs-lead">
                {t(
                  'اختر المستندات المطلوب تعديلها. الباقي يُعتمد ويُقفل فلا يستطيع العميل تغييره.',
                  'Select the documents that must be fixed. The rest stay approved and locked so the client cannot change them.',
                )}
              </p>
              <ul className="lrw__return-docs-list">
                {identityDocs.map((code) => {
                  const labels = BOOKING_IDENTITY_DOC_LABELS[code];
                  const label = ar ? labels.ar : labels.en;
                  const selected = rejected.has(code);
                  const href = fileHref(bookingIdentityFileKind(code));
                  return (
                    <li
                      key={code}
                      className={`lrw__return-doc${selected ? ' lrw__return-doc--fix' : ' lrw__return-doc--lock'}`}
                    >
                      <button
                        type="button"
                        className="lrw__return-doc-thumb"
                        onClick={() => preview({ href, label })}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={href} alt={label} loading="lazy" />
                      </button>
                      <div className="lrw__return-doc-main">
                        <strong>{label}</strong>
                        <span className="muted">
                          {selected
                            ? t('يُعاد للعميل للتعديل', 'Returned for the client to fix')
                            : t('معتمد — يُقفل عند العميل', 'Approved — locked for the client')}
                        </span>
                      </div>
                      <label className="lrw__return-doc-toggle">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={busy}
                          onChange={() => toggleRejected(code)}
                        />
                        <span>{t('يحتاج تعديلاً', 'Needs a fix')}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <label htmlFor="owner-booking-action-note">
            {mode === 'return'
              ? t(
                  'ملاحظة التعديل للمستندات المختارة (تظهر للعميل)',
                  'Fix note for the selected documents (shown to the client)',
                )
              : t('سبب الإلغاء (يظهر للعميل)', 'Cancellation reason (shown to the client)')}
          </label>
          <textarea
            id="owner-booking-action-note"
            className="textarea"
            rows={3}
            maxLength={BOOKING_NOTE_MAX}
            required
            value={note}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              mode === 'return'
                ? t('مثال: صورة الهوية الأمامية غير واضحة', 'e.g. The front ID photo is unclear')
                : t(
                    'مثال: المستندات مخالفة للاشتراطات ولا يمكن قبول الحجز',
                    'e.g. Documents break the requirements and the booking cannot proceed',
                  )
            }
          />
          <NoteTranslateBar
            value={note}
            onChange={setNote}
            locale={locale}
            max={BOOKING_NOTE_MAX}
            disabled={busy}
            service={OWNER_NOTE_SERVICE}
          />
          {mode === 'return' ? (
            <p className="notice notice--info">
              {t(
                'المستندات المختارة تُعاد للعميل مع ملاحظةك؛ المعتمدة تُقفل. العربون يبقى محفوظاً ولن يُعتمد الحجز تلقائياً حتى تراجعه أنت.',
                'Selected documents go back with your note; approved ones stay locked. The deposit is kept and auto-approval stays off until you review.',
              )}
            </p>
          ) : (
            <p className="notice notice--danger">
              {t(
                'سيُلغى الحجز فوراً ويُلغى أي عقد مرتبط إن وُجد، ويُبلَّغ العميل.',
                'The booking is cancelled at once; any linked contract is voided and the client is notified.',
              )}
            </p>
          )}
          <div className="form-actions">
            <button
              type="submit"
              className={mode === 'cancel' ? 'button button--danger' : 'button button--primary'}
              disabled={busy || (mode === 'return' ? !returnReady : note.trim().length < 2)}
            >
              {busy
                ? t('جارٍ التنفيذ…', 'Working…')
                : mode === 'return'
                  ? t('تأكيد الإرجاع للعميل', 'Confirm return to client')
                  : t('تأكيد إلغاء الحجز', 'Confirm cancel booking')}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => {
                setMode(null);
                setNote('');
                setRejected(new Set());
              }}
            >
              {t('إلغاء', 'Cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** The channel reported the deposit paid; the owner confirms the money actually arrived. */
function PaymentReviewCard({
  locale,
  depositLabel,
  depositPaidAt,
  lifecycle,
  canManage,
  busy,
  onConfirm,
  onReject,
}: Props & {
  busy: boolean;
  onConfirm: () => Promise<void>;
  onReject: (note: string) => Promise<void>;
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const reported = lifecycle.paymentReview?.reportedAt ?? depositPaidAt;
  return (
    <div className="lrw__card lrw__card--action">
      <h3>{t('تأكيد استلام العربون', 'Confirm the deposit arrived')}</h3>
      <p>
        {t(
          `أبلغت قناة الدفع بنجاح دفع العربون ${depositLabel}${reported ? ` في ${new Date(reported).toLocaleString('ar-OM', { timeZone: 'Asia/Muscat', dateStyle: 'medium', timeStyle: 'short' })}` : ''}. سياسة الاعتماد لهذا العقار تتطلب أن تتحقق من وصول المبلغ إلى حسابك قبل متابعة الحجز.`,
          `The payment channel reported the ${depositLabel} deposit as paid. This property's approval policy asks you to check the money reached your account before the booking moves on.`,
        )}
      </p>
      {canManage ? (
        <div className="form-actions">
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? t('جارٍ التأكيد…', 'Confirming…') : t('تأكيد استلام المبلغ', 'Confirm receipt')}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => setRejecting((open) => !open)}
          >
            {t('لم يصل المبلغ', 'Money not received')}
          </button>
        </div>
      ) : (
        <p className="muted">
          {t('يؤكد الاستلام المالك أو من يمثله.', 'The owner or their representative confirms.')}
        </p>
      )}
      {rejecting ? (
        <form
          className="lrw__reject"
          onSubmit={(event) => {
            event.preventDefault();
            if (note.trim().length < 2) return;
            void onReject(note.trim());
          }}
        >
          <label htmlFor="lrw-payment-note">
            {t('سبب الإلغاء (يظهر للعميل)', 'Reason (shown to the client)')}
          </label>
          <textarea
            id="lrw-payment-note"
            className="textarea"
            rows={2}
            value={note}
            minLength={2}
            maxLength={BOOKING_NOTE_MAX}
            required
            onChange={(event) => setNote(event.target.value)}
          />
          <NoteTranslateBar
            value={note}
            onChange={setNote}
            locale={locale}
            max={BOOKING_NOTE_MAX}
            disabled={busy}
            service={OWNER_NOTE_SERVICE}
          />
          <button type="submit" className="button button--danger" disabled={busy}>
            {t('إلغاء الحجز', 'Cancel the booking')}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Documents the system accepted for the owner: confirm each one, ask for a replacement,
 * or — only with an explicit second action — cancel the booking for a fatal violation.
 */
function VerificationPanel({
  lifecycle,
  locale,
  busy,
  fileHref,
  onVerify,
  onVerifyCheque,
}: Props & {
  busy: boolean;
  fileHref: (file: string) => string;
  onVerify: (
    code: string,
    decision: 'verified' | 'rejected' | 'cancel_booking',
    note?: string,
  ) => Promise<void>;
  onVerifyCheque: (
    key: string,
    decision: 'verified' | 'rejected' | 'cancel_booking',
    note?: string,
  ) => Promise<void>;
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const pendingDocs = documentsToVerify(lifecycle);
  const pendingCheques = chequesToVerify(lifecycle);
  const instructions = lifecycle.chequeInstructions ?? [];
  const chequeLabel = (row: ReservationChequeSubmission) => {
    const instruction = instructions.find((item) => item.key === row.key);
    return instruction
      ? ar
        ? instruction.labelAr
        : instruction.labelEn || instruction.labelAr
      : row.key;
  };
  if (!pendingDocs.length && !pendingCheques.length) return null;
  return (
    <div className="lrw__card lrw__card--verify">
      <h3>
        {t(
          'تحقّق من المستندات والشيكات المعتمدة إلكترونياً',
          'Verify the electronically accepted documents and cheques',
        )}
      </h3>
      <p>
        {t(
          'قبل النظام هذه الملفات نيابةً عنك عند اكتمال الرفع. العقد قد يُعتمد ويُوقَّع، لكن التسليم لا يكتمل حتى تعتمدها يدوياً (ما لم تسمح سياسة الضبط بالتجاوز). أكّد السليم، أو ارفض مع طلب استبدال.',
          'The system accepted these when the client finished uploading. The contract may already be approved and signed, but handover stays blocked until you verify them manually (unless policy allows a bypass). Confirm valid files, or reject and ask for a replacement.',
        )}
      </p>
      <ul className="lrw__docs-list">
        {pendingDocs.map((item) => (
          <li key={item.code} className="lrw__doc lrw__doc--approved">
            <div className="lrw__doc-main">
              <strong>{ar ? item.labelAr : item.labelEn || item.labelAr}</strong>
              <span className="lrw__doc-status">{requirementStatusText(item, ar)}</span>
            </div>
            <div className="lrw__doc-actions">
              {item.file ? (
                <ViewFileButton
                  href={fileHref(`doc-${item.code}`)}
                  label={ar ? item.labelAr : item.labelEn || item.labelAr}
                  ar={ar}
                />
              ) : null}
              <button
                type="button"
                className="button button--primary"
                disabled={busy}
                onClick={() => void onVerify(item.code, 'verified')}
              >
                {t('المستند سليم', 'Document is valid')}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => {
                  setRejecting(`doc:${item.code}`);
                  setCancelling(null);
                  setNote('');
                }}
              >
                {t('رفض وطلب استبدال', 'Reject & request replacement')}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => {
                  setCancelling(`doc:${item.code}`);
                  setRejecting(null);
                  setNote('');
                }}
              >
                {t('مخالف — إلغاء الحجز', 'Invalid — cancel booking')}
              </button>
            </div>
            {rejecting === `doc:${item.code}` ? (
              <form
                className="lrw__reject"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!note.trim()) return;
                  void onVerify(item.code, 'rejected', note.trim()).then(() => setRejecting(null));
                }}
              >
                <label htmlFor={`verify-${item.code}`}>
                  {t('سبب الرفض (يظهر للعميل)', 'Reason (shown to the client)')}
                </label>
                <textarea
                  id={`verify-${item.code}`}
                  className="textarea"
                  rows={2}
                  value={note}
                  maxLength={BOOKING_NOTE_MAX}
                  required
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t(
                    'مثال: الصورة غير واضحة — أعد الرفع',
                    'e.g. Image unclear — please re-upload',
                  )}
                />
                <NoteTranslateBar
                  value={note}
                  onChange={setNote}
                  locale={locale}
                  max={BOOKING_NOTE_MAX}
                  disabled={busy}
                  service={OWNER_NOTE_SERVICE}
                />
                <p className="notice notice--info">
                  {t(
                    'يبقى الحجز قائماً ويُطلب من العميل رفع بديل. لا يُلغى الحجز.',
                    'The booking stays open and the client must upload a replacement. No cancellation.',
                  )}
                </p>
                <button type="submit" className="button button--primary" disabled={busy}>
                  {t('تأكيد الرفض وطلب الاستبدال', 'Confirm reject & ask for replacement')}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setRejecting(null)}
                >
                  {t('تراجع', 'Back')}
                </button>
              </form>
            ) : null}
            {cancelling === `doc:${item.code}` ? (
              <form
                className="lrw__reject"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!note.trim()) return;
                  void onVerify(item.code, 'cancel_booking', note.trim()).then(() =>
                    setCancelling(null),
                  );
                }}
              >
                <label htmlFor={`cancel-${item.code}`}>
                  {t('سبب المخالفة (يظهر للعميل)', 'What is wrong (shown to the client)')}
                </label>
                <textarea
                  id={`cancel-${item.code}`}
                  className="textarea"
                  rows={2}
                  value={note}
                  maxLength={BOOKING_NOTE_MAX}
                  required
                  onChange={(event) => setNote(event.target.value)}
                />
                <NoteTranslateBar
                  value={note}
                  onChange={setNote}
                  locale={locale}
                  max={BOOKING_NOTE_MAX}
                  disabled={busy}
                  service={OWNER_NOTE_SERVICE}
                />
                <p className="notice notice--error">
                  {t(
                    'سيُلغى الحجز فوراً، ويُلغى العقد المرتبط به إن صدر، ويُبلَّغ العميل بالسبب. استخدم هذا فقط للمخالفة الجسيمة — لطلب صورة أوضح اختر «رفض وطلب استبدال».',
                    'The booking is cancelled at once and any issued contract is voided. Use this only for a serious violation — for a clearer photo choose “Reject & request replacement”.',
                  )}
                </p>
                <button type="submit" className="button button--danger" disabled={busy}>
                  {t('تأكيد المخالفة وإلغاء الحجز', 'Confirm and cancel the booking')}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setCancelling(null)}
                >
                  {t('تراجع', 'Back')}
                </button>
              </form>
            ) : null}
          </li>
        ))}
        {pendingCheques.map((item) => (
          <li key={item.key} className="lrw__doc lrw__doc--approved">
            <div className="lrw__doc-main">
              <strong>{chequeLabel(item)}</strong>
              <span className="lrw__doc-status">
                {t(
                  'قُبل إلكترونياً — بانتظار اعتمادك',
                  'Accepted electronically — needs your verify',
                )}
              </span>
              <span className="muted" dir="ltr">
                #{item.chequeNumber}
                {item.bankName ? ` · ${item.bankName}` : ''}
                {item.accountNumber ? ` · ${item.accountNumber}` : ''}
              </span>
            </div>
            <div className="lrw__doc-actions">
              {item.file ? (
                <ViewFileButton
                  href={fileHref(`cheque-${item.key}`)}
                  label={chequeLabel(item)}
                  ar={ar}
                />
              ) : null}
              <button
                type="button"
                className="button button--primary"
                disabled={busy}
                onClick={() => void onVerifyCheque(item.key, 'verified')}
              >
                {t('الشيك سليم', 'Cheque is valid')}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => {
                  setRejecting(`cheque:${item.key}`);
                  setCancelling(null);
                  setNote('');
                }}
              >
                {t('رفض وطلب استبدال', 'Reject & request replacement')}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => {
                  setCancelling(`cheque:${item.key}`);
                  setRejecting(null);
                  setNote('');
                }}
              >
                {t('مخالف — إلغاء الحجز', 'Invalid — cancel booking')}
              </button>
            </div>
            {rejecting === `cheque:${item.key}` ? (
              <form
                className="lrw__reject"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!note.trim()) return;
                  void onVerifyCheque(item.key, 'rejected', note.trim()).then(() =>
                    setRejecting(null),
                  );
                }}
              >
                <label htmlFor={`verify-cheque-${item.key}`}>
                  {t('سبب الرفض (يظهر للعميل)', 'Reason (shown to the client)')}
                </label>
                <textarea
                  id={`verify-cheque-${item.key}`}
                  className="textarea"
                  rows={2}
                  value={note}
                  maxLength={BOOKING_NOTE_MAX}
                  required
                  onChange={(event) => setNote(event.target.value)}
                />
                <NoteTranslateBar
                  value={note}
                  onChange={setNote}
                  locale={locale}
                  max={BOOKING_NOTE_MAX}
                  disabled={busy}
                  service={OWNER_NOTE_SERVICE}
                />
                <button type="submit" className="button button--primary" disabled={busy}>
                  {t('تأكيد الرفض وطلب الاستبدال', 'Confirm reject & ask for replacement')}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setRejecting(null)}
                >
                  {t('تراجع', 'Back')}
                </button>
              </form>
            ) : null}
            {cancelling === `cheque:${item.key}` ? (
              <form
                className="lrw__reject"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!note.trim()) return;
                  void onVerifyCheque(item.key, 'cancel_booking', note.trim()).then(() =>
                    setCancelling(null),
                  );
                }}
              >
                <label htmlFor={`cancel-cheque-${item.key}`}>
                  {t('سبب المخالفة (يظهر للعميل)', 'What is wrong (shown to the client)')}
                </label>
                <textarea
                  id={`cancel-cheque-${item.key}`}
                  className="textarea"
                  rows={2}
                  value={note}
                  maxLength={BOOKING_NOTE_MAX}
                  required
                  onChange={(event) => setNote(event.target.value)}
                />
                <NoteTranslateBar
                  value={note}
                  onChange={setNote}
                  locale={locale}
                  max={BOOKING_NOTE_MAX}
                  disabled={busy}
                  service={OWNER_NOTE_SERVICE}
                />
                <button type="submit" className="button button--danger" disabled={busy}>
                  {t('تأكيد المخالفة وإلغاء الحجز', 'Confirm and cancel the booking')}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setCancelling(null)}
                >
                  {t('تراجع', 'Back')}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The owner's side of a website booking after its deposit, stage by stage: approve the booking,
 * prepare the contract and the documents it needs, review them, approve the contract for the
 * tenant to sign, then record the handover.
 */
export function LeaseReservationWorkflow(serverProps: Props) {
  const { reservationId, locale, mode, canManage, canSign } = serverProps;
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const sale = mode === 'sale';
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [localViewing, setLocalViewing] = useState<number | null>(null);
  const viewing = serverProps.onViewingChange ? (serverProps.viewing ?? null) : localViewing;
  const setViewing = serverProps.onViewingChange ?? setLocalViewing;
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [decisions, setDecisions] = useState<Record<string, DocumentDecision>>({});

  const serverLifecycle = serverProps.lifecycle;
  useEffect(() => {
    setDecisions((current) => {
      const open = Object.entries(current).filter(([code, decision]) => {
        const item = serverLifecycle.requirements?.find((entry) => entry.code === code);
        return item ? !decisionSettled(item, decision) : false;
      });
      return open.length === Object.keys(current).length ? current : Object.fromEntries(open);
    });
  }, [serverLifecycle]);
  const lifecycle = useMemo<ReservationLifecycle>(() => {
    if (!Object.keys(decisions).length || !serverLifecycle.requirements) return serverLifecycle;
    return {
      ...serverLifecycle,
      requirements: serverLifecycle.requirements.map((item) => {
        const decision = decisions[item.code];
        return decision && !decisionSettled(item, decision) ? { ...item, ...decision } : item;
      }),
    };
  }, [serverLifecycle, decisions]);
  const phase =
    lifecycle !== serverLifecycle &&
    (serverProps.phase === 'awaiting_documents' ||
      serverProps.phase === 'awaiting_documents_review')
      ? documentsPhase(lifecycle)
      : serverProps.phase;
  const props: Props =
    lifecycle === serverLifecycle ? serverProps : { ...serverProps, lifecycle, phase };
  const stage = leaseJourneyStageIndex(phase);
  const labels = leaseJourneyStageLabels(sale, ar);
  /** A completed stage the owner opened to review; later stages stay locked. */
  const reviewing = viewing !== null && viewing < stage ? viewing : null;
  const shownStage = reviewing !== null ? reviewing : stage;
  const showBookingStageDetails = shownStage === 0;
  const fileHref = (file: string) =>
    `/api/owner/bookings/${encodeURIComponent(reservationId)}/files/${file}`;
  const contractHref = lifecycle.contract
    ? `/${locale}/${props.portal}/contracts/${encodeURIComponent(lifecycle.contract.id)}`
    : null;

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/owner/bookings/${encodeURIComponent(reservationId)}/lifecycle`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setEditing(false);
      startRefresh(() => router.refresh());
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Accepting or confirming a document shows at once; the request runs behind it and the
   * decision is withdrawn with an error if the server refuses it.
   */
  async function decide(code: string, decision: DocumentDecision, body: Record<string, unknown>) {
    setError(null);
    setDecisions((current) => ({ ...current, [code]: decision }));
    try {
      const result = await browserNextMutation<{ automationPending?: boolean }>(
        `/api/owner/bookings/${encodeURIComponent(reservationId)}/lifecycle`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      startRefresh(() => router.refresh());
      if (result?.automationPending) {
        window.setTimeout(() => startRefresh(() => router.refresh()), 2500);
      }
    } catch (caught) {
      setDecisions((current) => {
        const rest = { ...current };
        delete rest[code];
        return rest;
      });
      setError(errorText(caught, ar));
    }
  }

  const draftOpen =
    phase === 'awaiting_contract_draft' || (phase === 'awaiting_contract_approval' && editing);

  return (
    <PreviewContext.Provider value={setPreview}>
      <section className="ops-panel lrw" aria-label={t('مراحل الحجز', 'Booking stages')}>
        <header className="lrw__head">
          <div>
            <span className="ops-kicker">{t('مسار الحجز', 'Booking journey')}</span>
            <h2>
              {leasePhaseLabel(phase, ar, {
                docsReturnOpen: bookingDocsReturnOpen(lifecycle),
                docsNeedVerify: packageNeedsManualVerification(lifecycle),
                viewer: 'owner',
              })}
            </h2>
          </div>
          <p className="lrw__head-hint muted">
            {t(
              'اضغط مرحلة مكتملة لمراجعتها، أو ابقَ على المرحلة الحالية للمتابعة.',
              'Open a completed stage to review it, or stay on the current stage to continue.',
            )}
          </p>
        </header>
        <ol className="lrw__steps">
          {labels.map((label, index) => {
            const state = index < stage ? 'done' : index === stage ? 'current' : 'upcoming';
            const shown = reviewing === null ? index === stage : index === reviewing;
            const content = (
              <>
                <span className="lrw__dot">{index < stage ? '✓' : index + 1}</span>
                <span>{label}</span>
              </>
            );
            return (
              <li
                key={label}
                className={`lrw__step lrw__step--${state}${shown ? ' lrw__step--shown' : ''}`}
                aria-current={index === stage ? 'step' : undefined}
              >
                {state === 'upcoming' ? (
                  <span
                    className="lrw__step-body"
                    aria-disabled="true"
                    title={t('لم تصل إلى هذه المرحلة بعد', 'Not reached yet')}
                  >
                    {content}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="lrw__step-body"
                    aria-pressed={shown}
                    title={
                      state === 'done'
                        ? t('عرض تفاصيل هذه المرحلة', 'View this stage')
                        : t('العودة إلى المرحلة الحالية', 'Back to the current stage')
                    }
                    onClick={() => setViewing(state === 'done' ? index : null)}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}

        {reviewing !== null ? (
          <CompletedStage
            {...props}
            index={reviewing}
            label={labels[reviewing] ?? ''}
            contractHref={contractHref}
            fileHref={fileHref}
            onBack={() => setViewing(null)}
          />
        ) : null}

        {reviewing === null ? (
          <>
            {phase === 'awaiting_terms_signature' ? (
              <p className="notice notice--info">
                {t(
                  'دفع العميل العربون ولم يوقّع اتفاقية الحجز بعد. ستتمكن من اعتماد الحجز بعد توقيعه.',
                  'The client paid the deposit but has not signed the booking agreement yet.',
                )}
              </p>
            ) : null}

            {phase === 'awaiting_payment_review' ? (
              <PaymentReviewCard
                {...props}
                busy={busy}
                onConfirm={() => act({ action: 'confirm_payment' })}
                onReject={(note) => act({ action: 'reject_payment', note })}
              />
            ) : null}

            {phase === 'closed' && lifecycle.cancellation ? (
              <RestoreCancelledBooking
                locale={locale}
                busy={busy}
                canManage={canManage}
                cancellation={lifecycle.cancellation}
                onRestore={(note) => act({ action: 'restore_reservation', note })}
              />
            ) : null}

            <OwnerBookingActionsCard
              locale={locale}
              phase={phase}
              canManage={canManage}
              busy={busy}
              hasIssuedContract={Boolean(lifecycle.contract)}
              hasEsign={props.hasEsign}
              party={props.party}
              fileHref={fileHref}
              onReturnDocs={(note, rejected) =>
                act({ action: 'return_booking_docs', note, rejected })
              }
              onCancel={(note) => act({ action: 'cancel_reservation', note })}
            />

            {canManage && phase !== 'closed' && packageNeedsManualVerification(lifecycle) ? (
              <VerificationPanel
                {...props}
                busy={busy}
                fileHref={fileHref}
                onVerify={(code, decision, note) =>
                  decision === 'verified'
                    ? decide(
                        code,
                        { status: 'approved', verifiedAt: new Date().toISOString() },
                        { action: 'verify_document', code, decision: 'verified' },
                      )
                    : act({
                        action: 'verify_document',
                        code,
                        decision,
                        ...(note ? { note } : {}),
                      })
                }
                onVerifyCheque={(key, decision, note) =>
                  act({
                    action: 'verify_cheque',
                    key,
                    decision,
                    ...(note ? { note } : {}),
                  })
                }
              />
            ) : null}

            {phase === 'awaiting_owner_approval' ? (
              <div className="lrw__card lrw__card--action">
                <h3>{t('اعتماد الحجز', 'Approve the booking')}</h3>
                <p>
                  {t(
                    'دفع العميل العربون ووقّع اتفاقية الحجز إلكترونياً مع صور هويته. راجع البيانات ثم اعتمد الحجز ليفتح لك نافذة إعداد العقد، ويظهر للعميل أن حجزه معتمد.',
                    'The client paid the deposit and e-signed the booking agreement with their ID. Review, then approve to open the contract step; the client will see the booking as approved.',
                  )}
                </p>
                {canManage ? (
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={busy}
                    onClick={() => void act({ action: 'approve' })}
                  >
                    {busy
                      ? t('جارٍ الاعتماد…', 'Approving…')
                      : t('اعتماد الحجز', 'Approve booking')}
                  </button>
                ) : (
                  <p className="muted">
                    {t(
                      'يعتمد الحجز المالك أو من يمثله.',
                      'The owner or their representative approves.',
                    )}
                  </p>
                )}
              </div>
            ) : null}

            {draftOpen && canManage ? (
              <ContractDraftEditor
                {...props}
                busy={busy}
                onSave={act}
                onCancel={() => setEditing(false)}
              />
            ) : null}

            {!draftOpen && phase === 'awaiting_contract_approval' ? (
              <div className="lrw__card lrw__desk">
                <div className="lrw__desk-head">
                  <div>
                    <h3>
                      {sale ? t('عقد البيع', 'Sale contract') : t('عقد الإيجار', 'Lease contract')}
                    </h3>
                    <p className="muted">
                      {t(
                        'راجع ملخص العقد واعتمده للتوقيع. المستندات والشيكات تُطلب من العميل بعد توقيعه.',
                        'Review the contract summary and approve it for signature. Documents and cheques are requested from the client after they sign.',
                      )}
                    </p>
                  </div>
                  {canManage ? (
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => setEditing(true)}
                      disabled={busy}
                    >
                      {t('تعديل العقد والمستندات', 'Edit contract & documents')}
                    </button>
                  ) : null}
                </div>
                <DraftSummary {...props} />
                <RequirementsReview
                  {...props}
                  busy={busy}
                  fileHref={fileHref}
                  onReview={(code, decision, note) =>
                    decide(
                      code,
                      { status: decision, ...(note ? { note } : {}) },
                      { action: 'review_document', code, decision, ...(note ? { note } : {}) },
                    )
                  }
                  onAddRequirements={(requirements) =>
                    void act({ action: 'add_requirements', requirements })
                  }
                />
                <div className="lrw__approve">
                  <p className="muted">
                    {t(
                      'باعتمادك يوقَّع العقد باسم المالك ويُرسل للعميل ليوقّعه إلكترونياً، ثم يرفع المستندات والشيكات.',
                      'Approving signs for the owner and sends the contract to the client to e-sign; they then upload documents and cheques.',
                    )}
                  </p>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={busy || !canSign}
                    onClick={() => void act({ action: 'issue_contract' })}
                  >
                    {busy
                      ? t('جارٍ الاعتماد…', 'Approving…')
                      : t('اعتماد العقد وإرساله للتوقيع', 'Approve contract & send for signature')}
                  </button>
                  {!canSign ? (
                    <p className="muted">
                      {t(
                        'اعتماد العقد يحتاج صلاحية توقيع العقود (المالك أو مدير المؤسسة).',
                        'Approving the contract needs contract-signing permission.',
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!draftOpen &&
            Boolean(lifecycle.tenantSignature) &&
            !lifecycle.handover &&
            (phase === 'awaiting_documents' || phase === 'awaiting_documents_review') ? (
              <div className="lrw__card lrw__desk">
                <div className="lrw__desk-head">
                  <div>
                    <h3>{t('اعتماد المستندات والشيكات', 'Approve documents & cheques')}</h3>
                    <p className="muted">
                      {t(
                        'العقد موقّع من الطرفين. راجع المرفقات واحداً تلو الآخر من قائمة واحدة، ثم أكمل الاعتماد قبل التسليم. يمكنك طلب مستند إضافي من العميل إن لزم.',
                        'The contract is signed by both parties. Review attachments one by one from a single list, then finish approval before handover. You can still request an extra document if needed.',
                      )}
                    </p>
                  </div>
                </div>
                <RequirementsReview
                  {...props}
                  busy={busy}
                  fileHref={fileHref}
                  onReview={(code, decision, note) =>
                    decide(
                      code,
                      { status: decision, ...(note ? { note } : {}) },
                      { action: 'review_document', code, decision, ...(note ? { note } : {}) },
                    )
                  }
                  onReviewCheque={(key, decision, note) =>
                    act({
                      action: 'review_cheque',
                      key,
                      decision,
                      ...(note ? { note } : {}),
                    })
                  }
                  onAddRequirements={(requirements) =>
                    void act({ action: 'add_requirements', requirements })
                  }
                />
              </div>
            ) : null}

            {phase === 'awaiting_tenant_signature' ? (
              <div className="lrw__card">
                <h3>{t('بانتظار توقيع الطرف الثاني', 'Awaiting the second party')}</h3>
                <p>
                  {lifecycle.contract?.automatic
                    ? t(
                        `اعتمد النظام العقد ${lifecycle.contract.reference} نيابةً عنك ووُقّع باسم المالك. ينتظر الآن توقيع ${sale ? 'المشتري' : 'المستأجر'} إلكترونياً؛ بعد التوقيع يرفع المستندات والشيكات.`,
                        `The system approved contract ${lifecycle.contract.reference} for you; it is signed for the owner and awaits the ${sale ? 'buyer' : 'tenant'}'s e-signature. After signing they upload documents and cheques.`,
                      )
                    : t(
                        `اعتمدت العقد ${lifecycle.contract?.reference ?? ''} ووُقّع باسم المالك. ينتظر الآن توقيع ${sale ? 'المشتري' : 'المستأجر'} إلكترونياً؛ بعد التوقيع يرفع المستندات والشيكات.`,
                        `You approved contract ${lifecycle.contract?.reference ?? ''}; it is signed for the owner and awaits the ${sale ? 'buyer' : 'tenant'}'s e-signature. After signing they upload documents and cheques.`,
                      )}
                </p>
                {contractHref ? (
                  <a className="button button--quiet" href={contractHref}>
                    {t('عرض العقد', 'View contract')}
                  </a>
                ) : null}
              </div>
            ) : null}

            {phase === 'awaiting_handover' && !lifecycle.handover ? (
              <div className="lrw__card lrw__card--action">
                <h3>
                  {t('تسليم العقار بمسح رمز المستأجر', 'Hand over by scanning the tenant’s code')}
                </h3>
                <p className="notice notice--success" role="status">
                  {t(
                    'تم اعتماد المستندات والشيكات في المرحلة السابقة. هذه الخطوة للتسليم فقط — امسح رمز المستأجر عند حضوره.',
                    'Documents and cheques were approved in the previous step. This step is handover only — scan the tenant’s code when they arrive.',
                  )}
                </p>
                <p>
                  {t(
                    'العقد موقّع من الطرفين. عند حضور المستأجر لاستلام المفاتيح يعرض رمز التسليم المشفّر من حسابه، فيمسحه المالك أو ممثله أو حارس المبنى، فيلتقط كل من المستلم والمسلِّم صورة سيلفي في اللحظة نفسها، ثم يوثّق المسلِّم حالة العقار. بمجرد تسجيل المحضر يصبح التسليم نافذاً؛ يطّلع عليه المستأجر ويحق له الاعتراض خلال 3 ساعات.',
                    'The contract is signed by both parties. When the tenant comes for the keys they show the sealed handover code from their account; the owner, a representative or the building guard scans it, both take a selfie, and the premises are recorded. Filing the record completes the handover; the tenant can view it and object within 3 hours.',
                  )}
                </p>
                <ol className="lrw__handover-steps">
                  <li>
                    {t('افتح شاشة التسليم من هاتفك.', 'Open the handover screen on your phone.')}
                  </li>
                  <li>
                    {t(
                      'امسح الرمز في حساب المستأجر أو أدخل رقم الحجز والرمز اليدوي.',
                      'Scan the code in the tenant’s account, or type the booking number and manual code.',
                    )}
                  </li>
                  <li>
                    {t(
                      'يلتقط المستأجر سيلفي من هاتفه وتلتقط أنت سيلفي من جهازك؛ طابق وجهه مع صورة التوقيع، وأضف صور العقار وملاحظاتك.',
                      'The tenant takes a selfie on their phone and you take one on yours; match their face with the signing selfie, add premises photos and notes.',
                    )}
                  </li>
                </ol>
                <div className="lrw__handover-actions">
                  {handoverBlockedByUnverifiedDocs(lifecycle) ? (
                    <button type="button" className="button button--primary" disabled>
                      {t(
                        'التسليم مقفل حتى اعتماد المستندات',
                        'Handover locked until documents are verified',
                      )}
                    </button>
                  ) : (
                    <a className="button button--primary" href={`/${locale}/handover`}>
                      {t('فتح شاشة التسليم', 'Open the handover screen')}
                    </a>
                  )}
                  {contractHref ? (
                    <a className="button button--quiet" href={contractHref}>
                      {t('عرض العقد الموقّع', 'View signed contract')}
                    </a>
                  ) : null}
                </div>
                <p className="muted">
                  {t(
                    'يمكن لأي عضو في الفريق يملك صلاحية «تسليم العقار للمستأجر بمسح رمزه» (مثل الحارس) القيام بالتسليم.',
                    'Any team member with the “hand over premises by scanning” permission (such as the guard) can do it.',
                  )}
                </p>
              </div>
            ) : null}

            {phase === 'handed_over' && lifecycle.handover ? (
              <div className="lrw__card">
                <h3>{t('تم تسليم العقار', 'Premises handed over')}</h3>
                <HandoverFacts handover={lifecycle.handover} ar={ar} />
                <HandoverPhotos
                  handover={lifecycle.handover}
                  ar={ar}
                  fileHref={fileHref}
                  showRecipient={canManage}
                />
                {contractHref ? (
                  <a className="button button--quiet" href={contractHref}>
                    {t('عرض العقد الموقّع', 'View signed contract')}
                  </a>
                ) : null}
              </div>
            ) : null}

            {!sale &&
            phase === 'handed_over' &&
            lifecycle.handover &&
            (!lifecycle.handover.status ||
              lifecycle.handover.status === 'accepted' ||
              lifecycle.handover.status === 'awaiting_tenant') ? (
              <MunicipalRegistrationCard
                ar={ar}
                t={t}
                busy={busy}
                canManage={canManage}
                registration={lifecycle.municipalRegistration}
                handover={lifecycle.handover}
                draftTerms={
                  (lifecycle.contractDraft?.lease as { terms?: LeaseTermsDraft } | undefined)?.terms
                }
                onSave={(payload) =>
                  void act({
                    action: 'save_municipal_registration',
                    ...payload,
                  })
                }
              />
            ) : null}
          </>
        ) : null}

        {showBookingStageDetails && props.hasEsign && canManage ? (
          <IdentityGallery ar={ar} fileHref={fileHref} />
        ) : null}
      </section>
      {preview ? (
        <FilePreviewDialog file={preview} ar={ar} onClose={() => setPreview(null)} />
      ) : null}
    </PreviewContext.Provider>
  );
}

function MunicipalRegistrationCard({
  ar,
  t,
  busy,
  canManage,
  registration,
  handover,
  draftTerms,
  onSave,
}: {
  ar: boolean;
  t: (arText: string, enText: string) => string;
  busy: boolean;
  canManage: boolean;
  registration: ReservationLifecycle['municipalRegistration'];
  handover: ReservationLifecycle['handover'];
  draftTerms?: LeaseTermsDraft | undefined;
  onSave: (payload: {
    formNo: string;
    contractNo: string;
    electricityReading: string;
    waterReading: string;
    electricityReadingPhoto: string;
    waterReadingPhoto: string;
  }) => void;
}) {
  const [formNo, setFormNo] = useState(registration?.formNo ?? draftTerms?.municipalFormNo ?? '');
  const [contractNo, setContractNo] = useState(
    registration?.contractNo ?? draftTerms?.municipalContractNo ?? '',
  );
  const [electricity, setElectricity] = useState(
    handover?.electricityReading ?? draftTerms?.electricityReading ?? '',
  );
  const [water, setWater] = useState(handover?.waterReading ?? draftTerms?.waterReading ?? '');
  const [elecPhoto, setElecPhoto] = useState(draftTerms?.electricityReadingPhoto ?? '');
  const [waterPhoto, setWaterPhoto] = useState(draftTerms?.waterReadingPhoto ?? '');
  const [photoBusy, setPhotoBusy] = useState(false);
  const metersComplete = Boolean(
    handover?.electricityReading?.trim() &&
    handover?.waterReading?.trim() &&
    draftTerms?.electricityReadingPhoto?.trim() &&
    draftTerms?.waterReadingPhoto?.trim(),
  );
  const [editing, setEditing] = useState(!registration || !metersComplete);

  useEffect(() => {
    if (registration) {
      setFormNo(registration.formNo);
      setContractNo(registration.contractNo);
    }
    if (handover?.electricityReading) setElectricity(handover.electricityReading);
    if (handover?.waterReading) setWater(handover.waterReading);
    if (draftTerms?.electricityReadingPhoto) setElecPhoto(draftTerms.electricityReadingPhoto);
    if (draftTerms?.waterReadingPhoto) setWaterPhoto(draftTerms.waterReadingPhoto);
    if (registration && metersComplete) setEditing(false);
  }, [registration, handover, draftTerms, metersComplete]);

  async function readPhoto(file: File | null, setter: (value: string) => void) {
    if (!file) {
      setter('');
      return;
    }
    if (!file.type.startsWith('image/')) return;
    setPhotoBusy(true);
    try {
      setter(await compressPhoto(file, HANDOVER_PHOTO_MAX));
    } finally {
      setPhotoBusy(false);
    }
  }

  const formMissing = !formNo.trim();
  const contractMissing = !contractNo.trim();
  const electricityMissing = !electricity.trim();
  const waterMissing = !water.trim();
  const elecPhotoMissing = !elecPhoto.trim();
  const waterPhotoMissing = !waterPhoto.trim();
  const incomplete =
    formMissing ||
    contractMissing ||
    electricityMissing ||
    waterMissing ||
    elecPhotoMissing ||
    waterPhotoMissing;

  if (registration && metersComplete && !editing) {
    return (
      <div className="lrw__card">
        <h3>{t('بيانات ما بعد التسليم', 'Post-handover details')}</h3>
        <dl className="contract-detail__facts">
          <div>
            <dt>{t('قراءة عداد الكهرباء', 'Electricity reading')}</dt>
            <dd dir="ltr">{handover?.electricityReading}</dd>
          </div>
          <div>
            <dt>{t('قراءة عداد الماء', 'Water reading')}</dt>
            <dd dir="ltr">{handover?.waterReading}</dd>
          </div>
          {draftTerms?.electricityReadingPhoto ? (
            <div>
              <dt>{t('صورة عداد الكهرباء', 'Electricity meter photo')}</dt>
              <dd>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={draftTerms.electricityReadingPhoto} alt="" className="lcf-meter-thumb" />
              </dd>
            </div>
          ) : null}
          {draftTerms?.waterReadingPhoto ? (
            <div>
              <dt>{t('صورة عداد الماء', 'Water meter photo')}</dt>
              <dd>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={draftTerms.waterReadingPhoto} alt="" className="lcf-meter-thumb" />
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{t('رقم استمارة العقد البلدي', 'Municipal form no.')}</dt>
            <dd dir="ltr">{registration.formNo}</dd>
          </div>
          <div>
            <dt>{t('رقم العقد البلدي', 'Municipal contract no.')}</dt>
            <dd dir="ltr">{registration.contractNo}</dd>
          </div>
          <div>
            <dt>{t('سُجّل', 'Recorded')}</dt>
            <dd>
              {stampText(registration.at, ar)}
              {registration.byName ? ` · ${registration.byName}` : ''}
            </dd>
          </div>
        </dl>
        {canManage ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            {t('تعديل البيانات', 'Edit details')}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="lrw__card lrw__card--action">
      <h3>{t('بيانات ما بعد التسليم', 'Post-handover details')}</h3>
      <p>
        {t(
          'بعد التسليم يُكمل المالك/الإدارة قراءات وصوَر العدادات وبيانات العقد البلدي — كلها إلزامية.',
          'After handover the owner/admin completes meter readings, meter photos, and municipal contract details — all required.',
        )}
      </p>
      <form
        className="form-grid"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (incomplete) return;
          onSave({
            formNo: formNo.trim(),
            contractNo: contractNo.trim(),
            electricityReading: electricity.trim(),
            waterReading: water.trim(),
            electricityReadingPhoto: elecPhoto,
            waterReadingPhoto: waterPhoto,
          });
        }}
      >
        <div
          className={`field field--required-mark${electricityMissing ? ' field--missing' : ' field--ok'}`}
        >
          <label htmlFor="lrw-elec">
            {t('قراءة عداد الكهرباء', 'Electricity reading')}
            <span className="field__req" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="lrw-elec"
            className="input"
            dir="ltr"
            required
            maxLength={40}
            disabled={busy || !canManage}
            value={electricity}
            onChange={(event) => setElectricity(event.target.value)}
          />
        </div>
        <div
          className={`field field--required-mark${elecPhotoMissing ? ' field--missing' : ' field--ok'}`}
        >
          <label htmlFor="lrw-elec-photo">
            {t('صورة عداد الكهرباء', 'Electricity meter photo')}
            <span className="field__req" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="lrw-elec-photo"
            className="input"
            type="file"
            accept="image/*"
            disabled={busy || photoBusy || !canManage}
            required={elecPhotoMissing}
            onChange={(event) => void readPhoto(event.target.files?.[0] ?? null, setElecPhoto)}
          />
          {elecPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={elecPhoto} alt="" className="lcf-meter-thumb" />
          ) : null}
        </div>
        <div
          className={`field field--required-mark${waterMissing ? ' field--missing' : ' field--ok'}`}
        >
          <label htmlFor="lrw-water">
            {t('قراءة عداد الماء', 'Water reading')}
            <span className="field__req" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="lrw-water"
            className="input"
            dir="ltr"
            required
            maxLength={40}
            disabled={busy || !canManage}
            value={water}
            onChange={(event) => setWater(event.target.value)}
          />
        </div>
        <div
          className={`field field--required-mark${waterPhotoMissing ? ' field--missing' : ' field--ok'}`}
        >
          <label htmlFor="lrw-water-photo">
            {t('صورة عداد الماء', 'Water meter photo')}
            <span className="field__req" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="lrw-water-photo"
            className="input"
            type="file"
            accept="image/*"
            disabled={busy || photoBusy || !canManage}
            required={waterPhotoMissing}
            onChange={(event) => void readPhoto(event.target.files?.[0] ?? null, setWaterPhoto)}
          />
          {waterPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={waterPhoto} alt="" className="lcf-meter-thumb" />
          ) : null}
        </div>
        <div
          className={`field field--required-mark${formMissing ? ' field--missing' : ' field--ok'}`}
        >
          <label htmlFor="lrw-mform">
            {t('رقم استمارة العقد البلدي', 'Municipal form no.')}
            <span className="field__req" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="lrw-mform"
            className="input"
            dir="ltr"
            required
            maxLength={80}
            disabled={busy || !canManage}
            value={formNo}
            onChange={(event) => setFormNo(event.target.value)}
          />
        </div>
        <div
          className={`field field--required-mark${contractMissing ? ' field--missing' : ' field--ok'}`}
        >
          <label htmlFor="lrw-mcontract">
            {t('رقم العقد البلدي', 'Municipal contract no.')}
            <span className="field__req" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="lrw-mcontract"
            className="input"
            dir="ltr"
            required
            maxLength={80}
            disabled={busy || !canManage}
            value={contractNo}
            onChange={(event) => setContractNo(event.target.value)}
          />
        </div>
        {canManage ? (
          <div className="form-actions span-2">
            <button
              type="submit"
              className="button button--primary"
              disabled={busy || photoBusy || incomplete}
            >
              {busy
                ? t('جارٍ الحفظ…', 'Saving…')
                : t('حفظ بيانات ما بعد التسليم', 'Save post-handover details')}
            </button>
            {registration && metersComplete ? (
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => {
                  setFormNo(registration.formNo);
                  setContractNo(registration.contractNo);
                  setElectricity(handover?.electricityReading ?? '');
                  setWater(handover?.waterReading ?? '');
                  setElecPhoto(draftTerms?.electricityReadingPhoto ?? '');
                  setWaterPhoto(draftTerms?.waterReadingPhoto ?? '');
                  setEditing(false);
                }}
              >
                {t('إلغاء', 'Cancel')}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="muted span-2">
            {t(
              'يلزم صلاحية إدارة الحجوزات لإدخال البيانات.',
              'Booking manage permission is required.',
            )}
          </p>
        )}
      </form>
    </div>
  );
}

function HandoverFacts({
  handover,
  ar,
}: {
  handover: NonNullable<ReservationLifecycle['handover']>;
  ar: boolean;
}) {
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  return (
    <dl className="contract-detail__facts">
      <div>
        <dt>{t('تاريخ التسليم', 'Handover date')}</dt>
        <dd>{handover.on}</dd>
      </div>
      <div>
        <dt>{t('المستلم', 'Received by')}</dt>
        <dd>{handover.recipientName}</dd>
      </div>
      {handover.keys ? (
        <div>
          <dt>{t('المفاتيح', 'Keys')}</dt>
          <dd>{handover.keys}</dd>
        </div>
      ) : null}
      {handover.electricityReading ? (
        <div>
          <dt>{t('قراءة الكهرباء', 'Electricity reading')}</dt>
          <dd dir="ltr">{handover.electricityReading}</dd>
        </div>
      ) : null}
      {handover.waterReading ? (
        <div>
          <dt>{t('قراءة الماء', 'Water reading')}</dt>
          <dd dir="ltr">{handover.waterReading}</dd>
        </div>
      ) : null}
      {handover.notes ? (
        <div>
          <dt>{t('ملاحظات', 'Notes')}</dt>
          <dd>{handover.notes}</dd>
        </div>
      ) : null}
      {handover.method === 'scan' ? (
        <div>
          <dt>{t('سلّمه', 'Handed over by')}</dt>
          <dd>{handover.byName ?? '—'}</dd>
        </div>
      ) : null}
      {handover.acceptedAt ? (
        <div>
          <dt>{t('وافق المستأجر على الاستلام', 'Tenant accepted')}</dt>
          <dd>{stampText(handover.acceptedAt, ar)}</dd>
        </div>
      ) : null}
      {handover.status === 'accepted' && handover.defectsUntil && !handover.defects ? (
        <div>
          <dt>{t('مهلة ملاحظات المستأجر', 'Tenant defects window')}</dt>
          <dd>
            {new Date(handover.defectsUntil) > new Date()
              ? t(
                  `مفتوحة حتى ${stampText(handover.defectsUntil, ar)}`,
                  `Open until ${stampText(handover.defectsUntil, ar)}`,
                )
              : t('انتهت دون ملاحظات — مستلَم بحالته', 'Ended without defects — accepted as is')}
          </dd>
        </div>
      ) : null}
      {handover.defects ? (
        <div>
          <dt>{t('ملاحظات المستأجر عند الاستلام', 'Tenant’s defects')}</dt>
          <dd>
            {stampText(handover.defects.at, ar)}
            {handover.defects.note ? ` · ${handover.defects.note}` : ''}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function stampText(iso: string, ar: boolean): string {
  return new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Key-receipt photo, premises photos and the tenant's defect photos, opened in the viewer. */
function HandoverPhotos({
  handover,
  ar,
  fileHref,
  showRecipient,
}: {
  handover: NonNullable<ReservationLifecycle['handover']>;
  ar: boolean;
  fileHref: (file: string) => string;
  showRecipient: boolean;
}) {
  const preview = useContext(PreviewContext);
  const shots: Array<{ file: string; label: string }> = [
    ...(showRecipient && handover.recipientPhoto
      ? [
          {
            file: 'handover-recipient',
            label: ar ? 'المستأجر عند استلام المفتاح' : 'Tenant taking the key',
          },
        ]
      : []),
    ...(handover.photos ?? []).map((photo) => ({
      file: `handover-${photo.index}`,
      label: ar ? `صورة العقار ${photo.index + 1}` : `Premises photo ${photo.index + 1}`,
    })),
    ...(handover.defects?.photos ?? []).map((photo) => ({
      file: `defect-${photo.index}`,
      label: ar ? `ملاحظة المستأجر ${photo.index + 1}` : `Tenant defect ${photo.index + 1}`,
    })),
  ];
  if (!shots.length) return null;
  return (
    <div className="lrw__gallery">
      {shots.map((shot) => (
        <button
          key={shot.file}
          type="button"
          className="lrw__shot"
          onClick={() => preview({ href: fileHref(shot.file), label: shot.label })}
        >
          <img src={fileHref(shot.file)} alt={shot.label} loading="lazy" />
          <span>{shot.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Read-only record of a stage the booking has already passed. */
function CompletedStage(
  props: Props & {
    index: number;
    label: string;
    contractHref: string | null;
    fileHref: (file: string) => string;
    onBack: () => void;
  },
) {
  const { index, label, lifecycle, locale, mode, contractHref, onBack } = props;
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const sale = mode === 'sale';
  const when = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
          timeZone: 'Asia/Muscat',
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';

  let body: ReactNode = null;
  if (index === 0) {
    body = (
      <dl className="contract-detail__facts">
        <div>
          <dt>{t('رقم الحجز', 'Booking reference')}</dt>
          <dd>
            <bdi dir="ltr" className="lrw__serial">
              {props.referenceCode}
            </bdi>
          </dd>
        </div>
        <div>
          <dt>{t('العربون المدفوع', 'Deposit paid')}</dt>
          <dd dir="ltr">{props.depositPaidAt ? props.depositLabel : '—'}</dd>
        </div>
        <div>
          <dt>{t('تاريخ الدفع', 'Paid on')}</dt>
          <dd>{when(props.depositPaidAt)}</dd>
        </div>
        <div>
          <dt>{t('قبول الشروط', 'Terms accepted')}</dt>
          <dd>{when(props.termsAcceptedAt)}</dd>
        </div>
        <div>
          <dt>{t('اتفاقية الحجز', 'Booking agreement')}</dt>
          <dd>
            {props.hasEsign
              ? t('موقّعة إلكترونياً مع صور الهوية', 'E-signed with ID photos')
              : t('غير موقّعة', 'Not signed')}
          </dd>
        </div>
      </dl>
    );
  } else if (index === 1) {
    body = (
      <dl className="contract-detail__facts">
        <div>
          <dt>{t('تاريخ الاعتماد', 'Approved on')}</dt>
          <dd>{when(lifecycle.approval?.at)}</dd>
        </div>
        <div>
          <dt>{t('اعتمده', 'Approved by')}</dt>
          <dd>{lifecycle.approval?.byName ?? '—'}</dd>
        </div>
        {lifecycle.paymentReview?.confirmedAt ? (
          <div>
            <dt>{t('تأكيد استلام العربون', 'Deposit receipt confirmed')}</dt>
            <dd>
              {when(lifecycle.paymentReview.confirmedAt)}
              {lifecycle.paymentReview.byName ? ` · ${lifecycle.paymentReview.byName}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>
    );
  } else if (index === 2) {
    body = (
      <>
        <dl className="contract-detail__facts">
          <div>
            <dt>{t('رقم العقد', 'Contract no.')}</dt>
            <dd>
              <bdi dir="ltr" className="lrw__serial">
                {lifecycle.contract?.reference ?? '—'}
              </bdi>
            </dd>
          </div>
          <div>
            <dt>{t('اعتماد المالك وتوقيعه', 'Owner approved & signed')}</dt>
            <dd>
              {when(lifecycle.contract?.issuedAt)}
              {lifecycle.contract?.byName ? ` · ${lifecycle.contract.byName}` : ''}
            </dd>
          </div>
          <div>
            <dt>
              {sale ? t('توقيع المشتري', 'Buyer signed') : t('توقيع المستأجر', 'Tenant signed')}
            </dt>
            <dd>{when(lifecycle.tenantSignature?.signedAt)}</dd>
          </div>
        </dl>
        <DraftSummary {...props} />
        {contractHref ? (
          <a className="button button--quiet" href={contractHref}>
            {t('عرض العقد', 'View contract')}
          </a>
        ) : null}
      </>
    );
  } else if (index === 3) {
    body = (
      <RequirementsReview
        {...props}
        canManage={false}
        busy
        fileHref={props.fileHref}
        onReview={async () => undefined}
        onReviewCheque={async () => undefined}
      />
    );
  } else if (lifecycle.handover) {
    body = <HandoverFacts handover={lifecycle.handover} ar={ar} />;
  }

  return (
    <div className="lrw__card lrw__card--review">
      <div className="lrw__card-head">
        <h3>
          {label} <span className="lrw__done-tag">{t('مكتملة', 'Completed')}</span>
        </h3>
        <button type="button" className="button button--quiet" onClick={onBack}>
          {t('العودة إلى المرحلة الحالية', 'Back to the current stage')}
        </button>
      </div>
      {body}
    </div>
  );
}

function IdentityGallery({ ar, fileHref }: { ar: boolean; fileHref: (file: string) => string }) {
  const preview = useContext(PreviewContext);
  const items: Array<[string, string, string]> = [
    ['id-front', 'الهوية — الوجه الأمامي', 'ID — front'],
    ['id-back', 'الهوية — الوجه الخلفي', 'ID — back'],
    ['selfie', 'صورة السيلفي', 'Selfie'],
    ['signature', 'التوقيع', 'Signature'],
  ];
  return (
    <div className="lrw__card">
      <h3>{ar ? 'هوية العميل عند التوقيع' : 'Client identity at signing'}</h3>
      <p className="muted">
        {ar
          ? 'التُقطت هذه الصور عند توقيع اتفاقية الحجز. اضغط أي صورة لفتحها بحجمها الكامل.'
          : 'Captured when the booking agreement was signed. Click to open full size.'}
      </p>
      <div className="lrw__gallery">
        {items.map(([file, labelAr, labelEn]) => (
          <button
            key={file}
            type="button"
            className="lrw__shot"
            onClick={() => preview({ href: fileHref(file), label: ar ? labelAr : labelEn })}
          >
            <img src={fileHref(file)} alt={ar ? labelAr : labelEn} loading="lazy" />
            <span>{ar ? labelAr : labelEn}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DraftSummary({
  lifecycle,
  locale,
  currency,
  mode,
  tenant,
  depositLabel,
  depositPaidAt,
}: Props) {
  const ar = locale === 'ar';
  const draft = lifecycle.contractDraft;
  if (!draft) return null;
  if (mode === 'sale' && draft.sale) {
    return (
      <dl className="lrw__summary">
        <div>
          <dt>{ar ? 'المشتري' : 'Buyer'}</dt>
          <dd>{tenant.displayName}</dd>
        </div>
        <div>
          <dt>{ar ? 'سعر البيع المتفق عليه' : 'Agreed price'}</dt>
          <dd dir="ltr">
            {draft.sale.amount} {currency}
          </dd>
        </div>
        <div>
          <dt>{ar ? 'تاريخ التوقيع' : 'Signing date'}</dt>
          <dd>{draft.sale.signedOn}</dd>
        </div>
      </dl>
    );
  }
  const terms = (draft.lease as { terms?: LeaseTermsDraft } | undefined)?.terms;
  if (!terms) return null;
  const savedAt = new Date(draft.savedAt).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
    timeZone: 'Asia/Muscat',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <dl className="lrw__summary">
      <div>
        <dt>{ar ? 'المستأجر' : 'Tenant'}</dt>
        <dd>{tenant.displayName}</dd>
      </div>
      <div>
        <dt>{ar ? 'مدة العقد' : 'Term'}</dt>
        <dd dir="ltr">
          {terms.startsOn} → {terms.endsOn}
        </dd>
      </div>
      <div>
        <dt>{ar ? 'الإيجار الشهري' : 'Monthly rent'}</dt>
        <dd dir="ltr">
          {terms.monthlyRent || '—'} {currency}
        </dd>
      </div>
      <div>
        <dt>{ar ? 'التأمين بالعقد' : 'Contract deposit'}</dt>
        <dd dir="ltr">
          {terms.deposit || '—'} {currency}
        </dd>
      </div>
      <div>
        <dt>{ar ? 'العربون المدفوع' : 'Arabon paid'}</dt>
        <dd dir="ltr">{depositPaidAt ? depositLabel : '—'}</dd>
      </div>
      <div>
        <dt>{ar ? 'آخر حفظ' : 'Last saved'}</dt>
        <dd>
          {savedAt}
          {draft.byName ? ` · ${draft.byName}` : ''}
        </dd>
      </div>
    </dl>
  );
}

function chequeFactsBlock(
  item: {
    labelAr: string;
    labelEn: string;
    amountMinor: number;
    currency: string;
    dueOn: string | null;
  },
  submitted:
    | {
        chequeNumber: string;
        bankName: string;
        accountHolderName: string;
        accountNumber?: string | null;
      }
    | undefined,
  ar: boolean,
  locale: string,
) {
  const rows: Array<[string, string]> = [
    [ar ? 'المبلغ' : 'Amount', formatMoney(String(item.amountMinor), item.currency, locale)],
    [ar ? 'تاريخ الشيك / الاستحقاق' : 'Cheque / due date', item.dueOn || '—'],
    [ar ? 'رقم الشيك' : 'Cheque number', submitted?.chequeNumber || '—'],
    [ar ? 'البنك' : 'Bank', submitted?.bankName || '—'],
    [ar ? 'اسم صاحب الحساب' : 'Account holder', submitted?.accountHolderName || '—'],
    [ar ? 'رقم الحساب' : 'Account number', submitted?.accountNumber?.trim() || '—'],
  ];
  return (
    <dl className="lrw__cheque-facts">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd dir="auto">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

type ReviewQueueItem = { kind: 'doc'; code: string } | { kind: 'cheque'; key: string };

function OwnerAttachmentActions({
  ar,
  busy,
  kind,
  queueIndex,
  queueLength,
  onView,
  onApprove,
  onReject,
  onPrev,
  onNext,
}: {
  ar: boolean;
  busy: boolean;
  kind: 'document' | 'cheque';
  queueIndex: number;
  queueLength: number;
  onView: () => void;
  onApprove: () => void;
  onReject: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <button type="button" className="button button--quiet" onClick={onView}>
        {ar ? 'عرض الملف' : 'View file'}
      </button>
      <button type="button" className="button button--primary" disabled={busy} onClick={onApprove}>
        {kind === 'cheque'
          ? ar
            ? 'اعتماد الشيك'
            : 'Approve cheque'
          : ar
            ? 'اعتماد المستند'
            : 'Approve document'}
      </button>
      <button type="button" className="button button--quiet" disabled={busy} onClick={onReject}>
        {ar ? 'رفض مع ملاحظة' : 'Reject with note'}
      </button>
      {queueLength > 1 ? (
        <>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy || queueIndex <= 0}
            onClick={onPrev}
          >
            {ar ? 'السابق' : 'Previous'}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy || queueIndex < 0 || queueIndex >= queueLength - 1}
            onClick={onNext}
          >
            {ar ? 'التالي' : 'Next'}
          </button>
        </>
      ) : null}
    </>
  );
}

function RequirementsReview({
  lifecycle,
  locale,
  mode,
  busy,
  canManage,
  fileHref,
  onReview,
  onReviewCheque,
  onAddRequirements,
}: Props & {
  busy: boolean;
  fileHref: (file: string) => string;
  onReview: (code: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>;
  onReviewCheque?: (key: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>;
  onAddRequirements?: (
    requirements: Array<{ code: string; labelAr: string; labelEn: string }>,
  ) => void;
}) {
  const ar = locale === 'ar';
  const sale = mode === 'sale';
  const preview = useContext(PreviewContext);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reviewCode, setReviewCode] = useState<string | null>(null);
  const [reviewChequeKey, setReviewChequeKey] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [pickedExtras, setPickedExtras] = useState<string[]>([]);
  const [lastDecision, setLastDecision] = useState<{
    label: string;
    decision: 'approved' | 'rejected';
  } | null>(null);
  const requirements = lifecycle.requirements ?? [];
  const chequeInstructions = lifecycle.chequeInstructions ?? [];
  const chequeByKey = new Map((lifecycle.chequeSubmissions ?? []).map((row) => [row.key, row]));
  const hasCheques = chequeInstructions.length > 0;
  const submittedDocs = requirements.filter((item) => item.status === 'submitted' && item.file);
  const submittedCheques = chequeInstructions.filter((item) => {
    const row = chequeByKey.get(item.key);
    return row?.status === 'submitted' && row.file;
  });
  const queue: ReviewQueueItem[] = [
    ...submittedDocs.map((item) => ({ kind: 'doc' as const, code: item.code })),
    ...(onReviewCheque
      ? submittedCheques.map((item) => ({ kind: 'cheque' as const, key: item.key }))
      : []),
  ];
  const includeCheques = Boolean(onReviewCheque) && hasCheques;
  const approvedDocs = requirements.filter((item) => item.status === 'approved').length;
  const approvedCheques = includeCheques
    ? chequeInstructions.filter((item) => chequeByKey.get(item.key)?.status === 'approved').length
    : 0;
  const approvedCount = approvedDocs + approvedCheques;
  const totalCount = requirements.length + (includeCheques ? chequeInstructions.length : 0);
  const existingCodes = new Set(requirements.map((item) => item.code));
  const catalogue = REQUIREMENT_CATALOGUE.filter(
    (item) => (sale ? item.sale : item.rent) && !existingCodes.has(item.code),
  );
  const reviewItem = (reviewCode && requirements.find((item) => item.code === reviewCode)) || null;
  const reviewChequeItem =
    (reviewChequeKey && chequeInstructions.find((item) => item.key === reviewChequeKey)) || null;
  const reviewChequeSubmitted = reviewChequeItem
    ? chequeByKey.get(reviewChequeItem.key)
    : undefined;
  const activeQueueIndex = reviewChequeItem
    ? queue.findIndex((item) => item.kind === 'cheque' && item.key === reviewChequeItem.key)
    : reviewItem
      ? queue.findIndex((item) => item.kind === 'doc' && item.code === reviewItem.code)
      : -1;
  const focusedReview = Boolean(reviewItem || reviewChequeItem);
  function openQueueItem(item: ReviewQueueItem) {
    if (item.kind === 'doc') openReview(item.code);
    else openChequeReview(item.key);
  }

  function openReview(code: string) {
    const item = requirements.find((row) => row.code === code);
    if (!item?.file) return;
    setReviewCode(code);
    setReviewChequeKey(null);
    setRejecting(null);
    setNote('');
    const label = ar ? item.labelAr : item.labelEn || item.labelAr;
    const target: ReviewQueueItem = { kind: 'doc', code };
    preview({
      href: fileHref(`doc-${code}`),
      label,
      actions: canManage ? (
        <>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void decideCurrent('approved', undefined, target)}
          >
            {ar ? 'اعتماد المستند' : 'Approve document'}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => {
              setRejecting(code);
              setNote('');
            }}
          >
            {ar ? 'رفض' : 'Reject'}
          </button>
        </>
      ) : undefined,
    });
  }

  function openChequeReview(key: string) {
    const item = chequeInstructions.find((row) => row.key === key);
    const row = chequeByKey.get(key);
    if (!item || !row?.file || !onReviewCheque) return;
    setReviewChequeKey(key);
    setReviewCode(null);
    setRejecting(null);
    setNote('');
    const target: ReviewQueueItem = { kind: 'cheque', key };
    preview({
      href: fileHref(`cheque-${key}`),
      label: ar ? item.labelAr : item.labelEn,
      details: chequeFactsBlock(item, row, ar, locale),
      actions: canManage ? (
        <>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void decideCurrent('approved', undefined, target)}
          >
            {ar ? 'اعتماد الشيك' : 'Approve cheque'}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => {
              setRejecting(key);
              setNote('');
            }}
          >
            {ar ? 'رفض' : 'Reject'}
          </button>
        </>
      ) : undefined,
    });
  }

  function queueItemLabel(item: ReviewQueueItem): string {
    if (item.kind === 'doc') {
      const row = requirements.find((entry) => entry.code === item.code);
      return ar ? row?.labelAr || item.code : row?.labelEn || row?.labelAr || item.code;
    }
    const row = chequeInstructions.find((entry) => entry.key === item.key);
    return ar ? row?.labelAr || item.key : row?.labelEn || row?.labelAr || item.key;
  }

  function sameQueueItem(a: ReviewQueueItem, b: ReviewQueueItem): boolean {
    if (a.kind === 'doc' && b.kind === 'doc') return a.code === b.code;
    if (a.kind === 'cheque' && b.kind === 'cheque') return a.key === b.key;
    return false;
  }

  async function decideCurrent(
    decision: 'approved' | 'rejected',
    rejectNote?: string,
    target?: ReviewQueueItem,
  ) {
    const current =
      target ??
      (reviewChequeItem && onReviewCheque
        ? { kind: 'cheque' as const, key: reviewChequeItem.key }
        : reviewItem
          ? { kind: 'doc' as const, code: reviewItem.code }
          : null);
    if (!current) return;
    const currentIndex = queue.findIndex((item) => sameQueueItem(item, current));
    const label = queueItemLabel(current);
    if (current.kind === 'doc') {
      await onReview(current.code, decision, rejectNote);
    } else {
      await onReviewCheque?.(current.key, decision, rejectNote);
    }
    setLastDecision({ label, decision });
    // Always advance forward in the review order — never jump back to an earlier item.
    const nextForward =
      currentIndex >= 0
        ? queue.slice(currentIndex + 1).find((item) => !sameQueueItem(item, current))
        : null;
    if (nextForward) {
      openQueueItem(nextForward);
      return;
    }
    setReviewCode(null);
    setReviewChequeKey(null);
    setRejecting(null);
    setNote('');
  }

  function submitExtras(event: FormEvent) {
    event.preventDefault();
    const fromCatalogue = catalogue
      .filter((item) => pickedExtras.includes(item.code))
      .map((item) => ({
        code: item.code,
        labelAr: item.labelAr,
        labelEn: item.labelEn,
      }));
    const label = customLabel.trim();
    const custom =
      label.length >= 2
        ? (() => {
            let index = 1;
            while (existingCodes.has(`extra_${index}`) || pickedExtras.includes(`extra_${index}`)) {
              index += 1;
            }
            return [{ code: `extra_${index}`, labelAr: label, labelEn: label }];
          })()
        : [];
    const next = [...fromCatalogue, ...custom];
    if (!next.length || !onAddRequirements) return;
    onAddRequirements(next);
    setPickedExtras([]);
    setCustomLabel('');
  }

  if (!requirements.length && !canManage) {
    return hasCheques ? null : (
      <p className="muted">
        {ar
          ? 'لم تطلب مستندات من العميل؛ يمكنك اعتماد العقد مباشرة.'
          : 'No documents requested; you can approve the contract directly.'}
      </p>
    );
  }

  const awaitingOpen =
    requirements.filter((item) => item.status === 'submitted').length +
    (includeCheques
      ? chequeInstructions.filter((item) => chequeByKey.get(item.key)?.status === 'submitted')
          .length
      : 0);
  const needsReplace =
    requirements.filter((item) => item.status === 'rejected').length +
    (includeCheques
      ? chequeInstructions.filter((item) => chequeByKey.get(item.key)?.status === 'rejected').length
      : 0);
  const notUploaded =
    requirements.filter((item) => item.status === 'pending').length +
    (includeCheques
      ? chequeInstructions.filter((item) => !chequeByKey.get(item.key)?.file).length
      : 0);

  return (
    <div className={`lrw__docs lrw__docs--panel${includeCheques ? ' lrw__docs--package' : ''}`}>
      <header className="lrw__docs-head">
        <h4>
          {includeCheques
            ? ar
              ? 'حزمة المستندات والشيكات'
              : 'Documents & cheques package'
            : ar
              ? 'المستندات المطلوبة'
              : 'Required documents'}
        </h4>
        <span className="lrw__docs-count">
          {approvedCount}/{totalCount || 0}
        </span>
      </header>

      {includeCheques && lifecycle.chequePayableTo ? (
        <p className="muted lrw__docs-payee">
          {ar ? 'تُكتب الشيكات باسم: ' : 'Cheques payable to: '}
          <strong>{lifecycle.chequePayableTo}</strong>
          {lifecycle.chequeBankName ? ` · ${lifecycle.chequeBankName}` : ''}
        </p>
      ) : null}

      {totalCount ? (
        <ul className="doc-status-legend" aria-label={ar ? 'مفتاح الحالات' : 'Status key'}>
          <li>
            <DocStatusMark status="approved" ar={ar} viewer="owner" />
            <span>{ar ? 'معتمدة' : 'Approved'}</span>
          </li>
          <li>
            <DocStatusMark status="submitted" ar={ar} viewer="owner" />
            <span>{ar ? 'بانتظار المراجعة' : 'Awaiting review'}</span>
          </li>
          <li>
            <DocStatusMark status="pending" ar={ar} viewer="owner" />
            <span>{ar ? 'لم تُرفع' : 'Not uploaded'}</span>
          </li>
          <li>
            <DocStatusMark status="rejected" ar={ar} viewer="owner" />
            <span>{ar ? 'مطلوب الاستبدال' : 'Replace'}</span>
          </li>
        </ul>
      ) : null}

      {lastDecision ? (
        <p
          className={`notice ${lastDecision.decision === 'approved' ? 'notice--success' : 'notice--info'}`}
          role="status"
        >
          {lastDecision.decision === 'approved'
            ? ar
              ? `✓ تم اعتماد «${lastDecision.label}».`
              : `✓ «${lastDecision.label}» approved.`
            : ar
              ? `أُرجع «${lastDecision.label}» للعميل مع ملاحظتك.`
              : `«${lastDecision.label}» was returned to the client with your note.`}
        </p>
      ) : null}

      {awaitingOpen || needsReplace || notUploaded ? (
        <p className="lrw__docs-remaining muted" role="status">
          {ar
            ? [
                awaitingOpen ? `${awaitingOpen} بانتظار مراجعتك` : null,
                notUploaded ? `${notUploaded} لم تُرفع` : null,
                needsReplace ? `${needsReplace} مطلوب استبدالها` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : [
                awaitingOpen ? `${awaitingOpen} awaiting your review` : null,
                notUploaded ? `${notUploaded} not uploaded` : null,
                needsReplace ? `${needsReplace} need replacement` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>
      ) : totalCount ? (
        <p className="notice notice--success" role="status">
          {ar
            ? 'اكتملت مراجعة الحزمة. يمكنك المتابعة إلى التسليم عند جهوزيته.'
            : 'Package review is complete. You can continue to handover when ready.'}
        </p>
      ) : null}

      {canManage && queue.length ? (
        <div className="lrw__review-bar">
          <p>
            {ar
              ? `${queue.length} مرفق بانتظارك — راجع من البطاقة أعلاه أو من كل صف (عرض / اعتماد / رفض)، وتنقّل بالسابق والتالي.`
              : `${queue.length} attachment(s) waiting — review from the card above or each row (view / approve / reject), and move with previous/next.`}
          </p>
          {!focusedReview ? (
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => openQueueItem(queue[0]!)}
            >
              {ar ? 'بدء المراجعة بالترتيب' : 'Start ordered review'}
            </button>
          ) : null}
        </div>
      ) : null}

      {(reviewItem || reviewChequeItem) && canManage ? (
        <div className="lrw__review-card lrw__review-card--sticky" id="lrw-review-focus">
          <div className="lrw__review-card-head">
            <strong>
              {reviewChequeItem
                ? ar
                  ? reviewChequeItem.labelAr
                  : reviewChequeItem.labelEn
                : ar
                  ? reviewItem!.labelAr
                  : reviewItem!.labelEn || reviewItem!.labelAr}
            </strong>
            <span className="muted">
              {activeQueueIndex >= 0
                ? ar
                  ? `${activeQueueIndex + 1} من ${queue.length}`
                  : `${activeQueueIndex + 1} of ${queue.length}`
                : null}
            </span>
          </div>
          {reviewChequeItem
            ? chequeFactsBlock(reviewChequeItem, reviewChequeSubmitted, ar, locale)
            : null}
          <div className="lrw__doc-actions">
            <DocFileThumb
              href={
                reviewChequeItem
                  ? fileHref(`cheque-${reviewChequeItem.key}`)
                  : fileHref(`doc-${reviewItem!.code}`)
              }
              label={
                reviewChequeItem
                  ? ar
                    ? reviewChequeItem.labelAr
                    : reviewChequeItem.labelEn
                  : ar
                    ? reviewItem!.labelAr
                    : reviewItem!.labelEn || reviewItem!.labelAr
              }
              onOpen={() =>
                reviewChequeItem
                  ? openChequeReview(reviewChequeItem.key)
                  : openReview(reviewItem!.code)
              }
            />
            <button
              type="button"
              className="button button--quiet"
              onClick={() =>
                reviewChequeItem
                  ? openChequeReview(reviewChequeItem.key)
                  : openReview(reviewItem!.code)
              }
            >
              {ar ? 'عرض الملف' : 'View file'}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void decideCurrent('approved')}
            >
              {reviewChequeItem
                ? ar
                  ? 'اعتماد الشيك'
                  : 'Approve cheque'
                : ar
                  ? 'اعتماد المستند'
                  : 'Approve document'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => {
                setRejecting(reviewChequeItem?.key ?? reviewItem!.code);
                setNote('');
              }}
            >
              {ar ? 'رفض مع ملاحظة' : 'Reject with note'}
            </button>
            {queue.length > 1 ? (
              <>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy || activeQueueIndex <= 0}
                  onClick={() => {
                    const prev = queue[activeQueueIndex - 1];
                    if (prev) openQueueItem(prev);
                  }}
                >
                  {ar ? 'السابق' : 'Previous'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy || activeQueueIndex < 0 || activeQueueIndex >= queue.length - 1}
                  onClick={() => {
                    const next = queue[activeQueueIndex + 1];
                    if (next) openQueueItem(next);
                  }}
                >
                  {ar ? 'التالي' : 'Next'}
                </button>
              </>
            ) : null}
          </div>
          {rejecting && (rejecting === reviewItem?.code || rejecting === reviewChequeItem?.key) ? (
            <form
              className="lrw__reject"
              onSubmit={(event) => {
                event.preventDefault();
                if (!note.trim()) return;
                void decideCurrent('rejected', note.trim());
              }}
            >
              <label htmlFor={`reject-focus-${rejecting}`}>
                {ar ? 'سبب الرفض (يظهر للعميل)' : 'Reason (shown to the client)'}
              </label>
              <textarea
                id={`reject-focus-${rejecting}`}
                className="textarea"
                rows={2}
                value={note}
                maxLength={BOOKING_NOTE_MAX}
                required
                onChange={(event) => setNote(event.target.value)}
                placeholder={
                  ar
                    ? 'مثال: الصورة غير واضحة — أعد الرفع بدقة أعلى'
                    : 'e.g. Image is unclear — please re-upload sharper'
                }
              />
              <NoteTranslateBar
                value={note}
                onChange={setNote}
                locale={locale}
                max={BOOKING_NOTE_MAX}
                disabled={busy}
                service={OWNER_NOTE_SERVICE}
              />
              <button type="submit" className="button button--primary" disabled={busy}>
                {ar ? 'تأكيد الرفض وإظهار الملاحظة للعميل' : 'Confirm reject & show note to client'}
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setRejecting(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {requirements.length || includeCheques ? (
        <div className="lrw__docs-lists">
          {requirements.length ? (
            <>
              {includeCheques ? (
                <h5 className="lrw__docs-group">
                  {ar
                    ? `مستندات (${approvedDocs}/${requirements.length})`
                    : `Documents (${approvedDocs}/${requirements.length})`}
                </h5>
              ) : null}
              <ul className="lrw__docs-checklist">
                {requirements.map((item) => {
                  const isFocus = reviewCode === item.code;
                  return (
                    <li
                      key={item.code}
                      className={`lrw__doc lrw__doc--${item.status}${isFocus ? ' lrw__doc--focus' : ''}`}
                    >
                      <DocStatusMark status={item.status} ar={ar} viewer="owner" />
                      {item.file ? (
                        <DocFileThumb
                          href={fileHref(`doc-${item.code}`)}
                          label={ar ? item.labelAr : item.labelEn || item.labelAr}
                          onOpen={() => openReview(item.code)}
                        />
                      ) : null}
                      <div className="lrw__doc-main">
                        <strong>{ar ? item.labelAr : item.labelEn || item.labelAr}</strong>
                        <span className="lrw__doc-status">
                          {item.status === 'approved' && item.autoApproved
                            ? requirementStatusText(item, ar)
                            : docStatusLabel(item.status, ar, 'owner')}
                        </span>
                        {item.note && item.status === 'rejected' ? (
                          <small className="muted">
                            {ar ? 'ملاحظة للعميل: ' : 'Note to client: '}
                            {item.note}
                          </small>
                        ) : null}
                      </div>
                      <div className="lrw__doc-actions">
                        {canManage && item.status === 'submitted' ? (
                          <OwnerAttachmentActions
                            ar={ar}
                            busy={busy}
                            kind="document"
                            queueIndex={queue.findIndex(
                              (q) => q.kind === 'doc' && q.code === item.code,
                            )}
                            queueLength={queue.length}
                            onView={() => openReview(item.code)}
                            onApprove={() =>
                              void decideCurrent('approved', undefined, {
                                kind: 'doc',
                                code: item.code,
                              })
                            }
                            onReject={() => {
                              openReview(item.code);
                              setRejecting(item.code);
                            }}
                            onPrev={() => {
                              const index = queue.findIndex(
                                (q) => q.kind === 'doc' && q.code === item.code,
                              );
                              const prev = queue[index - 1];
                              if (prev) openQueueItem(prev);
                            }}
                            onNext={() => {
                              const index = queue.findIndex(
                                (q) => q.kind === 'doc' && q.code === item.code,
                              );
                              const next = queue[index + 1];
                              if (next) openQueueItem(next);
                            }}
                          />
                        ) : item.file ? (
                          <button
                            type="button"
                            className="button button--quiet"
                            onClick={() => openReview(item.code)}
                          >
                            {ar ? 'عرض الملف' : 'View file'}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {includeCheques ? (
            <>
              <h5 className="lrw__docs-group">
                {ar
                  ? `شيكات (${approvedCheques}/${chequeInstructions.length})`
                  : `Cheques (${approvedCheques}/${chequeInstructions.length})`}
              </h5>
              <ul className="lrw__docs-checklist">
                {chequeInstructions.map((item) => {
                  const row = chequeByKey.get(item.key);
                  const status = row?.status ?? 'pending';
                  const href = row?.file ? fileHref(`cheque-${item.key}`) : null;
                  const isFocus = reviewChequeKey === item.key;
                  return (
                    <li
                      key={item.key}
                      className={`lrw__doc lrw__doc--${status}${isFocus ? ' lrw__doc--focus' : ''}`}
                    >
                      <DocStatusMark status={status} ar={ar} viewer="owner" />
                      {href ? (
                        <DocFileThumb
                          href={href}
                          label={ar ? item.labelAr : item.labelEn}
                          onOpen={() => openChequeReview(item.key)}
                        />
                      ) : null}
                      <div className="lrw__doc-main">
                        <strong>{ar ? item.labelAr : item.labelEn}</strong>
                        <span className="lrw__doc-status">
                          {docStatusLabel(status, ar, 'owner')}
                        </span>
                        {chequeFactsBlock(item, row, ar, locale)}
                        {row?.note && status === 'rejected' ? (
                          <small className="muted">{row.note}</small>
                        ) : null}
                      </div>
                      <div className="lrw__doc-actions">
                        {canManage && status === 'submitted' && row?.file ? (
                          <OwnerAttachmentActions
                            ar={ar}
                            busy={busy}
                            kind="cheque"
                            queueIndex={queue.findIndex(
                              (q) => q.kind === 'cheque' && q.key === item.key,
                            )}
                            queueLength={queue.length}
                            onView={() => openChequeReview(item.key)}
                            onApprove={() =>
                              void decideCurrent('approved', undefined, {
                                kind: 'cheque',
                                key: item.key,
                              })
                            }
                            onReject={() => {
                              openChequeReview(item.key);
                              setRejecting(item.key);
                            }}
                            onPrev={() => {
                              const index = queue.findIndex(
                                (q) => q.kind === 'cheque' && q.key === item.key,
                              );
                              const prev = queue[index - 1];
                              if (prev) openQueueItem(prev);
                            }}
                            onNext={() => {
                              const index = queue.findIndex(
                                (q) => q.kind === 'cheque' && q.key === item.key,
                              );
                              const next = queue[index + 1];
                              if (next) openQueueItem(next);
                            }}
                          />
                        ) : href ? (
                          <button
                            type="button"
                            className="button button--quiet"
                            onClick={() => openChequeReview(item.key)}
                          >
                            {ar ? 'عرض الملف' : 'View file'}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      ) : (
        <p className="muted">
          {ar
            ? 'لا مستندات بعد — يمكنك طلب مستندات أدناه.'
            : 'No documents yet — you can request some below.'}
        </p>
      )}

      {canManage && onAddRequirements ? (
        <form className="lrw__extra-docs" onSubmit={submitExtras}>
          <h5>{ar ? 'طلب مستند إضافي من العميل' : 'Request an extra document from the client'}</h5>
          <p className="muted">
            {ar
              ? 'سيظهر المستند الجديد فوراً في صفحة حجز العميل ليرفعه، ويُرسل له تنبيه بالبريد.'
              : 'The new item appears at once on the client booking page, and they get an email notice.'}
          </p>
          {catalogue.length ? (
            <div className="lrw__extra-docs-chips">
              {catalogue.map((item) => {
                const active = pickedExtras.includes(item.code);
                return (
                  <button
                    key={item.code}
                    type="button"
                    className={`lrw__chip${active ? ' is-active' : ''}`}
                    disabled={busy || requirements.length + pickedExtras.length >= 12}
                    onClick={() =>
                      setPickedExtras((current) =>
                        active
                          ? current.filter((code) => code !== item.code)
                          : [...current, item.code],
                      )
                    }
                  >
                    {ar ? item.labelAr : item.labelEn}
                  </button>
                );
              })}
            </div>
          ) : null}
          <label>
            {ar ? 'أو اكتب مستنداً مخصصاً' : 'Or type a custom document'}
            <input
              className="input"
              maxLength={120}
              value={customLabel}
              disabled={busy || requirements.length >= 12}
              placeholder={ar ? 'مثال: عقد عمل / كشف راتب حديث' : 'e.g. Employment contract'}
              onChange={(event) => setCustomLabel(event.target.value)}
            />
          </label>
          <button
            type="submit"
            className="button button--primary"
            disabled={
              busy ||
              requirements.length >= 12 ||
              (!pickedExtras.length && customLabel.trim().length < 2)
            }
          >
            {ar ? 'إضافة وإظهار للعميل' : 'Add & show to client'}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/** What the client chose while booking, beside the unit's facts, so the contract matches it. */
function ClientRequest({
  ar,
  sale,
  party,
  unit,
  currency,
  salePriceMinor,
  locale,
}: {
  ar: boolean;
  sale: boolean;
  party: ReservationParty | null;
  unit: PropertyRecordUnit;
  currency: string;
  salePriceMinor: string | null;
  locale: 'ar' | 'en';
}) {
  const priceMinor = sale ? salePriceMinor : unit.rentMinor;
  const rows: [string, ReactNode][] = [[ar ? 'الوحدة' : 'Unit', <bdi dir="ltr">{unit.code}</bdi>]];
  if (unit.areaSquareMeters) {
    rows.push([ar ? 'المساحة' : 'Area', <bdi dir="ltr">{unit.areaSquareMeters} m²</bdi>]);
  }
  if (priceMinor && /^\d+$/.test(priceMinor) && priceMinor !== '0') {
    rows.push([
      sale ? (ar ? 'سعر البيع المعلن' : 'Listed price') : ar ? 'الإيجار الشهري' : 'Monthly rent',
      <bdi dir="ltr">{formatMoney(priceMinor, currency, locale)}</bdi>,
    ]);
  }
  if (!sale && party?.contractType) {
    rows.push([
      ar ? 'نوع الاستخدام' : 'Usage type',
      party.contractType === 'commercial'
        ? ar
          ? 'تجاري'
          : 'Commercial'
        : ar
          ? 'سكني'
          : 'Residential',
    ]);
  }
  if (!sale && party?.termMonths) {
    rows.push([
      ar ? 'مدة العقد المطلوبة' : 'Requested term',
      ar ? `${party.termMonths} شهراً` : `${party.termMonths} months`,
    ]);
  }
  if (party) {
    rows.push([
      sale ? (ar ? 'المشتري' : 'Buyer') : ar ? 'المستأجر' : 'Tenant',
      <>
        {partyDisplayName(party, ar)} <PartyNationalityTag party={party} locale={locale} />
        {' · '}
        {party.entityType === 'company' ? (ar ? 'شركة' : 'Company') : ar ? 'فرد' : 'Individual'}
      </>,
    ]);
  }
  return (
    <section className="lrw__request" aria-label={ar ? 'طلب العميل' : 'Client request'}>
      <h4>{ar ? 'بيانات العقار وطلب العميل' : 'Property and client request'}</h4>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {party && !sale ? (
        <p className="muted">
          {ar
            ? 'نوع الاستخدام والمدة مُعبّآن في نموذج العقد أدناه كما اختارهما العميل، ويمكنك تعديلهما.'
            : 'The usage type and term are prefilled in the contract form below as the client chose; you can change them.'}
        </p>
      ) : null}
    </section>
  );
}

function ContractDraftEditor({
  reservationId: _reservationId,
  referenceCode,
  locale,
  portal: _portal,
  mode,
  lifecycle,
  propertyId,
  unit,
  tenant,
  party,
  salePriceMinor,
  currency,
  depositLabel,
  depositMinor,
  depositPaidAt,
  canSign,
  busy,
  onSave,
  onCancel,
}: Props & {
  busy: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const ar = locale === 'ar';
  const sale = mode === 'sale';
  const [bankAccounts, setBankAccounts] = useState<LeaseBankAccountOption[]>([]);
  const [deferUntilHandover, setDeferUntilHandover] = useState<
    ReadonlyArray<'meters' | 'handoverOn'>
  >(lifecycle.autoFlow?.deferUntilHandover ?? []);
  const [documentRules, setDocumentRules] = useState<LeaseDocumentRules>(
    DEFAULT_LEASE_DOCUMENT_RULES,
  );
  const requirementsLocked = (lifecycle.requirements ?? []).length > 0;
  const [requirements, setRequirements] = useState(
    (lifecycle.requirements ?? []).map(({ code, labelAr, labelEn }) => ({
      code,
      labelAr,
      labelEn,
    })),
  );

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/owner/lease-document-rules?propertyId=${encodeURIComponent(propertyId)}`, {
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as {
          own?: { rules?: LeaseDocumentRules } | null;
          inherited?: { rules?: LeaseDocumentRules } | null;
        };
        const rules = data.own?.rules ?? data.inherited?.rules;
        if (!cancelled && rules) setDocumentRules(rules);
      })
      .catch(() => undefined);
    if (sale) {
      return () => {
        cancelled = true;
      };
    }
    void fetch('/api/owner/accounting/settings', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { settings?: AccountingSettings };
        if (cancelled || !data.settings?.bankAccounts) return;
        setBankAccounts(
          data.settings.bankAccounts.map((row) => ({
            id: row.id,
            labelAr: row.labelAr,
            labelEn: row.labelEn,
            bankName: row.bankName,
            accountHolderName: row.accountHolderName,
            accountHolderNameEn: row.accountHolderNameEn,
            defaultForRent: row.defaultForRent,
            active: row.active,
            propertyIds: row.propertyIds,
          })),
        );
      })
      .catch(() => undefined);
    void fetch(
      `/api/owner/approval-policy?propertyId=${encodeURIComponent(propertyId)}&kind=rent`,
      { credentials: 'same-origin' },
    )
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as {
          own?: { policy?: ApprovalPolicy } | null;
          inherited?: { policy?: ApprovalPolicy } | null;
        };
        const policy = data.own?.policy ?? data.inherited?.policy;
        if (!cancelled && policy?.deferUntilHandover) {
          setDeferUntilHandover(policy.deferUntilHandover);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sale, propertyId]);
  const savedLease = lifecycle.contractDraft?.lease as
    { tenant?: LeaseContractPayload['tenant']; terms?: LeaseTermsDraft } | undefined;
  const digits = minorDigitsFor(currency);
  const savedTenant = Object.fromEntries(
    Object.entries(savedLease?.tenant ?? {}).filter(([, value]) => typeof value === 'string'),
  );
  const rentBank = resolveRentBankAccount(
    bankAccounts.map((row) => ({
      id: row.id,
      labelAr: row.labelAr,
      labelEn: row.labelEn,
      bankName: row.bankName,
      accountHolderName: row.accountHolderName,
      accountHolderNameEn: row.accountHolderNameEn ?? '',
      iban: '',
      accountNumber: '',
      currency,
      active: row.active !== false,
      defaultForRent: Boolean(row.defaultForRent),
      propertyIds: row.propertyIds ?? [],
      ledgerAccountId: null,
    })),
    propertyId,
  );
  const bookingTermsSeed = useMemo(() => {
    if (savedLease?.terms) return savedLease.terms;
    return buildBookingLeaseTermsDraft({
      currency,
      rentMinor: unit.rentMinor,
      depositMinor: depositPaidAt ? depositMinor : (unit.depositMinor ?? unit.rentMinor),
      contractType: party?.contractType ?? null,
      termMonths: party?.termMonths ?? null,
      areaSquareMeters: unit.areaSquareMeters,
      bank: rentBank
        ? {
            id: rentBank.id,
            bankName: rentBank.bankName,
            accountHolderName: bankAccountPayeeName(rentBank, false),
          }
        : null,
    });
  }, [
    savedLease?.terms,
    currency,
    unit.rentMinor,
    unit.depositMinor,
    unit.areaSquareMeters,
    depositPaidAt,
    depositMinor,
    party?.contractType,
    party?.termMonths,
    rentBank,
  ]);
  const [saleForm, setSaleForm] = useState({
    signedOn: lifecycle.contractDraft?.sale?.signedOn ?? todayIso(),
    amount: lifecycle.contractDraft?.sale?.amount ?? decimal(salePriceMinor, digits),
    notes: lifecycle.contractDraft?.sale?.notes ?? '',
  });
  const footnote = ar
    ? 'يُحفظ العقد مسودةً ويظهر للعميل أن عقده قيد الإعداد مع قائمة المستندات. بعد اكتمال المستندات تعتمد العقد فيُرسل للتوقيع.'
    : 'Saved as a draft; the client sees the contract is being prepared with the documents list.';

  const clientRequest = (
    <ClientRequest
      ar={ar}
      sale={sale}
      party={party}
      unit={unit}
      currency={currency}
      salePriceMinor={salePriceMinor}
      locale={locale}
    />
  );

  const saleIntro = (
    <div className="lrw__card lrw__card--action">
      <h3>{ar ? 'بيانات عقد البيع والمستندات المطلوبة' : 'Sale contract details & documents'}</h3>
      <p>
        {ar
          ? 'الحجز معتمد. عبّئ بيانات العقد كاملة واختر المستندات التي يلزم أن يوفرها العميل.'
          : 'The booking is approved. Fill in the contract and choose the documents the client must provide.'}
      </p>
      {clientRequest}
      <LeaseRequirementsPicker
        ar={ar}
        sale
        value={requirements}
        onChange={setRequirements}
        rules={documentRules}
        lockInitial={requirementsLocked}
        context={{
          entityType: party?.entityType === 'company' ? 'company' : 'person',
          nationality: party?.entityType === 'person' ? party.person?.nationality : undefined,
          signatoryNationality:
            party?.entityType === 'company'
              ? party.company?.signatories[0]?.nationality
              : undefined,
        }}
      />
    </div>
  );

  const leaseLead = (
    <details className="lrw__fold">
      <summary className="lrw__fold-summary">
        <span className="lrw__fold-title">
          {ar ? 'بيانات عقد الإيجار وطلب العميل' : 'Lease details & client request'}
        </span>
        <span className="lrw__fold-hint muted">
          {ar ? 'مطوي — اضغط للعرض' : 'Collapsed — tap to expand'}
        </span>
      </summary>
      <div className="lrw__fold-body">
        <p className="muted">
          {ar
            ? 'الحجز معتمد. الأقسام أدناه للتعبئة خطوة بخطوة؛ في آخر خطوة تراجع كل الحقول ثم تحفظ.'
            : 'Booking approved. Fill step by step below; the last step reviews every field before you save.'}
        </p>
        {clientRequest}
      </div>
    </details>
  );

  if (sale) {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void onSave({
        action: 'save_contract',
        sale: {
          signedOn: saleForm.signedOn,
          amount: saleForm.amount.trim(),
          ...(saleForm.notes.trim() ? { notes: saleForm.notes.trim() } : {}),
        },
        requirements,
      });
    };
    return (
      <>
        {saleIntro}
        <form className="psr-form" onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="lrw-sale-amount">
                {ar ? `سعر البيع المتفق عليه (${currency})` : `Agreed price (${currency})`}
              </label>
              <input
                id="lrw-sale-amount"
                className="input"
                dir="ltr"
                required
                inputMode="decimal"
                pattern="\d{1,12}(\.\d{1,3})?"
                value={saleForm.amount}
                onChange={(event) => setSaleForm({ ...saleForm, amount: event.target.value })}
              />
              {salePriceMinor ? (
                <p className="field__hint muted">
                  {ar ? 'السعر المعلن: ' : 'Listed price: '}
                  <bdi dir="ltr">{formatMoney(salePriceMinor, currency, locale)}</bdi>
                </p>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="lrw-sale-date">{ar ? 'تاريخ توقيع العقد' : 'Signing date'}</label>
              <input
                id="lrw-sale-date"
                className="input"
                type="date"
                required
                value={saleForm.signedOn}
                onChange={(event) => setSaleForm({ ...saleForm, signedOn: event.target.value })}
              />
            </div>
            <div className="field span-2">
              <label htmlFor="lrw-sale-notes">{ar ? 'شروط وملاحظات' : 'Terms & notes'}</label>
              <textarea
                id="lrw-sale-notes"
                className="input"
                rows={4}
                maxLength={2000}
                value={saleForm.notes}
                onChange={(event) => setSaleForm({ ...saleForm, notes: event.target.value })}
              />
            </div>
          </div>
          <p className="muted">{footnote}</p>
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ العقد والمستندات' : 'Save'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={onCancel}
              disabled={busy}
            >
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <div className="lrw__contract-focus">
      <LeaseContractForm
        key={`lease-draft:${savedLease?.terms ? 'saved' : 'seed'}:${party?.contractType ?? ''}:${rentBank?.id ?? 'nobank'}`}
        units={[unit]}
        tenants={[tenant]}
        canSign={canSign}
        locale={locale}
        busy={busy}
        bankAccounts={bankAccounts}
        propertyId={propertyId}
        deferUntilHandover={deferUntilHandover}
        municipalAfterHandover
        lockTenantName={Boolean(party)}
        tenantFromDirectory
        paidDepositMinor={depositPaidAt ? depositMinor : null}
        arabonReceiptHref={`/${locale}/book/receipt?ref=${encodeURIComponent(referenceCode)}`}
        arabonReceiptLabel={depositLabel}
        requirements={requirements}
        onRequirementsChange={setRequirements}
        documentRules={documentRules}
        requirementsLocked={requirementsLocked}
        lead={leaseLead}
        heading={undefined}
        submitLabel={ar ? 'حفظ العقد والمستندات' : 'Save contract & documents'}
        footnote={footnote}
        initialTenant={{
          ...(party
            ? partyToLeaseTenant(party)
            : {
                entityType: tenant.type,
                nameAr: tenant.displayName,
                email: tenant.email ?? '',
                phone: tenant.phone ?? '',
              }),
          ...savedTenant,
          partyId: tenant.id,
        }}
        initialTerms={bookingTermsSeed}
        termsSeed={party?.termMonths ? { months: party.termMonths } : undefined}
        onSubmit={(payload) =>
          void onSave({ action: 'save_contract', lease: payload, requirements })
        }
        onCancel={onCancel}
      />
    </div>
  );
}
