'use client';

import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { FilePreviewDialog, type PreviewFile } from '@/components/file-preview';
import { EsignSignaturePad } from '@/components/stays/esign/esign-signature-pad';
import { StayApprovalDesk } from '@/components/stays/stay-approval-desk';
import { useStayJourney } from '@/components/stays/stay-journey';
import { StaySendPhone } from '@/components/stays/stay-send-phone';
import { StayTrip } from '@/components/stays/stay-trip';
import { UploadPrepareDialog } from '@/components/upload-prepare-dialog';
import { ApiError, browserNextMutation } from '@/lib/api';
import { compressImageFile } from '@/lib/compress-image';
import { formatMoney } from '@/lib/format';
import { leaseScreens, type LeaseJourneyProps } from '@/lib/lease-journey-screens';
import {
  REQUIREMENT_FILE_MAX_CHARS,
  leaseJourneyStageLabels,
} from '@/lib/lease-reservation-lifecycle';
import { OMAN_BANKS } from '@/lib/stay-deposit-refund';

const BANK_OTHER = '__other__';

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('read_failed'));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

function errorText(error: unknown, ar: boolean): string {
  if (error instanceof ApiError) return error.message;
  return ar ? 'تعذّر الإرسال — تحقق من الاتصال وأعد المحاولة.' : 'Could not send — try again.';
}

