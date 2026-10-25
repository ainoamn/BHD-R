'use client';

import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { EsignSignaturePad } from '@/components/stays/esign/esign-signature-pad';
import { StayApprovalDesk } from '@/components/stays/stay-approval-desk';
import { useStayJourney } from '@/components/stays/stay-journey';
import { StaySendPhone } from '@/components/stays/stay-send-phone';
import { StayTrip } from '@/components/stays/stay-trip';
import { ApiError, browserNextMutation } from '@/lib/api';
import { compressImageFile } from '@/lib/compress-image';
import { formatMoney } from '@/lib/format';
import { leaseScreens, type LeaseJourneyProps } from '@/lib/lease-journey-screens';
import {
  REQUIREMENT_FILE_MAX_CHARS,
  leaseJourneyStageLabels,
} from '@/lib/lease-reservation-lifecycle';

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
  const blocked =
    lifecycle.requireTenantAttestation && !lifecycle.tenantAttestedAt;

  async function upload(code: string, event: ChangeEvent<HTMLInputElement>) {
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
    setError(null);
    setBusy(code);
    try {
      const file = picked.type.startsWith('image/') ? await compressImageFile(picked) : picked;
      if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
        throw new Error(ar ? 'أرسل صورة أو ملف PDF.' : 'Send an image or a PDF.');
      }
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
          body: JSON.stringify({ code, fileName: picked.name.slice(0, 200), dataUrl }),
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
                    onChange={(event) => void upload(item.code, event)}
                  />
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type ChequeDraft = {
  bankName: string;
  accountHolderName: string;
  chequeNumber: string;
};

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
  const blocked =
    !readOnly && lifecycle.requireTenantAttestation && !lifecycle.tenantAttestedAt;
  const [drafts, setDrafts] = useState<Record<string, ChequeDraft>>(() => {
    const initial: Record<string, ChequeDraft> = {};
    for (const item of cheques) {
      initial[item.key] = {
        bankName: item.bankName ?? lifecycle.chequeBankName ?? '',
        accountHolderName: item.accountHolderName ?? '',
        chequeNumber: item.chequeNumber ?? item.suggestedChequeNumber ?? '',
      };
    }
    return initial;
  });

  if (!cheques.length) return null;

  async function submit(key: string, event: ChangeEvent<HTMLInputElement>) {
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
    const draft = drafts[key] ?? { bankName: '', accountHolderName: '', chequeNumber: '' };
    if (
      draft.bankName.trim().length < 2 ||
      draft.accountHolderName.trim().length < 2 ||
      !draft.chequeNumber.trim()
    ) {
      setError(
        ar
          ? 'أكمل بنك الشيك واسم صاحب الحساب ورقم الشيك قبل رفع الصورة.'
          : 'Fill bank, account holder and cheque number before uploading the photo.',
      );
      return;
    }
    setError(null);
    setBusy(key);
    try {
      const file = picked.type.startsWith('image/') ? await compressImageFile(picked) : picked;
      if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
        throw new Error(ar ? 'أرسل صورة أو ملف PDF.' : 'Send an image or a PDF.');
      }
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
            bankName: draft.bankName.trim(),
            accountHolderName: draft.accountHolderName.trim(),
            chequeNumber: draft.chequeNumber.trim(),
            fileName: picked.name.slice(0, 200),
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
          ? 'لكل قسط إيجار: أدخل بنك الشيك، اسم صاحب الحساب، رقم الشيك، ثم ارفق صورة الشيك.'
          : 'For each rent installment: enter the bank, account holder, cheque number, then attach a photo of the cheque.'}
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="lease-docs lease-cheques__list">
        {cheques.map((item) => {
          const draft = drafts[item.key] ?? {
            bankName: lifecycle.chequeBankName ?? '',
            accountHolderName: '',
            chequeNumber: item.suggestedChequeNumber ?? '',
          };
          const canEdit = !readOnly && item.status !== 'approved' && !blocked;
          return (
            <li key={item.key} className={`lease-docs__item lease-docs__item--${item.status}`}>
              <div className="lease-docs__text">
                <strong>{ar ? item.labelAr : item.labelEn}</strong>
                <span>
                  {formatMoney(String(item.amountMinor), item.currency, ar ? 'ar' : 'en')}
                  {item.dueOn ? ` · ${item.dueOn}` : ''}
                </span>
                <span>{requirementStatus(item, ar)}</span>
                {item.status === 'rejected' && item.note ? (
                  <small>
                    {ar ? 'ملاحظة المالك: ' : 'Owner note: '}
                    {item.note}
                  </small>
                ) : null}
                {item.fileName && item.status !== 'rejected' ? (
                  <small dir="auto">
                    {item.chequeNumber ? `#${item.chequeNumber} · ` : ''}
                    {item.fileName}
                  </small>
                ) : null}
              </div>
              {canEdit ? (
                <div className="lease-cheques__fields">
                  <label>
                    {ar ? 'بنك الشيكات' : 'Cheque bank'}
                    <input
                      className="input"
                      maxLength={160}
                      value={draft.bankName}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.key]: { ...draft, bankName: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label>
                    {ar ? 'اسم صاحب الحساب' : 'Account holder'}
                    <input
                      className="input"
                      maxLength={160}
                      value={draft.accountHolderName}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.key]: { ...draft, accountHolderName: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label>
                    {ar ? 'رقم الشيك' : 'Cheque number'}
                    <input
                      className="input"
                      dir="ltr"
                      maxLength={80}
                      value={draft.chequeNumber}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.key]: { ...draft, chequeNumber: event.target.value },
                        }))
                      }
                    />
                  </label>
                  <label className="button button--quiet lease-docs__upload">
                    {busy === item.key
                      ? ar
                        ? 'جارٍ الإرسال…'
                        : 'Sending…'
                      : item.status === 'pending'
                        ? ar
                          ? 'رفع صورة الشيك'
                          : 'Upload cheque photo'
                        : ar
                          ? 'استبدال الصورة'
                          : 'Replace photo'}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      hidden
                      disabled={busy !== null}
                      onChange={(event) => void submit(item.key, event)}
                    />
                  </label>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
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
