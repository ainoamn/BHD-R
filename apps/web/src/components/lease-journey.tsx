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
      {props.lifecycle.electronic && !past ? <ElectronicApprovalNotice ar={ar} /> : null}
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
      {screen.action === 'documents' && !past ? <LeaseDocuments {...props} /> : null}
      {screen.action === 'documents' && past ? <LeaseDocumentList {...props} /> : null}
      {screen.action === 'sign_contract' && !past ? <LeaseContractSign {...props} /> : null}
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
export function ElectronicApprovalNotice({ ar }: { ar: boolean }) {
  return (
    <div className="electronic-approval-notice" role="note">
      <span aria-hidden="true">⚠️</span>
      <p>
        <strong>{ar ? 'اعتماد إلكتروني' : 'Electronic approval'}</strong>
        {ar
          ? 'تم اعتماد هذا الطلب إلكترونياً من النظام، وسيقوم الفريق بالتحقق من المستندات. في حال تبيّن أن المستندات تخالف الاشتراطات أو غير ملائمة يُعتبر الحجز ملغياً مباشرة، لذا يرجى التأكد من رفع المستندات الصحيحة.'
          : 'This request was approved electronically by the system, and the team will verify the documents. If they turn out to break the requirements or to be unsuitable, the booking is cancelled immediately — please make sure you upload the correct documents.'}
      </p>
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
  item: LeaseJourneyProps['lifecycle']['requirements'][number],
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

  async function upload(code: string, event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
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

  return (
    <div className="lease-docs-wrap">
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
                    disabled={busy !== null}
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

function LeaseContractSign({ lifecycle, locale, referenceCode, mode }: LeaseJourneyProps) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contract = lifecycle.contract;
  if (!contract) return null;

  async function sign(signaturePng: string) {
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