/** The message card under the hero: the selected stage's scene, words and next action. */
export function LeaseJourneyCard(props: LeaseJourneyProps) {
  const { selected, initial, select } = useStayJourney();
  const ar = props.locale === 'ar';
  const screens = leaseScreens(props);
  const labels = leaseJourneyStageLabels(props.mode === 'sale', ar);
  const screen = screens[selected] ?? screens[initial];
  if (!screen) return null;
  const past = selected !== initial;
  const sale = props.mode === 'sale';
  const plate = props.referenceCode;

  return (
    <section
      key={selected}
      className={`guest-stay-detail__greeting guest-stay-detail__greeting--confirmed${
        past ? ' guest-stay-detail__greeting--past' : ''
      }`}
      aria-live="polite"
    >
      {past ? (
        <div className="guest-stay-detail__replay">
          <span>
            {ar
              ? `هكذا بدت لك مرحلة «${labels[selected] ?? ''}»`
              : `How the “${labels[selected] ?? ''}” step looked to you`}
          </span>
          <button type="button" onClick={() => select(initial)}>
            {ar ? 'العودة إلى المرحلة الحالية' : 'Back to where you are now'}
          </button>
        </div>
      ) : null}
      {screen.scene === 'send' ? (
        <StaySendPhone
          moment={{ mode: 'instant', status: screen.sceneStatus ?? '' }}
          plateNo={plate}
          ar={ar}
          labels={{
            screen: sale ? (ar ? 'حجز شراء' : 'PURCHASE') : ar ? 'حجز إيجار' : 'RENT BOOKING',
            button: ar ? 'ادفع العربون' : 'Pay deposit',
            sent: ar ? 'تم الحجز ✓' : 'Booked ✓',
            type: ar ? 'إتمام الحجز' : 'Booking',
          }}
        />
      ) : null}
      {screen.scene === 'desk' ? (
        <StayApprovalDesk
          moment={{ signed: Boolean(screen.sceneDone), status: screen.sceneStatus ?? '' }}
          plateNo={plate}
          ar={ar}
          screenTitle={sale ? (ar ? 'حجز شراء' : 'PURCHASE') : ar ? 'حجز إيجار' : 'RENT BOOKING'}
        />
      ) : null}
      {screen.scene === 'contract' ? (
        <StayApprovalDesk
          moment={{ signed: Boolean(screen.sceneDone), status: screen.sceneStatus ?? '' }}
          plateNo={plate}
          ar={ar}
          screenTitle={sale ? (ar ? 'عقد البيع' : 'SALE CONTRACT') : ar ? 'عقد الإيجار' : 'LEASE'}
          typeLabel={sale ? (ar ? 'عقد البيع' : 'Sale contract') : ar ? 'عقد الإيجار' : 'Lease'}
        />
      ) : null}
      {screen.scene === 'handover' || screen.scene === 'keys' ? (
        <StayTrip
          moment={{
            kind: screen.scene === 'keys' ? 'arrive' : 'parked',
            status: screen.sceneStatus ?? '',
          }}
          plateNo={plate}
          ar={ar}
          typeLabel={ar ? 'تسليم العقار' : 'Handover'}
        />
      ) : null}
      <h2>{screen.headline}</h2>
      <p>{screen.body}</p>
      {(props.lifecycle.electronic || props.lifecycle.contractAuto) && !past ? (
        <ElectronicApprovalNotice {...props} />
      ) : null}
      {screen.guide ? (
        <ol className="guest-stay-detail__guide">
          {screen.guide.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      ) : null}
      {screen.action === 'sign_terms' ? (
        <Link
          className="button button--primary guest-stay-detail__rebook"
          href={`/book/sign?ref=${encodeURIComponent(plate)}`}
        >
          {ar ? 'توقيع اتفاقية الحجز' : 'Sign the booking agreement'}
        </Link>
      ) : null}
      {screen.action === 'view_terms' ? (
        <Link
          className="button button--quiet guest-stay-detail__rebook"
          href={`/book/sign?ref=${encodeURIComponent(plate)}`}
        >
          {ar ? 'عرض اتفاقية الحجز الموقّعة' : 'View signed booking agreement'}
        </Link>
      ) : null}
      {screen.action === 'documents' && !past ? (
        <>
          <DocumentsNeededNotice {...props} />
          <TenantAttestationGate {...props} />
          <LeaseDocuments {...props} />
          <LeaseCheques {...props} />
        </>
      ) : null}
      {screen.action === 'documents' && past ? (
        <>
          <LeaseDocumentList {...props} />
          <LeaseCheques {...props} readOnly />
        </>
      ) : null}
      {screen.action === 'sign_contract' && !past ? (
        <>
          <TenantAttestationGate {...props} />
          <LeaseContractSign {...props} />
        </>
      ) : null}
      {screen.action === 'view_contract' && props.lifecycle.contract ? (
        <Link
          className="button button--quiet guest-stay-detail__rebook"
          href={`/tenant/contracts/${encodeURIComponent(props.lifecycle.contract.id)}`}
        >
          {ar ? 'عرض العقد الموقّع' : 'View signed contract'}
        </Link>
      ) : null}
    </section>
  );
}

/** Clear call-to-action once the owner approved and documents/cheques are due. */
function DocumentsNeededNotice({
  locale,
  phase,
  lifecycle,
}: Pick<LeaseJourneyProps, 'locale' | 'phase' | 'lifecycle'>) {
  const ar = locale === 'ar';
  if (
    phase !== 'awaiting_documents' &&
    phase !== 'awaiting_documents_review'
  ) {
    return null;
  }
  const approved = Boolean(lifecycle.approvedAt);
  const needsAttest =
    lifecycle.requireTenantAttestation && !lifecycle.tenantAttestedAt;
  return (
    <div
      className={`notice ${phase === 'awaiting_documents' ? 'notice--info' : 'notice--success'}`}
      role="status"
    >
      <strong>
        {approved
          ? ar
            ? 'المالك اعتمد حجزك'
            : 'The owner approved your booking'
          : ar
            ? 'مطلوب منك إجراء'
            : 'Action needed from you'}
      </strong>
      <span className="lease-docs-notice__body">
        {phase === 'awaiting_documents_review'
          ? ar
            ? 'وصلت ملفاتك وهي قيد مراجعة المالك أو من يمثله.'
            : 'Your files arrived and are under review by the owner or their representative.'
          : needsAttest
            ? ar
              ? 'أكّد صحة بياناتك أدناه، ثم ارفع المستندات المطلوبة وأدخل أرقام الشيكات مع صورة كل شيك.'
              : 'Confirm your details below, then upload the required documents and enter each cheque number with its photo.'
            : ar
              ? 'ارفع المستندات المطلوبة، وأدخل رقم كل شيك مع صورة الشيك لإرسالها للمراجعة.'
              : 'Upload the required documents and enter each cheque number with its photo for review.'}
      </span>
    </div>
  );
}

/** Shown whenever the system approved a step for the owner, so the client knows checks follow. */
export function ElectronicApprovalNotice({
  locale,
  lifecycle,
}: Pick<LeaseJourneyProps, 'locale' | 'lifecycle'>) {
  const ar = locale === 'ar';
  return (
    <div className="electronic-approval-notice" role="note">
      <span aria-hidden="true">⚠️</span>
      <p>
        <strong>{ar ? 'اعتماد إلكتروني' : 'Electronic approval'}</strong>
        {ar
          ? 'اعتمد النظام الطلب إلكترونياً. سيراجع الفريق المستندات يدوياً قبل التسليم. إن وُجد اختلاف أو عدم صحة يحق للمالك إلغاء الحجز والطلب، ويتحمّل المستأجر كامل المسؤولية — لذا أكّد صحة بياناتك قبل المتابعة.'
          : 'The system approved this electronically. The team will manually review documents before handover. If anything is wrong or mismatched, the owner may cancel the booking and you bear full responsibility — confirm your details before continuing.'}
        {lifecycle.deferUntilHandover?.length ? (
          <>
            {' '}
            {ar
              ? 'بعض بيانات العقد تُستكمل عند التسليم حسب ضبط المالك.'
              : 'Some contract fields are completed at handover per the owner’s settings.'}
          </>
        ) : null}
      </p>
    </div>
  );
}

function TenantAttestationGate({
  locale,
  referenceCode,
  lifecycle,
}: LeaseJourneyProps) {
  const ar = locale === 'ar';
  const router = useRouter();
  const required = lifecycle.requireTenantAttestation;
  const done = Boolean(lifecycle.tenantAttestedAt);
  const [checked, setChecked] = useState(done);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!required) return null;

  async function confirm() {
    if (!checked) {
      setError(
        ar
          ? 'يجب التأشير على الإقرار أولاً.'
          : 'Tick the confirmation box first.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/attestation`,
        { method: 'POST', body: JSON.stringify({ accepted: true }) },
      );
      router.refresh();
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="notice notice--success" role="status">
        {ar
          ? 'تم تسجيل إقرارك بصحة البيانات وتحمّل المسؤولية.'
          : 'Your accuracy and responsibility confirmation is recorded.'}
      </p>
    );
  }

  return (
    <div className="lease-attestation" role="group" aria-labelledby="lease-attest-title">
      <h3 id="lease-attest-title">
        {ar ? 'تأكيد صحة البيانات قبل المتابعة' : 'Confirm your details before continuing'}
      </h3>
      <p className="muted">
        {ar
          ? 'المستندات ستُراجع يدوياً قبل التسليم. أي اختلاف أو عدم صحة يمنح المالك حق إلغاء الحجز والطلب مع تحمّلك كامل المسؤولية.'
          : 'Documents are reviewed manually before handover. Any mismatch lets the owner cancel the booking, and you bear full responsibility.'}
      </p>
      <label className="lease-attestation__check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <span>
          {ar
            ? 'أقرّ بأن جميع بياناتي ومستنداتي صحيحة وكاملة، وأتحمّل المسؤولية كاملة إن تبيّن خلاف ذلك، وأعلم بحق المالك في إلغاء الحجز قبل التسليم.'
            : 'I confirm all my details and documents are true and complete, I accept full responsibility if they are not, and I understand the owner may cancel before handover.'}
        </span>
      </label>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="button button--primary"
        disabled={busy || !checked}
        onClick={() => void confirm()}
      >
        {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'تأكيد والمتابعة' : 'Confirm and continue'}
      </button>
    </div>
  );
}

