'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { LeaseContractForm, type LeaseContractPayload } from '@/components/lease-contract-form';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  REQUIREMENT_CATALOGUE,
  documentsToVerify,
  leaseJourneyStageIndex,
  leaseJourneyStageLabels,
  leasePhaseLabel,
  type LeaseJourneyPhase,
  type ReservationLifecycle,
  type ReservationRequirement,
} from '@/lib/lease-reservation-lifecycle';
import { minorDigitsFor, type LeaseTermsDraft } from '@/lib/lease-terms';
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

type Props = {
  reservationId: string;
  referenceCode: string;
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  mode: 'rent' | 'sale';
  phase: LeaseJourneyPhase;
  lifecycle: ReservationLifecycle;
  unit: PropertyRecordUnit;
  tenant: PropertyRecordTenant;
  /** Tenant or buyer details the customer filled in while booking. */
  party: ReservationParty | null;
  salePriceMinor: string | null;
  currency: string;
  depositLabel: string;
  depositPaidAt: string | null;
  termsAcceptedAt: string | null;
  hasEsign: boolean;
  canManage: boolean;
  canSign: boolean;
};

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
                <a
                  className="button button--quiet"
                  href={fileHref(`doc-${item.code}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('عرض الملف', 'View file')}
                </a>
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
export function LeaseReservationWorkflow(props: Props) {
  const { reservationId, locale, mode, phase, lifecycle, canManage, canSign } = props;
  const ar = locale === 'ar';
  const t = (arText: string, enText: string) => (ar ? arText : enText);
  const sale = mode === 'sale';
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const stage = leaseJourneyStageIndex(phase);
  const labels = leaseJourneyStageLabels(sale, ar);
  /** A completed stage the owner opened to review; later stages stay locked. */
  const reviewing = viewing !== null && viewing < stage ? viewing : null;
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
      router.refresh();
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  const draftOpen =
    phase === 'awaiting_contract_draft' ||
    ((phase === 'awaiting_documents' ||
      phase === 'awaiting_documents_review' ||
      phase === 'awaiting_contract_approval') &&
      editing);

  return (
    <section className="ops-panel lrw" aria-label={t('مراحل الحجز', 'Booking stages')}>
      <header className="lrw__head">
        <div>
          <span className="ops-kicker">{t('مسار الحجز', 'Booking journey')}</span>
          <h2>{leasePhaseLabel(phase, ar)}</h2>
        </div>
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
                act({ action: 'verify_document', code, decision, ...(note ? { note } : {}) })
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
                  {busy ? t('جارٍ الاعتماد…', 'Approving…') : t('اعتماد الحجز', 'Approve booking')}
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
            <div className="lrw__card">
              <div className="lrw__card-head">
                <h3>
                  {sale ? t('عقد البيع', 'Sale contract') : t('عقد الإيجار', 'Lease contract')}
                </h3>
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
                  act({ action: 'review_document', code, decision, ...(note ? { note } : {}) })
                }
              />
              <div className="lrw__approve">
                <p className="muted">
                  {phase === 'awaiting_contract_approval'
                    ? t(
                        'المستندات مكتملة. باعتمادك يوقَّع العقد باسم المالك ويُرسل للعميل ليوقّعه إلكترونياً.',
                        'Documents are complete. Approving signs for the owner and sends the contract to the client to e-sign.',
                      )
                    : t(
                        'يُفتح اعتماد العقد بعد أن يرفع العميل كل المستندات المطلوبة وتقبلها.',
                        'Contract approval opens once every required document is uploaded and accepted.',
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

          {phase === 'awaiting_handover' ? (
            <HandoverForm
              {...props}
              busy={busy}
              contractHref={contractHref}
              onSave={(body) => act({ action: 'record_handover', ...body })}
            />
          ) : null}

          {phase === 'handed_over' && lifecycle.handover ? (
            <div className="lrw__card">
              <h3>{t('تم تسليم العقار', 'Premises handed over')}</h3>
              <HandoverFacts handover={lifecycle.handover} ar={ar} />
              {contractHref ? (
                <a className="button button--quiet" href={contractHref}>
                  {t('عرض العقد الموقّع', 'View signed contract')}
                </a>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {props.hasEsign && canManage ? <IdentityGallery ar={ar} fileHref={fileHref} /> : null}
    </section>
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
    </dl>
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
          <a
            key={file}
            href={fileHref(file)}
            target="_blank"
            rel="noreferrer"
            className="lrw__shot"
          >
            <img src={fileHref(file)} alt={ar ? labelAr : labelEn} loading="lazy" />
            <span>{ar ? labelAr : labelEn}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function DraftSummary({ lifecycle, locale, currency, mode }: Props) {
  const ar = locale === 'ar';
  const draft = lifecycle.contractDraft;
  if (!draft) return null;
  if (mode === 'sale' && draft.sale) {
    return (
      <dl className="contract-detail__facts">
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
  return (
    <dl className="contract-detail__facts">
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
        <dt>{ar ? 'التأمين' : 'Deposit'}</dt>
        <dd dir="ltr">
          {terms.deposit || '—'} {currency}
        </dd>
      </div>
      <div>
        <dt>{ar ? 'آخر حفظ' : 'Last saved'}</dt>
        <dd>
          {new Date(draft.savedAt).toLocaleString(ar ? 'ar-OM' : 'en-GB', {
            timeZone: 'Asia/Muscat',
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
          {draft.byName ? ` · ${draft.byName}` : ''}
        </dd>
      </div>
    </dl>
  );
}

function RequirementsReview({
  lifecycle,
  locale,
  busy,
  canManage,
  fileHref,
  onReview,
}: Props & {
  busy: boolean;
  fileHref: (file: string) => string;
  onReview: (code: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>;
}) {
  const ar = locale === 'ar';
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const requirements = lifecycle.requirements ?? [];
  if (!requirements.length) {
    return (
      <p className="muted">
        {ar
          ? 'لم تطلب مستندات من العميل؛ يمكنك اعتماد العقد مباشرة.'
          : 'No documents requested; you can approve the contract directly.'}
      </p>
    );
  }
  return (
    <div className="lrw__docs">
      <h4>{ar ? 'المستندات المطلوبة من العميل' : 'Documents requested from the client'}</h4>
      <ul>
        {requirements.map((item) => (
          <li key={item.code} className={`lrw__doc lrw__doc--${item.status}`}>
            <div className="lrw__doc-main">
              <strong>{ar ? item.labelAr : item.labelEn || item.labelAr}</strong>
              <span className="lrw__doc-status">{requirementStatusText(item, ar)}</span>
              {item.note && item.status === 'rejected' ? (
                <small className="muted">{item.note}</small>
              ) : null}
            </div>
            <div className="lrw__doc-actions">
              {item.file ? (
                <a
                  className="button button--quiet"
                  href={fileHref(`doc-${item.code}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {ar ? 'عرض الملف' : 'View file'}
                </a>
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
                      setRejecting(item.code);
                      setNote('');
                    }}
                  >
                    {ar ? 'رفض' : 'Reject'}
                  </button>
                </>
              ) : null}
            </div>
            {rejecting === item.code ? (
              <form
                className="lrw__reject"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!note.trim()) return;
                  void onReview(item.code, 'rejected', note.trim()).then(() => setRejecting(null));
                }}
              >
                <label htmlFor={`reject-${item.code}`}>
                  {ar ? 'سبب الرفض (يظهر للعميل)' : 'Reason (shown to the client)'}
                </label>
                <input
                  id={`reject-${item.code}`}
                  className="input"
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
    </div>
  );
}

