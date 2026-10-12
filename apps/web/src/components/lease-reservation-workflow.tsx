'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { LeaseContractForm, type LeaseContractPayload } from '@/components/lease-contract-form';
import { ApiError, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  REQUIREMENT_CATALOGUE,
  leaseJourneyStageIndex,
  leaseJourneyStageLabels,
  leasePhaseLabel,
  type LeaseJourneyPhase,
  type ReservationLifecycle,
  type ReservationRequirement,
} from '@/lib/lease-reservation-lifecycle';
import { minorDigitsFor, type LeaseTermsDraft } from '@/lib/lease-terms';
import { partyToLeaseTenant, type ReservationParty } from '@/lib/reservation-party';
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
  const stage = leaseJourneyStageIndex(phase);
  const labels = leaseJourneyStageLabels(sale, ar);
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
        {labels.map((label, index) => (
          <li
            key={label}
            className={`lrw__step lrw__step--${
              index < stage ? 'done' : index === stage ? 'current' : 'upcoming'
            }`}
            aria-current={index === stage ? 'step' : undefined}
          >
            <span className="lrw__dot">{index < stage ? '✓' : index + 1}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {phase === 'awaiting_terms_signature' ? (
        <p className="notice notice--info">
          {t(
            'دفع العميل العربون ولم يوقّع اتفاقية الحجز بعد. ستتمكن من اعتماد الحجز بعد توقيعه.',
            'The client paid the deposit but has not signed the booking agreement yet.',
          )}
        </p>
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
              {t('يعتمد الحجز المالك أو من يمثله.', 'The owner or their representative approves.')}
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
            <h3>{sale ? t('عقد البيع', 'Sale contract') : t('عقد الإيجار', 'Lease contract')}</h3>
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
            {t(
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
          <dl className="contract-detail__facts">
            <div>
              <dt>{t('تاريخ التسليم', 'Handover date')}</dt>
              <dd>{lifecycle.handover.on}</dd>
            </div>
            <div>
              <dt>{t('المستلم', 'Received by')}</dt>
              <dd>{lifecycle.handover.recipientName}</dd>
            </div>
            {lifecycle.handover.keys ? (
              <div>
                <dt>{t('المفاتيح', 'Keys')}</dt>
                <dd>{lifecycle.handover.keys}</dd>
              </div>
            ) : null}
            {lifecycle.handover.electricityReading ? (
              <div>
                <dt>{t('قراءة الكهرباء', 'Electricity reading')}</dt>
                <dd dir="ltr">{lifecycle.handover.electricityReading}</dd>
              </div>
            ) : null}
            {lifecycle.handover.waterReading ? (
              <div>
                <dt>{t('قراءة الماء', 'Water reading')}</dt>
                <dd dir="ltr">{lifecycle.handover.waterReading}</dd>
              </div>
            ) : null}
            {lifecycle.handover.notes ? (
              <div>
                <dt>{t('ملاحظات', 'Notes')}</dt>
                <dd>{lifecycle.handover.notes}</dd>
              </div>
            ) : null}
          </dl>
          {contractHref ? (
            <a className="button button--quiet" href={contractHref}>
              {t('عرض العقد الموقّع', 'View signed contract')}
            </a>
          ) : null}
        </div>
      ) : null}

      {props.hasEsign && canManage ? <IdentityGallery ar={ar} fileHref={fileHref} /> : null}
    </section>
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
              <span className="lrw__doc-status">{STATUS_TEXT[item.status][ar ? 0 : 1]}</span>
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