const REQUIREMENT_STATUS: Record<string, [string, string]> = {
  pending: ['مطلوب', 'Needed'],
  submitted: ['أُرسل — قيد المراجعة', 'Sent — under review'],
  approved: ['مقبول ✓', 'Accepted ✓'],
  rejected: ['مطلوب بديل', 'Replacement needed'],
};

function requirementStatus(
  item: {
    status: 'pending' | 'submitted' | 'approved' | 'rejected';
    autoApproved?: boolean;
    verified?: boolean;
  },
  ar: boolean,
): string | undefined {
  if (item.autoApproved && item.status === 'approved' && !item.verified) {
    return ar ? 'قُبل إلكترونياً — قيد تحقق الفريق' : 'Accepted electronically — being verified';
  }
  return REQUIREMENT_STATUS[item.status]?.[ar ? 0 : 1];
}

function LeaseDocumentList({ lifecycle, locale }: LeaseJourneyProps) {
  const ar = locale === 'ar';
  return (
    <ul className="lease-docs">
      {lifecycle.requirements.map((item) => (
        <li key={item.code} className={`lease-docs__item lease-docs__item--${item.status}`}>
          <strong>{ar ? item.labelAr : item.labelEn || item.labelAr}</strong>
          <span>{requirementStatus(item, ar)}</span>
        </li>
      ))}
    </ul>
  );
}