function RequirementsPicker({
  ar,
  sale,
  value,
  onChange,
}: {
  ar: boolean;
  sale: boolean;
  value: Array<{ code: string; labelAr: string; labelEn: string }>;
  onChange: (next: Array<{ code: string; labelAr: string; labelEn: string }>) => void;
}) {
  const [custom, setCustom] = useState('');
  const options = REQUIREMENT_CATALOGUE.filter((item) => (sale ? item.sale : item.rent));
  const chosen = new Set(value.map((item) => item.code));
  const customs = value.filter((item) => !options.some((option) => option.code === item.code));
  function toggle(option: { code: string; labelAr: string; labelEn: string }) {
    onChange(
      chosen.has(option.code)
        ? value.filter((item) => item.code !== option.code)
        : [...value, { code: option.code, labelAr: option.labelAr, labelEn: option.labelEn }],
    );
  }
  function addCustom() {
    const label = custom.trim();
    if (label.length < 2 || value.length >= 12) return;
    let index = 1;
    while (chosen.has(`custom_${index}`)) index += 1;
    onChange([...value, { code: `custom_${index}`, labelAr: label, labelEn: label }]);
    setCustom('');
  }
  return (
    <fieldset className="lcf-section lrw__picker">
      <legend>{ar ? '📎 المستندات المطلوبة من العميل' : '📎 Documents to request'}</legend>
      <p className="muted">
        {ar
          ? 'اختر ما يلزم لإتمام العقد. ستظهر القائمة للعميل في صفحة حجزه ليرفعها، ثم تراجعها هنا.'
          : 'Pick what the contract needs. The client sees this list on their booking page.'}
      </p>
      <div className="lrw__chips">
        {options.map((option) => (
          <label key={option.code} className="lrw__chip">
            <input
              type="checkbox"
              checked={chosen.has(option.code)}
              onChange={() => toggle(option)}
            />
            <span>{ar ? option.labelAr : option.labelEn}</span>
          </label>
        ))}
        {customs.map((item) => (
          <label key={item.code} className="lrw__chip">
            <input
              type="checkbox"
              checked
              onChange={() => onChange(value.filter((entry) => entry.code !== item.code))}
            />
            <span>{item.labelAr}</span>
          </label>
        ))}
      </div>
      <div className="lrw__custom">
        <input
          className="input"
          value={custom}
          maxLength={120}
          placeholder={ar ? 'مستند آخر… (مثال: شهادة لا مانع)' : 'Another document…'}
          onChange={(event) => setCustom(event.target.value)}
        />
        <button type="button" className="button button--quiet" onClick={addCustom}>
          {ar ? 'إضافة' : 'Add'}
        </button>
      </div>
    </fieldset>
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
      `${partyDisplayName(party, ar)} · ${
        party.entityType === 'company' ? (ar ? 'شركة' : 'Company') : ar ? 'فرد' : 'Individual'
      }`,
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
  locale,
  mode,
  lifecycle,
  unit,
  tenant,
  party,
  salePriceMinor,
  currency,
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
  const [requirements, setRequirements] = useState(
    (lifecycle.requirements ?? []).map(({ code, labelAr, labelEn }) => ({
      code,
      labelAr,
      labelEn,
    })),
  );
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

  const intro = (
    <div className="lrw__card lrw__card--action">
      <h3>
        {ar
          ? sale
            ? 'بيانات عقد البيع والمستندات المطلوبة'
            : 'بيانات عقد الإيجار والمستندات المطلوبة'
          : sale
            ? 'Sale contract details & documents'
            : 'Lease contract details & documents'}
      </h3>
      <p>
        {ar
          ? 'الحجز معتمد. عبّئ بيانات العقد كاملة واختر المستندات التي يلزم أن يوفرها العميل.'
          : 'The booking is approved. Fill in the contract and choose the documents the client must provide.'}
      </p>
      <ClientRequest
        ar={ar}
        sale={sale}
        party={party}
        unit={unit}
        currency={currency}
        salePriceMinor={salePriceMinor}
        locale={locale}
      />
      <RequirementsPicker ar={ar} sale={sale} value={requirements} onChange={setRequirements} />
    </div>
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
        {intro}
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
            {lifecycle.contractDraft ? (
              <button type="button" className="button button--quiet" onClick={onCancel}>
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
            ) : null}
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      {intro}
      <LeaseContractForm
        units={[unit]}
        tenants={[tenant]}
        canSign={canSign}
        locale={locale}
        busy={busy}
        heading={ar ? 'بيانات عقد الإيجار' : 'Lease contract details'}
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
        termsSeed={
          party?.contractType || party?.termMonths
            ? {
                ...(party.contractType ? { contractType: party.contractType } : {}),
                ...(party.termMonths ? { months: party.termMonths } : {}),
              }
            : undefined
        }
        onSubmit={(payload) =>
          void onSave({ action: 'save_contract', lease: payload, requirements })
        }
        onCancel={() => (lifecycle.contractDraft ? onCancel() : undefined)}
      />
    </>
  );
}

function HandoverForm({
  locale,
  busy,
  contractHref,
  canManage,
  mode,
  onSave,
}: Props & {
  busy: boolean;
  contractHref: string | null;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const ar = locale === 'ar';
  const [form, setForm] = useState({
    on: todayIso(),
    recipientName: '',
    keys: '',
    electricityReading: '',
    waterReading: '',
    notes: '',
  });
  const set = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: value });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body: Record<string, unknown> = { on: form.on, recipientName: form.recipientName.trim() };
    for (const key of ['keys', 'electricityReading', 'waterReading', 'notes'] as const) {
      if (form[key].trim()) body[key] = form[key].trim();
    }
    void onSave(body);
  };
  return (
    <div className="lrw__card lrw__card--action">
      <h3>{ar ? 'تسليم العقار' : 'Hand over the premises'}</h3>
      <p>
        {ar
          ? `العقد موقّع إلكترونياً من الطرفين. سجّل تسليم ${mode === 'sale' ? 'العقار للمشتري' : 'الوحدة للمستأجر'} مع المفاتيح وقراءات العدادات.`
          : 'The contract is signed by both parties. Record the handover with keys and meter readings.'}
      </p>
      {contractHref ? (
        <a className="button button--quiet" href={contractHref}>
          {ar ? 'عرض العقد الموقّع' : 'View signed contract'}
        </a>
      ) : null}
      {canManage ? (
        <form className="psr-form" onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="lrw-ho-date">{ar ? 'تاريخ التسليم' : 'Handover date'}</label>
              <input
                id="lrw-ho-date"
                className="input"
                type="date"
                required
                value={form.on}
                onChange={(event) => set('on', event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="lrw-ho-name">{ar ? 'اسم المستلم' : 'Received by'}</label>
              <input
                id="lrw-ho-name"
                className="input"
                required
                minLength={2}
                maxLength={120}
                value={form.recipientName}
                onChange={(event) => set('recipientName', event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="lrw-ho-keys">{ar ? 'المفاتيح المسلّمة' : 'Keys handed over'}</label>
              <input
                id="lrw-ho-keys"
                className="input"
                maxLength={200}
                placeholder={ar ? 'مثال: مفتاحان + بطاقة موقف' : 'e.g. 2 keys + parking card'}
                value={form.keys}
                onChange={(event) => set('keys', event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="lrw-ho-elec">{ar ? 'قراءة الكهرباء' : 'Electricity reading'}</label>
              <input
                id="lrw-ho-elec"
                className="input"
                dir="ltr"
                maxLength={40}
                value={form.electricityReading}
                onChange={(event) => set('electricityReading', event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="lrw-ho-water">{ar ? 'قراءة الماء' : 'Water reading'}</label>
              <input
                id="lrw-ho-water"
                className="input"
                dir="ltr"
                maxLength={40}
                value={form.waterReading}
                onChange={(event) => set('waterReading', event.target.value)}
              />
            </div>
            <div className="field span-2">
              <label htmlFor="lrw-ho-notes">{ar ? 'ملاحظات حالة العقار' : 'Condition notes'}</label>
              <textarea
                id="lrw-ho-notes"
                className="input"
                rows={3}
                maxLength={1000}
                value={form.notes}
                onChange={(event) => set('notes', event.target.value)}
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'تأكيد التسليم' : 'Confirm handover'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
