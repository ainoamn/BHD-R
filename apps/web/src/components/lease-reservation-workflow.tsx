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

import { FilePreviewDialog, type PreviewFile } from '@/components/file-preview';
import {
  LeaseContractForm,
  type LeaseBankAccountOption,
  type LeaseContractPayload,
} from '@/components/lease-contract-form';
import { LeaseRequirementsPicker } from '@/components/lease-requirements-picker';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { AccountingSettings } from '@/lib/accounting-integrity';
import type { ApprovalPolicy } from '@/lib/approval-policy';
import {
  DEFAULT_LEASE_DOCUMENT_RULES,
  type LeaseDocumentRules,
} from '@/lib/lease-document-rules';
import {
  documentsPhase,
  documentsToVerify,
  leaseJourneyStageIndex,
  leaseJourneyStageLabels,
  leasePhaseLabel,
  REQUIREMENT_CATALOGUE,
  type LeaseJourneyPhase,
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
          <input
            id="lrw-payment-note"
            className="input"
            value={note}
            minLength={2}
            maxLength={500}
            required
            onChange={(event) => setNote(event.target.value)}
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
 * Documents the system accepted for the owner: the team confirms each one, or rejects one as
 * breaking the requirements, which cancels the booking straight away.
 */
function VerificationPanel({
  lifecycle,
  locale,
  busy,
  fileHref,
  onVerify,
}: Props & {
  busy: boolean;
  fileHref: (file: string) => string;
  onVerify: (code: string, decision: 'verified' | 'rejected', note?: string) => Promise<void>;
}) {
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const pending = documentsToVerify(lifecycle);
  return (
    <div className="lrw__card lrw__card--verify">
      <h3>
        {t(
          'تحقّق من المستندات المعتمدة إلكترونياً',
          'Verify the electronically accepted documents',
        )}
      </h3>
      <p>
        {t(
          'قبل النظام هذه المستندات نيابةً عنك. راجع كل مستند: إن كان سليماً أكّده، وإن خالف الاشتراطات أو لم يكن ملائماً فرفضه يلغي الحجز مباشرة كما أُبلغ العميل.',
          'The system accepted these for you. Check each one: confirm it if it is fine; rejecting one for breaking the requirements cancels the booking at once, as the client was told.',
        )}
      </p>
      <ul className="lrw__docs-list">
        {pending.map((item) => (
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
                  setRejecting(item.code);
                  setNote('');
                }}
              >
                {t('مخالف — إلغاء الحجز', 'Invalid — cancel booking')}
              </button>
            </div>
            {rejecting === item.code ? (
              <form
                className="lrw__reject"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!note.trim()) return;
                  void onVerify(item.code, 'rejected', note.trim()).then(() => setRejecting(null));
                }}
              >
                <label htmlFor={`verify-${item.code}`}>
                  {t('سبب المخالفة (يظهر للعميل)', 'What is wrong (shown to the client)')}
                </label>
                <input
                  id={`verify-${item.code}`}
                  className="input"
                  value={note}
                  maxLength={500}
                  required
                  onChange={(event) => setNote(event.target.value)}
                />
                <p className="notice notice--error">
                  {t(
                    'سيُلغى الحجز فوراً، ويُلغى العقد المرتبط به إن صدر، ويُبلَّغ العميل بالسبب.',
                    'The booking is cancelled at once, any issued contract is voided, and the client sees the reason.',
                  )}
                </p>
                <button type="submit" className="button button--danger" disabled={busy}>
                  {t('تأكيد المخالفة وإلغاء الحجز', 'Confirm and cancel the booking')}
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
  const viewing = serverProps.onViewingChange
    ? (serverProps.viewing ?? null)
    : localViewing;
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
      serverProps.phase === 'awaiting_documents_review' ||
      serverProps.phase === 'awaiting_contract_approval')
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
    phase === 'awaiting_contract_draft' ||
    ((phase === 'awaiting_documents' ||
      phase === 'awaiting_documents_review' ||
      phase === 'awaiting_contract_approval') &&
      editing);

  return (
    <PreviewContext.Provider value={setPreview}>
      <section className="ops-panel lrw" aria-label={t('مراحل الحجز', 'Booking stages')}>
        <header className="lrw__head">
          <div>
            <span className="ops-kicker">{t('مسار الحجز', 'Booking journey')}</span>
            <h2>{leasePhaseLabel(phase, ar)}</h2>
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
              <div className="lrw__card lrw__card--cancelled">
                <h3>{t('الحجز ملغى', 'Booking cancelled')}</h3>
                <p>{cancelReasonText(lifecycle.cancellation.reason, ar)}</p>
                {lifecycle.cancellation.note ? (
                  <p className="muted">
                    {t('الملاحظة المرسلة للعميل: ', 'Note sent to the client: ')}
                    {lifecycle.cancellation.note}
                  </p>
                ) : null}
                <p className="muted">
                  {new Date(lifecycle.cancellation.at).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
                    timeZone: 'Asia/Muscat',
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {lifecycle.cancellation.byName ? ` · ${lifecycle.cancellation.byName}` : ''}
                </p>
              </div>
            ) : null}

            {canManage && phase !== 'closed' && documentsToVerify(lifecycle).length ? (
              <VerificationPanel
                {...props}
                busy={busy}
                fileHref={fileHref}
                onVerify={(code, decision, note) =>
                  decision === 'verified'
                    ? decide(
                        code,
                        { status: 'approved', verifiedAt: new Date().toISOString() },
                        { action: 'verify_document', code, decision },
                      )
                    : act({ action: 'verify_document', code, decision, ...(note ? { note } : {}) })
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

            {!draftOpen &&
            (phase === 'awaiting_documents' ||
              phase === 'awaiting_documents_review' ||
              phase === 'awaiting_contract_approval') ? (
              <div className="lrw__card lrw__desk">
                <div className="lrw__desk-head">
                  <div>
                    <h3>
                      {sale ? t('عقد البيع', 'Sale contract') : t('عقد الإيجار', 'Lease contract')}
                    </h3>
                    <p className="muted">
                      {t(
                        'راجع ملخص العقد، ثم تابع مستندات العميل والشيكات حتى يُفتح الاعتماد.',
                        'Review the contract summary, then track client documents and cheques until approval opens.',
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
                <div className="lrw__desk-grid">
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
                  <ChequesReview
                    {...props}
                    busy={busy}
                    fileHref={fileHref}
                    onReview={(key, decision, note) =>
                      act({
                        action: 'review_cheque',
                        key,
                        decision,
                        ...(note ? { note } : {}),
                      })
                    }
                  />
                </div>
                <div className="lrw__approve">
                  <p className="muted">
                    {phase === 'awaiting_contract_approval'
                      ? t(
                          'المستندات والشيكات مكتملة. باعتمادك يوقَّع العقد باسم المالك ويُرسل للعميل ليوقّعه إلكترونياً.',
                          'Documents and cheques are complete. Approving signs for the owner and sends the contract to the client to e-sign.',
                        )
                      : t(
                          'يُفتح اعتماد العقد بعد أن يرفع العميل كل المستندات والشيكات المطلوبة وتقبلها.',
                          'Contract approval opens once every required document and cheque is uploaded and accepted.',
                        )}
                  </p>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={busy || phase !== 'awaiting_contract_approval' || !canSign}
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

            {phase === 'awaiting_tenant_signature' ? (
              <div className="lrw__card">
                <h3>{t('بانتظار توقيع الطرف الثاني', 'Awaiting the second party')}</h3>
                <p>
                  {lifecycle.contract?.automatic
                    ? t(
                        `اعتمد النظام العقد ${lifecycle.contract.reference} نيابةً عنك بعد اكتمال المستندات ووُقّع باسم المالك. ينتظر الآن توقيع ${sale ? 'المشتري' : 'المستأجر'} إلكترونياً من صفحة حجزه.`,
                        `The system approved contract ${lifecycle.contract.reference} for you once the documents were in; it is signed for the owner and awaits the ${sale ? 'buyer' : 'tenant'}'s e-signature.`,
                      )
                    : t(
                        `اعتمدت العقد ${lifecycle.contract?.reference ?? ''} ووُقّع باسم المالك. ينتظر الآن توقيع ${sale ? 'المشتري' : 'المستأجر'} إلكترونياً من صفحة حجزه.`,
                        `You approved contract ${lifecycle.contract?.reference ?? ''}; it is signed for the owner and now awaits the ${sale ? 'buyer' : 'tenant'}'s e-signature.`,
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
                <p>
                  {t(
                    'العقد موقّع من الطرفين. عند حضور المستأجر لاستلام المفاتيح يعرض رمز التسليم المشفّر من حسابه، فيمسحه المالك أو ممثله أو حارس المبنى، فيلتقط كل من المستلم والمسلِّم صورة سيلفي في اللحظة نفسها، ثم يوثّق المسلِّم حالة العقار. يصل للمستأجر إشعار ليوافق، وبموافقته يُعدّ العقار مسلَّماً بالطريقة القانونية والنظامية.',
                    'The contract is signed by both parties. When the tenant comes for the keys they show the sealed handover code from their account; the owner, a representative or the building guard scans it, the tenant and the person handing over each take a selfie at the same moment, and the premises are recorded. The tenant is notified to accept, which completes the handover legally.',
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
                  <a className="button button--primary" href={`/${locale}/handover`}>
                    {t('فتح شاشة التسليم', 'Open the handover screen')}
                  </a>
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

            {phase === 'awaiting_handover' && lifecycle.handover ? (
              <div className="lrw__card">
                <h3>
                  {t(
                    'سُجّل التسليم — بانتظار موافقة المستأجر',
                    'Handover recorded — awaiting the tenant',
                  )}
                </h3>
                <p className="muted">
                  {t(
                    `سجّله ${lifecycle.handover.byName ?? '—'} بمسح رمز المستأجر. وصل للمستأجر إشعار ليوافق على استلام العقار.`,
                    `Recorded by ${lifecycle.handover.byName ?? '—'} by scanning the tenant’s code. The tenant was notified to accept.`,
                  )}
                </p>
                <HandoverFacts handover={lifecycle.handover} ar={ar} />
                <HandoverPhotos
                  handover={lifecycle.handover}
                  ar={ar}
                  fileHref={fileHref}
                  showRecipient={canManage}
                />
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
            (!lifecycle.handover.status || lifecycle.handover.status === 'accepted') ? (
              <MunicipalRegistrationCard
                ar={ar}
                t={t}
                busy={busy}
                canManage={canManage}
                registration={lifecycle.municipalRegistration}
                draftTerms={
                  (lifecycle.contractDraft?.lease as { terms?: LeaseTermsDraft } | undefined)
                    ?.terms
                }
                onSave={(formNo, contractNo) =>
                  void act({
                    action: 'save_municipal_registration',
                    formNo,
                    contractNo,
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
  draftTerms,
  onSave,
}: {
  ar: boolean;
  t: (arText: string, enText: string) => string;
  busy: boolean;
  canManage: boolean;
  registration: ReservationLifecycle['municipalRegistration'];
  draftTerms?: LeaseTermsDraft | undefined;
  onSave: (formNo: string, contractNo: string) => void;
}) {
  const [formNo, setFormNo] = useState(
    registration?.formNo ?? draftTerms?.municipalFormNo ?? '',
  );
  const [contractNo, setContractNo] = useState(
    registration?.contractNo ?? draftTerms?.municipalContractNo ?? '',
  );
  const [editing, setEditing] = useState(!registration);

  useEffect(() => {
    if (registration) {
      setFormNo(registration.formNo);
      setContractNo(registration.contractNo);
      setEditing(false);
    }
  }, [registration]);

  const formMissing = !formNo.trim();
  const contractMissing = !contractNo.trim();

  if (registration && !editing) {
    return (
      <div className="lrw__card">
        <h3>{t('تسجيل العقد البلدي', 'Municipal contract registration')}</h3>
        <dl className="contract-detail__facts">
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
            {t('تعديل الأرقام', 'Edit numbers')}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="lrw__card lrw__card--action">
      <h3>{t('تسجيل العقد البلدي', 'Municipal contract registration')}</h3>
      <p>
        {t(
          'بعد تسليم العقار أدخل رقم استمارة العقد البلدي ورقم العقد البلدي — الحقلان إلزاميان.',
          'After handover, enter the municipal form number and municipal contract number — both are required.',
        )}
      </p>
      <form
        className="form-grid"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (formMissing || contractMissing) return;
          onSave(formNo.trim(), contractNo.trim());
        }}
      >
        <div className={`field field--required-mark${formMissing ? ' field--missing' : ' field--ok'}`}>
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
              disabled={busy || formMissing || contractMissing}
            >
              {busy
                ? t('جارٍ الحفظ…', 'Saving…')
                : t('حفظ أرقام البلدية', 'Save municipal numbers')}
            </button>
            {registration ? (
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => {
                  setFormNo(registration.formNo);
                  setContractNo(registration.contractNo);
                  setEditing(false);
                }}
              >
                {t('إلغاء', 'Cancel')}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="muted span-2">
            {t('يلزم صلاحية إدارة الحجوزات لإدخال الأرقام.', 'Booking manage permission is required.')}
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
        <DraftSummary {...props} />
        <RequirementsReview
          {...props}
          canManage={false}
          busy
          fileHref={props.fileHref}
          onReview={async () => undefined}
        />
      </>
    );
  } else if (index === 3) {
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
        {contractHref ? (
          <a className="button button--quiet" href={contractHref}>
            {t('عرض العقد', 'View contract')}
          </a>
        ) : null}
      </>
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

function ChequesReview({
  lifecycle,
  locale,
  busy,
  canManage,
  fileHref,
  onReview,
}: Props & {
  busy: boolean;
  fileHref: (file: string) => string;
  onReview: (key: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>;
}) {
  const ar = locale === 'ar';
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const instructions = lifecycle.chequeInstructions ?? [];
  if (!instructions.length) return null;
  const byKey = new Map((lifecycle.chequeSubmissions ?? []).map((row) => [row.key, row]));
  return (
    <div className="lrw__docs lrw__docs--panel">
      <header className="lrw__docs-head">
        <h4>{ar ? 'الشيكات من العميل' : 'Cheques from the client'}</h4>
        <span className="lrw__docs-count">
          {instructions.filter((item) => byKey.get(item.key)?.status === 'approved').length}/
          {instructions.length}
        </span>
      </header>
      {lifecycle.chequePayableTo ? (
        <p className="muted lrw__docs-payee">
          {ar ? 'تُكتب باسم: ' : 'Payable to: '}
          <strong>{lifecycle.chequePayableTo}</strong>
          {lifecycle.chequeBankName ? ` · ${lifecycle.chequeBankName}` : ''}
        </p>
      ) : null}
      <ul>
        {instructions.map((item) => {
          const submitted = byKey.get(item.key);
          const status = submitted?.status ?? 'pending';
          return (
            <li key={item.key} className={`lrw__doc lrw__doc--${status}`}>
              <div className="lrw__doc-main">
                <strong>{ar ? item.labelAr : item.labelEn}</strong>
                <span className="lrw__doc-status">
                  {STATUS_TEXT[status][ar ? 0 : 1]}
                  {submitted?.chequeNumber ? ` · #${submitted.chequeNumber}` : ''}
                </span>
                {submitted ? (
                  <small className="muted" dir="auto">
                    {submitted.bankName}
                    {submitted.accountHolderName ? ` · ${submitted.accountHolderName}` : ''}
                  </small>
                ) : null}
                {submitted?.note && status === 'rejected' ? (
                  <small className="muted">{submitted.note}</small>
                ) : null}
              </div>
              <div className="lrw__doc-actions">
                {submitted?.file ? (
                  <ViewFileButton
                    href={fileHref(`cheque-${item.key}`)}
                    label={ar ? item.labelAr : item.labelEn}
                    ar={ar}
                  />
                ) : null}
                {canManage && status === 'submitted' ? (
                  <>
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={busy}
                      onClick={() => void onReview(item.key, 'approved')}
                    >
                      {ar ? 'قبول' : 'Accept'}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={busy}
                      onClick={() => {
                        setRejecting(item.key);
                        setNote('');
                      }}
                    >
                      {ar ? 'رفض' : 'Reject'}
                    </button>
                  </>
                ) : null}
              </div>
              {rejecting === item.key ? (
                <form
                  className="lrw__reject"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!note.trim()) return;
                    void onReview(item.key, 'rejected', note.trim()).then(() => setRejecting(null));
                  }}
                >
                  <label htmlFor={`reject-cheque-${item.key}`}>
                    {ar ? 'سبب الرفض (يظهر للعميل)' : 'Reason (shown to the client)'}
                  </label>
                  <input
                    id={`reject-cheque-${item.key}`}
                    className="input"
                    required
                    maxLength={500}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <button type="submit" className="button button--primary" disabled={busy}>
                    {ar ? 'تأكيد الرفض' : 'Confirm rejection'}
                  </button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
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
  onAddRequirements,
}: Props & {
  busy: boolean;
  fileHref: (file: string) => string;
  onReview: (code: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>;
  onAddRequirements: (
    requirements: Array<{ code: string; labelAr: string; labelEn: string }>,
  ) => void;
}) {
  const ar = locale === 'ar';
  const sale = mode === 'sale';
  const preview = useContext(PreviewContext);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reviewCode, setReviewCode] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [pickedExtras, setPickedExtras] = useState<string[]>([]);
  const requirements = lifecycle.requirements ?? [];
  const hasCheques = (lifecycle.chequeInstructions ?? []).length > 0;
  const submitted = requirements.filter((item) => item.status === 'submitted' && item.file);
  const approvedCount = requirements.filter((item) => item.status === 'approved').length;
  const existingCodes = new Set(requirements.map((item) => item.code));
  const catalogue = REQUIREMENT_CATALOGUE.filter(
    (item) => (sale ? item.sale : item.rent) && !existingCodes.has(item.code),
  );
  const reviewItem =
    (reviewCode && requirements.find((item) => item.code === reviewCode)) ||
    submitted[0] ||
    null;
  const reviewIndex = reviewItem
    ? submitted.findIndex((item) => item.code === reviewItem.code)
    : -1;

  function openReview(code: string) {
    const item = requirements.find((row) => row.code === code);
    if (!item?.file) return;
    setReviewCode(code);
    setRejecting(null);
    setNote('');
    preview({
      href: fileHref(`doc-${code}`),
      label: ar ? item.labelAr : item.labelEn || item.labelAr,
    });
  }

  async function decideCurrent(decision: 'approved' | 'rejected', rejectNote?: string) {
    if (!reviewItem) return;
    await onReview(reviewItem.code, decision, rejectNote);
    const remaining = submitted.filter((item) => item.code !== reviewItem.code);
    if (remaining[0]) {
      openReview(remaining[0].code);
    } else {
      setReviewCode(null);
      setRejecting(null);
      setNote('');
    }
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
    if (!next.length) return;
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

  return (
    <div className="lrw__docs lrw__docs--panel">
      <header className="lrw__docs-head">
        <h4>{ar ? 'المستندات المطلوبة' : 'Required documents'}</h4>
        <span className="lrw__docs-count">
          {approvedCount}/{requirements.length || 0}
        </span>
      </header>

      {canManage && submitted.length ? (
        <div className="lrw__review-bar">
          <p>
            {ar
              ? `${submitted.length} مستند بانتظار مراجعتك — استعرضه ثم اقبله أو ارفضه مع ملاحظة.`
              : `${submitted.length} document(s) awaiting review — preview, then accept or reject with a note.`}
          </p>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => openReview(submitted[0]!.code)}
          >
            {ar ? 'بدء المراجعة واحداً تلو الآخر' : 'Review one by one'}
          </button>
        </div>
      ) : null}

      {reviewItem && canManage && reviewItem.status === 'submitted' ? (
        <div className="lrw__review-card">
          <div className="lrw__review-card-head">
            <strong>
              {ar ? reviewItem.labelAr : reviewItem.labelEn || reviewItem.labelAr}
            </strong>
            <span className="muted">
              {reviewIndex >= 0
                ? ar
                  ? `${reviewIndex + 1} من ${submitted.length}`
                  : `${reviewIndex + 1} of ${submitted.length}`
                : null}
            </span>
          </div>
          <div className="lrw__doc-actions">
            <ViewFileButton
              href={fileHref(`doc-${reviewItem.code}`)}
              label={ar ? reviewItem.labelAr : reviewItem.labelEn || reviewItem.labelAr}
              ar={ar}
            />
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void decideCurrent('approved')}
            >
              {ar ? 'قبول' : 'Accept'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => {
                setRejecting(reviewItem.code);
                setNote('');
              }}
            >
              {ar ? 'رفض مع ملاحظة' : 'Reject with note'}
            </button>
            {submitted.length > 1 ? (
              <>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy || reviewIndex <= 0}
                  onClick={() => {
                    const prev = submitted[reviewIndex - 1];
                    if (prev) openReview(prev.code);
                  }}
                >
                  {ar ? 'السابق' : 'Previous'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy || reviewIndex < 0 || reviewIndex >= submitted.length - 1}
                  onClick={() => {
                    const next = submitted[reviewIndex + 1];
                    if (next) openReview(next.code);
                  }}
                >
                  {ar ? 'التالي' : 'Next'}
                </button>
              </>
            ) : null}
          </div>
          {rejecting === reviewItem.code ? (
            <form
              className="lrw__reject"
              onSubmit={(event) => {
                event.preventDefault();
                if (!note.trim()) return;
                void decideCurrent('rejected', note.trim());
              }}
            >
              <label htmlFor={`reject-focus-${reviewItem.code}`}>
                {ar ? 'سبب الرفض (يظهر للعميل)' : 'Reason (shown to the client)'}
              </label>
              <textarea
                id={`reject-focus-${reviewItem.code}`}
                className="textarea"
                rows={2}
                value={note}
                maxLength={500}
                required
                onChange={(event) => setNote(event.target.value)}
                placeholder={
                  ar
                    ? 'مثال: الصورة غير واضحة — أعد الرفع بدقة أعلى'
                    : 'e.g. Image is unclear — please re-upload sharper'
                }
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

      {requirements.length ? (
        <ul>
          {requirements.map((item) => (
            <li key={item.code} className={`lrw__doc lrw__doc--${item.status}`}>
              <div className="lrw__doc-main">
                <strong>{ar ? item.labelAr : item.labelEn || item.labelAr}</strong>
                <span className="lrw__doc-status">{requirementStatusText(item, ar)}</span>
                {item.note && item.status === 'rejected' ? (
                  <small className="muted">
                    {ar ? 'ملاحظة للعميل: ' : 'Note to client: '}
                    {item.note}
                  </small>
                ) : null}
                {item.file?.name ? (
                  <small className="muted" dir="auto">
                    {item.file.name}
                  </small>
                ) : null}
              </div>
              <div className="lrw__doc-actions">
                {item.file ? (
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => openReview(item.code)}
                  >
                    {ar ? 'عرض' : 'View'}
                  </button>
                ) : null}
                {canManage && item.status === 'submitted' ? (
                  <>
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={busy}
                      onClick={() => void onReview(item.code, 'approved')}
                    >
                      {ar ? 'قبول' : 'Accept'}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={busy}
                      onClick={() => {
                        setReviewCode(item.code);
                        setRejecting(item.code);
                        setNote('');
                        if (item.file) {
                          preview({
                            href: fileHref(`doc-${item.code}`),
                            label: ar ? item.labelAr : item.labelEn || item.labelAr,
                          });
                        }
                      }}
                    >
                      {ar ? 'رفض' : 'Reject'}
                    </button>
                  </>
                ) : null}
              </div>
              {rejecting === item.code && reviewCode !== item.code ? (
                <form
                  className="lrw__reject"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!note.trim()) return;
                    void onReview(item.code, 'rejected', note.trim()).then(() => {
                      setRejecting(null);
                      setNote('');
                    });
                  }}
                >
                  <label htmlFor={`reject-${item.code}`}>
                    {ar ? 'سبب الرفض (يظهر للعميل)' : 'Reason (shown to the client)'}
                  </label>
                  <textarea
                    id={`reject-${item.code}`}
                    className="textarea"
                    rows={2}
                    value={note}
                    maxLength={500}
                    required
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <button type="submit" className="button button--primary" disabled={busy}>
                    {ar ? 'إرسال الرفض' : 'Send rejection'}
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
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {ar
            ? 'لا مستندات بعد — يمكنك طلب مستندات أدناه.'
            : 'No documents yet — you can request some below.'}
        </p>
      )}

      {canManage ? (
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
        {partyDisplayName(party, ar)}{' '}
        <PartyNationalityTag party={party} locale={locale} />
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
  reservationId,
  referenceCode,
  locale,
  portal,
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
    void fetch(
      `/api/owner/lease-document-rules?propertyId=${encodeURIComponent(propertyId)}`,
      { credentials: 'same-origin' },
    )
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
          nationality:
            party?.entityType === 'person' ? party.person?.nationality : undefined,
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
            <button type="button" className="button button--quiet" onClick={onCancel} disabled={busy}>
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
        initialTerms={savedLease?.terms}
        termsSeed={party?.termMonths ? { months: party.termMonths } : undefined}
        onSubmit={(payload) =>
          void onSave({ action: 'save_contract', lease: payload, requirements })
        }
        onCancel={onCancel}
      />
    </div>
  );
}