function LeaseDocuments({ lifecycle, locale, referenceCode }: LeaseJourneyProps) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ code: string; file: File } | null>(null);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const blocked =
    lifecycle.requireTenantAttestation && !lifecycle.tenantAttestedAt;

  function pick(code: string, event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    if (blocked) {
      setError(
        ar
          ? 'أكّد صحة بياناتك أولاً قبل رفع المستندات.'
          : 'Confirm your details first before uploading documents.',
      );
      return;
    }
    if (picked.type !== 'application/pdf' && !picked.type.startsWith('image/')) {
      setError(ar ? 'أرسل صورة أو ملف PDF.' : 'Send an image or a PDF.');
      return;
    }
    setError(null);
    setPending({ code, file: picked });
  }

  async function send(code: string, prepared: File) {
    setBusy(code);
    setPending(null);
    try {
      const file = prepared.type.startsWith('image/')
        ? await compressImageFile(prepared)
        : prepared;
      const dataUrl = await readAsDataUrl(file);
      if (dataUrl.length > REQUIREMENT_FILE_MAX_CHARS) {
        throw new Error(
          ar
            ? 'الملف كبير جداً (الحد نحو 1 ميغابايت). صوّره بدقة أقل أو قسّم ملف PDF.'
            : 'The file is too large (about 1 MB max).',
        );
      }
      await browserNextMutation(
        `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/documents`,
        {
          method: 'POST',
          body: JSON.stringify({
            code,
            fileName: prepared.name.slice(0, 200),
            dataUrl,
          }),
        },
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? errorText(caught, ar) : (caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!lifecycle.requirements.length) return null;

  return (
    <div className="lease-docs-wrap">
      <h3 className="lease-docs__heading">
        {ar ? '📎 المستندات المطلوبة' : '📎 Required documents'}
      </h3>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="lease-docs">
        {lifecycle.requirements.map((item) => {
          const canUpload = item.status !== 'approved';
          const fileHref = item.fileName
            ? `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/files/doc-${encodeURIComponent(item.code)}`
            : null;
          return (
            <li key={item.code} className={`lease-docs__item lease-docs__item--${item.status}`}>
              <div className="lease-docs__text">
                <strong>{ar ? item.labelAr : item.labelEn || item.labelAr}</strong>
                <span>{requirementStatus(item, ar)}</span>
                {item.status === 'rejected' && item.note ? (
                  <small>
                    {ar ? 'ملاحظة المالك: ' : 'Owner note: '}
                    {item.note}
                  </small>
                ) : null}
                {item.fileName && item.status !== 'rejected' ? (
                  <small dir="auto">{item.fileName}</small>
                ) : null}
              </div>
              <div className="lease-docs__actions">
                {fileHref ? (
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() =>
                      setPreview({
                        href: fileHref,
                        label: ar ? item.labelAr : item.labelEn || item.labelAr,
                      })
                    }
                  >
                    {ar ? 'معاينة' : 'Preview'}
                  </button>
                ) : null}
                {canUpload ? (
                  <label className="button button--quiet lease-docs__upload">
                    {busy === item.code
                      ? ar
                        ? 'جارٍ الإرسال…'
                        : 'Sending…'
                      : item.status === 'pending'
                        ? ar
                          ? 'رفع المستند'
                          : 'Upload'
                        : ar
                          ? 'استبدال'
                          : 'Replace'}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      hidden
                      disabled={busy !== null || blocked}
                      onChange={(event) => pick(item.code, event)}
                    />
                  </label>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {pending ? (
        <UploadPrepareDialog
          file={pending.file}
          ar={ar}
          title={ar ? 'معاينة المستند قبل الإرسال' : 'Preview document before sending'}
          onCancel={() => setPending(null)}
          onConfirm={(file) => void send(pending.code, file)}
        />
      ) : null}
      {preview ? (
        <FilePreviewDialog file={preview} ar={ar} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}

/** Fill following cheque numbers from a starting value (keeps prefix/suffix and zero-padding). */
function sequenceChequeNumbers(start: string, count: number): string[] {
  const trimmed = start.trim();
  if (!trimmed || count <= 0) return Array.from({ length: count }, () => '');
  const match = trimmed.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) {
    return Array.from({ length: count }, (_, index) => (index === 0 ? trimmed : ''));
  }
  const prefix = match[1] ?? '';
  const digits = match[2] ?? '0';
  const suffix = match[3] ?? '';
  const width = digits.length;
  let value = BigInt(digits);
  return Array.from({ length: count }, () => {
    const next = `${prefix}${value.toString().padStart(width, '0')}${suffix}`;
    value += 1n;
    return next;
  });
}

function LeaseCheques({
  lifecycle,
  locale,
  referenceCode,
  readOnly = false,
}: LeaseJourneyProps & { readOnly?: boolean }) {
  const ar = locale === 'ar';
  const router = useRouter();
  const cheques = lifecycle.cheques ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ key: string; file: File } | null>(null);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const blocked =
    !readOnly && lifecycle.requireTenantAttestation && !lifecycle.tenantAttestedAt;

  const seededShared = (() => {
    const withBank = cheques.find((item) => item.bankName?.trim());
    const withHolder = cheques.find((item) => item.accountHolderName?.trim());
    return {
      bankName: withBank?.bankName?.trim() ?? '',
      accountHolderName: withHolder?.accountHolderName?.trim() ?? '',
    };
  })();
  const [bankName, setBankName] = useState(seededShared.bankName);
  const [bankOther, setBankOther] = useState(
    () =>
      Boolean(seededShared.bankName) &&
      !(OMAN_BANKS as readonly string[]).includes(seededShared.bankName),
  );
  const [accountHolderName, setAccountHolderName] = useState(seededShared.accountHolderName);
  const bankSelectValue = bankOther
    ? BANK_OTHER
    : (OMAN_BANKS as readonly string[]).includes(bankName)
      ? bankName
      : '';
  const [numbers, setNumbers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    const seeded = cheques.map(
      (item) => item.chequeNumber ?? item.suggestedChequeNumber ?? '',
    );
    const first = seeded.find((value) => value.trim()) ?? '';
    const sequenced = first ? sequenceChequeNumbers(first, cheques.length) : seeded;
    cheques.forEach((item, index) => {
      const existing = item.chequeNumber?.trim();
      initial[item.key] = existing || sequenced[index] || seeded[index] || '';
    });
    return initial;
  });

  if (!cheques.length) return null;

  function applySequenceFrom(index: number, value: string) {
    setNumbers((current) => {
      const next = { ...current };
      const keys = cheques.slice(index).map((item) => item.key);
      const sequenced = sequenceChequeNumbers(value, keys.length);
      keys.forEach((key, offset) => {
        const row = cheques[index + offset];
        if (!row || row.status === 'approved') return;
        next[key] = sequenced[offset] ?? '';
      });
      return next;
    });
  }

  function pick(key: string, event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    if (blocked) {
      setError(
        ar
          ? 'أكّد صحة بياناتك أولاً قبل رفع الشيكات.'
          : 'Confirm your details first before uploading cheques.',
      );
      return;
    }
    if (bankName.trim().length < 2 || accountHolderName.trim().length < 2) {
      setError(
        ar
          ? 'أدخل البنك واسم صاحب الحساب مرة واحدة أعلى الجدول قبل رفع الصور.'
          : 'Enter bank and account holder once above the table before uploading photos.',
      );
      return;
    }
    if (!(numbers[key] ?? '').trim()) {
      setError(
        ar ? 'أدخل رقم الشيك قبل رفع الصورة.' : 'Enter the cheque number before uploading the photo.',
      );
      return;
    }
    if (picked.type !== 'application/pdf' && !picked.type.startsWith('image/')) {
      setError(ar ? 'أرسل صورة أو ملف PDF.' : 'Send an image or a PDF.');
      return;
    }
    setError(null);
    setPending({ key, file: picked });
  }

  async function send(key: string, prepared: File) {
    setBusy(key);
    setPending(null);
    try {
      const file = prepared.type.startsWith('image/')
        ? await compressImageFile(prepared)
        : prepared;
      const dataUrl = await readAsDataUrl(file);
      if (dataUrl.length > REQUIREMENT_FILE_MAX_CHARS) {
        throw new Error(
          ar
            ? 'الملف كبير جداً (الحد نحو 1 ميغابايت). صوّره بدقة أقل.'
            : 'The file is too large (about 1 MB max).',
        );
      }
      await browserNextMutation(
        `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/cheques`,
        {
          method: 'POST',
          body: JSON.stringify({
            key,
            bankName: bankName.trim(),
            accountHolderName: accountHolderName.trim(),
            chequeNumber: (numbers[key] ?? '').trim(),
            fileName: prepared.name.slice(0, 200),
            dataUrl,
          }),
        },
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? errorText(caught, ar) : (caught as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="lease-docs-wrap lease-cheques">
      <h3 className="lease-docs__heading">{ar ? '🧾 شيكات الإيجار' : '🧾 Rent cheques'}</h3>
      {lifecycle.chequePayableTo ? (
        <p className="lease-cheques__payable notice">
          {ar ? 'اكتب الشيكات باسم: ' : 'Make cheques payable to: '}
          <strong>{lifecycle.chequePayableTo}</strong>
          {lifecycle.chequeBankName ? (
            <>
              {' · '}
              {ar ? 'البنك: ' : 'Bank: '}
              {lifecycle.chequeBankName}
            </>
          ) : null}
        </p>
      ) : null}
      <p className="muted">
        {ar
          ? 'أدخل بنك الحساب واسم صاحبه مرة واحدة، ثم رقم أول شيك — يُملأ الباقي تلقائياً ويمكنك تعديله. المبلغ من النظام، والمرفق لصورة كل شيك.'
          : 'Enter bank and account holder once, then the first cheque number — the rest fill automatically and stay editable. Amounts come from the system; attach each cheque photo in the last column.'}
      </p>
      {blocked ? (
        <p className="notice notice--info" role="status">
          {ar
            ? 'يمكنك تعبئة البنك والأرقام الآن. لرفع صور الشيكات: أكّد صحة بياناتك أعلاه أولاً.'
            : 'You can fill bank and numbers now. To upload cheque photos, confirm your details above first.'}
        </p>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {!readOnly ? (
        <div className="lease-cheques__shared">
          <label>
            {ar ? 'بنك الحساب (مرة واحدة لكل الشيكات)' : 'Account bank (once for all cheques)'}
            <select
              className="select"
              value={bankSelectValue}
              disabled={busy !== null}
              onChange={(event) => {
                const value = event.target.value;
                if (value === BANK_OTHER) {
                  setBankOther(true);
                  if ((OMAN_BANKS as readonly string[]).includes(bankName)) setBankName('');
                  return;
                }
                setBankOther(false);
                setBankName(value);
              }}
            >
              <option value="">{ar ? '— اختر البنك —' : '— Select bank —'}</option>
              {OMAN_BANKS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value={BANK_OTHER}>{ar ? 'بنك آخر…' : 'Other bank…'}</option>
            </select>
          </label>
          {bankOther ? (
            <label>
              {ar ? 'اسم البنك (يدوي)' : 'Bank name (custom)'}
              <input
                className="input"
                maxLength={160}
                value={bankName}
                disabled={busy !== null}
                onChange={(event) => setBankName(event.target.value)}
                placeholder={ar ? 'اكتب اسم البنك' : 'Type the bank name'}
              />
            </label>
          ) : null}
          <label>
            {ar ? 'اسم صاحب الحساب (مرة واحدة)' : 'Account holder (once)'}
            <input
              className="input"
              maxLength={160}
              value={accountHolderName}
              disabled={busy !== null}
              onChange={(event) => setAccountHolderName(event.target.value)}
              placeholder={ar ? 'الاسم كما على دفتر الشيكات' : 'Name as on the cheque book'}
            />
          </label>
        </div>
      ) : bankName || accountHolderName ? (
        <p className="lease-cheques__shared-read muted">
          {[bankName, accountHolderName].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      <div className="lease-cheques__table-wrap">
        <table className="lease-cheques__table">
          <thead>
            <tr>
              <th scope="col">{ar ? 'الشيك' : 'Cheque'}</th>
              <th scope="col">{ar ? 'المبلغ' : 'Amount'}</th>
              <th scope="col">{ar ? 'الاستحقاق' : 'Due'}</th>
              <th scope="col">{ar ? 'رقم الشيك' : 'Number'}</th>
              <th scope="col">{ar ? 'المرفق' : 'Attachment'}</th>
            </tr>
          </thead>
          <tbody>
            {cheques.map((item, index) => {
              const canEdit = !readOnly && item.status !== 'approved';
              const fileHref = item.fileName
                ? `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/files/cheque-${encodeURIComponent(item.key)}`
                : null;
              return (
                <tr key={item.key} className={`lease-cheques__row lease-cheques__row--${item.status}`}>
                  <td>
                    <strong>{ar ? item.labelAr : item.labelEn}</strong>
                    <span className="lease-cheques__status">{requirementStatus(item, ar)}</span>
                    {item.status === 'rejected' && item.note ? (
                      <small className="lease-cheques__note">
                        {ar ? 'ملاحظة: ' : 'Note: '}
                        {item.note}
                      </small>
                    ) : null}
                  </td>
                  <td className="lease-cheques__amount" dir="ltr">
                    {formatMoney(String(item.amountMinor), item.currency, ar ? 'ar' : 'en')}
                  </td>
                  <td className="lease-cheques__due" dir="ltr">
                    {item.dueOn || '—'}
                  </td>
                  <td>
                    {canEdit ? (
                      <input
                        className="input lease-cheques__number"
                        dir="ltr"
                        maxLength={80}
                        value={numbers[item.key] ?? ''}
                        disabled={busy !== null}
                        aria-label={ar ? `رقم ${item.labelAr}` : `Number for ${item.labelEn}`}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (index === 0 || (value.trim() && /\d/.test(value))) {
                            applySequenceFrom(index, value);
                          } else {
                            setNumbers((current) => ({ ...current, [item.key]: value }));
                          }
                        }}
                        onBlur={(event) => {
                          if (index === 0 && event.target.value.trim()) {
                            applySequenceFrom(0, event.target.value);
                          }
                        }}
                      />
                    ) : (
                      <span dir="ltr">{item.chequeNumber || numbers[item.key] || '—'}</span>
                    )}
                  </td>
                  <td className="lease-cheques__file">
                    {canEdit ? (
                      <div className="lease-docs__actions">
                        {fileHref ? (
                          <button
                            type="button"
                            className="button button--quiet"
                            onClick={() =>
                              setPreview({
                                href: fileHref,
                                label: ar ? item.labelAr : item.labelEn,
                              })
                            }
                          >
                            {ar ? 'معاينة' : 'Preview'}
                          </button>
                        ) : null}
                        <label className="button button--quiet lease-docs__upload">
                          {busy === item.key
                            ? ar
                              ? 'جارٍ…'
                              : '…'
                            : item.status === 'pending'
                              ? ar
                                ? 'رفع صورة'
                                : 'Upload'
                              : ar
                                ? 'استبدال'
                                : 'Replace'}
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            hidden
                            disabled={busy !== null || blocked}
                            onChange={(event) => pick(item.key, event)}
                          />
                        </label>
                      </div>
                    ) : fileHref ? (
                      <button
                        type="button"
                        className="button button--quiet"
                        onClick={() =>
                          setPreview({
                            href: fileHref,
                            label: ar ? item.labelAr : item.labelEn,
                          })
                        }
                      >
                        {ar ? 'معاينة' : 'Preview'}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pending ? (
        <UploadPrepareDialog
          file={pending.file}
          ar={ar}
          title={ar ? 'معاينة صورة الشيك قبل الإرسال' : 'Preview cheque photo before sending'}
          onCancel={() => setPending(null)}
          onConfirm={(file) => void send(pending.key, file)}
        />
      ) : null}
      {preview ? (
        <FilePreviewDialog file={preview} ar={ar} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  );
}

function LeaseContractSign({ lifecycle, locale, referenceCode, mode }: LeaseJourneyProps) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contract = lifecycle.contract;
  const blocked = lifecycle.requireTenantAttestation && !lifecycle.tenantAttestedAt;
  if (!contract) return null;

  async function sign(signaturePng: string) {
    if (blocked) {
      setError(
        ar
          ? 'أكّد صحة بياناتك أولاً قبل توقيع العقد.'
          : 'Confirm your details first before signing the contract.',
      );
      return;
    }
    if (!accepted) {
      setError(
        ar ? 'أكّد أولاً أنك قرأت العقد ووافقت عليه.' : 'First confirm you read and accept it.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/contract-sign`,
        { method: 'POST', body: JSON.stringify({ signaturePng, accepted: true }) },
      );
      router.refresh();
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lease-sign">
      <Link
        className="button button--quiet"
        href={`/tenant/contracts/${encodeURIComponent(contract.id)}`}
        target="_blank"
      >
        {ar ? `اقرأ العقد ${contract.reference} كاملاً` : `Read ${contract.reference} in full`}
      </Link>
      <label className="lease-sign__accept">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <span>
          {ar
            ? `قرأتُ ${mode === 'sale' ? 'عقد البيع' : 'عقد الإيجار'} وأوافق على جميع بنوده، وأقرّ بأن توقيعي الإلكتروني ملزم كتوقيعي بخط اليد.`
            : 'I have read the contract, accept all its terms, and agree my e-signature binds me like my handwritten one.'}
        </span>
      </label>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {busy ? (
        <p className="muted">{ar ? 'جارٍ تسجيل توقيعك…' : 'Recording your signature…'}</p>
      ) : (
        <EsignSignaturePad locale={locale} onAccept={(png) => void sign(png)} />
      )}
    </div>
  );
}
