'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from '@/i18n/navigation';
import { DocFileThumb } from '@/components/doc-file-thumb';
import { DocStatusMark, docStatusLabel } from '@/components/doc-status-mark';
import { FilePreviewDialog, type PreviewFile } from '@/components/file-preview';
import { EsignSignaturePad } from '@/components/stays/esign/esign-signature-pad';
import { StayApprovalDesk } from '@/components/stays/stay-approval-desk';
import { useStayJourney } from '@/components/stays/stay-journey';
import { StaySendPhone } from '@/components/stays/stay-send-phone';
import { StayTrip } from '@/components/stays/stay-trip';
import { LeaseCheques } from '@/components/lease-cheques-panel';
import { UploadPrepareDialog } from '@/components/upload-prepare-dialog';
import { ApiError, browserNextMutation } from '@/lib/api';
import { compressImageFile } from '@/lib/compress-image';
import { leaseScreens, type LeaseJourneyProps } from '@/lib/lease-journey-screens';
import {
  BOOKING_IDENTITY_DOC_LABELS,
  REQUIREMENT_FILE_MAX_CHARS,
  bookingUploadFileSlots,
  isBookingIdentityDocCode,
  leaseJourneyStageLabels,
  otherSlotUsingUploadFileName,
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
  const needsReplace =
    props.lifecycle.requirements.some((item) => item.status === 'rejected') ||
    props.lifecycle.cheques.some((item) => item.status === 'rejected');

  return (
    <section
      key={selected}
      className={`guest-stay-detail__greeting guest-stay-detail__greeting--confirmed${
        past ? ' guest-stay-detail__greeting--past' : ''
      }${needsReplace && !past ? ' guest-stay-detail__greeting--docs-returned' : ''}`}
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
      {needsReplace && !past ? <PackageReturnedNotice {...props} /> : null}
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
      {screen.action === 'sign_terms' && props.lifecycle.bookingDocsReturn ? (
        <BookingDocsReturnNotice
          ar={ar}
          referenceCode={plate}
          docsReturn={props.lifecycle.bookingDocsReturn}
        />
      ) : null}
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
          {props.lifecycle.bookingDocsReturn
            ? ar
              ? 'أعد الالتقاط والتوقيع'
              : 'Re-capture & sign'
            : ar
              ? 'توقيع اتفاقية الحجز'
              : 'Sign the booking agreement'}
        </Link>
      ) : null}
      {screen.action === 'view_terms' ? (
        <Link
          className="button button--quiet guest-stay-detail__rebook"
          href={`/book/sign?ref=${encodeURIComponent(plate)}&view=1`}
        >
          {ar ? 'عرض اتفاقية الحجز الموقّعة' : 'View signed booking agreement'}
        </Link>
      ) : null}
      {screen.action === 'documents' && (!past || needsReplace) ? (
        <>
          <DocumentsNeededNotice {...props} />
          <LeaseDocuments {...props} />
          <LeaseCheques {...props} />
          <DocumentsSendPanel {...props} />
        </>
      ) : null}
      {screen.action === 'documents' && past && !needsReplace ? (
        <>
          <LeaseDocuments {...props} />
          <LeaseCheques {...props} readOnly />
        </>
      ) : null}
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

/** Owner returned specific booking identity docs — upload / re-capture each rejected one. */
function BookingDocsReturnNotice({
  ar,
  referenceCode,
  docsReturn,
}: {
  ar: boolean;
  referenceCode: string;
  docsReturn: NonNullable<LeaseJourneyProps['lifecycle']['bookingDocsReturn']>;
}) {
  const router = useRouter();
  const rejected = (docsReturn.rejected ?? []).filter(isBookingIdentityDocCode);
  const replaced = new Set((docsReturn.replaced ?? []).filter(isBookingIdentityDocCode));
  const stagedEsign = new Set(docsReturn.stagedEsign ?? []);
  const locked = (docsReturn.locked ?? []).filter(isBookingIdentityDocCode);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ code: string; file: File } | null>(null);
  const filesBase = `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/files`;
  const fileOf = (code: string) => {
    if (code === 'civil_id_copy') return `${filesBase}/party-civil-id`;
    if (code === 'passport_copy') return `${filesBase}/party-passport`;
    if (code === 'cr_copy') return `${filesBase}/party-cr`;
    return `${filesBase}/${code}`;
  };
  const canFileReplace = (code: string) =>
    code === 'id-front' ||
    code === 'id-back' ||
    code === 'selfie' ||
    code === 'civil_id_copy' ||
    code === 'passport_copy' ||
    code === 'cr_copy';
  const isDone = (code: string) =>
    replaced.has(code as (typeof rejected)[number]) || stagedEsign.has(code as 'id-front');

  function pick(code: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setPending({ code, file });
  }

  async function send(code: string, prepared: File) {
    setPending(null);
    setBusy(code);
    setError(null);
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
        `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/identity-docs`,
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

  return (
    <div className="notice notice--warning booking-docs-return" role="status">
      <strong>{ar ? 'المستندات المطلوب تعديلها' : 'Documents that must be fixed'}</strong>
      {docsReturn.note ? (
        <p className="booking-docs-return__note">
          {ar ? 'ملاحظة المالك: ' : 'Owner note: '}«{docsReturn.note}»
        </p>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {rejected.length ? (
        <ul className="booking-docs-return__list">
          {rejected.map((code) => {
            const labels = BOOKING_IDENTITY_DOC_LABELS[code];
            const done = isDone(code);
            const accept =
              code === 'id-front' || code === 'id-back' || code === 'selfie'
                ? 'image/*'
                : 'image/*,application/pdf';
            return (
              <li
                key={code}
                className={`booking-docs-return__item booking-docs-return__item--fix${
                  done ? ' booking-docs-return__item--done' : ''
                }`}
              >
                {done ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileOf(code)} alt="" loading="lazy" />
                ) : (
                  <span className="booking-docs-return__mark" aria-hidden>
                    !
                  </span>
                )}
                <div className="booking-docs-return__text">
                  <span>{ar ? labels.ar : labels.en}</span>
                  <small>
                    {done
                      ? ar
                        ? 'تم الرفع — يمكنك الاستبدال قبل التوقيع'
                        : 'Uploaded — you can replace before signing'
                      : code === 'signature'
                        ? ar
                          ? 'أعد التوقيع من شاشة الاتفاقية'
                          : 'Re-sign from the agreement screen'
                        : ar
                          ? 'ارفع ملفاً جديداً مكان السابق'
                          : 'Upload a new file to replace the previous one'}
                  </small>
                </div>
                <div className="booking-docs-return__actions">
                  {canFileReplace(code) ? (
                    <label className="button button--quiet booking-docs-return__upload">
                      {busy === code
                        ? ar
                          ? 'جارٍ الرفع…'
                          : 'Uploading…'
                        : done
                          ? ar
                            ? 'استبدال'
                            : 'Replace'
                          : ar
                            ? 'رفع مستند جديد'
                            : 'Upload new file'}
                      <input
                        type="file"
                        accept={accept}
                        hidden
                        disabled={busy !== null}
                        onChange={(event) => pick(code, event)}
                      />
                    </label>
                  ) : null}
                  {code === 'signature' ||
                  code === 'id-front' ||
                  code === 'id-back' ||
                  code === 'selfie' ? (
                    <Link
                      className="button button--quiet"
                      href={`/book/sign?ref=${encodeURIComponent(referenceCode)}`}
                    >
                      {ar ? 'التقاط من الكاميرا' : 'Capture with camera'}
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">
          {ar
            ? 'أعد رفع المستندات المطلوبة ثم وقّع من جديد.'
            : 'Re-upload the requested documents and sign again.'}
        </p>
      )}
      {locked.length ? (
        <div className="booking-docs-return__locked">
          <strong>{ar ? 'معتمدة ومقفلة (لا تُغيَّر)' : 'Approved & locked (unchanged)'}</strong>
          <ul className="booking-docs-return__list">
            {locked.map((code) => {
              const labels = BOOKING_IDENTITY_DOC_LABELS[code];
              return (
                <li
                  key={code}
                  className="booking-docs-return__item booking-docs-return__item--lock"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileOf(code)} alt="" loading="lazy" />
                  <span>{ar ? labels.ar : labels.en}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {pending ? (
        <UploadPrepareDialog
          file={pending.file}
          ar={ar}
          title={ar ? 'معاينة المستند قبل الإرسال' : 'Preview document before sending'}
          onCancel={() => setPending(null)}
          onConfirm={(file) => void send(pending.code, file)}
        />
      ) : null}
    </div>
  );
}

/** Clear call-to-action once the owner approved and documents/cheques are due. */
function DocumentsNeededNotice({
  locale,
  phase,
  lifecycle,
}: Pick<LeaseJourneyProps, 'locale' | 'phase' | 'lifecycle'>) {
  const ar = locale === 'ar';
  if (phase !== 'awaiting_documents' && phase !== 'awaiting_documents_review') {
    return null;
  }
  const signed = Boolean(lifecycle.tenantSignedAt);
  const needsAttest = lifecycle.requireTenantAttestation && !lifecycle.tenantAttestedAt;
  const rejected =
    lifecycle.requirements.some((item) => item.status === 'rejected') ||
    lifecycle.cheques.some((item) => item.status === 'rejected');
  return (
    <div
      className={`notice ${
        rejected
          ? 'notice--error'
          : phase === 'awaiting_documents'
            ? 'notice--info'
            : 'notice--success'
      }`}
      role={rejected ? 'alert' : 'status'}
    >
      <strong>
        {rejected
          ? ar
            ? 'أرجع المالك مستنداً أو شيكاً'
            : 'The owner returned a document or cheque'
          : signed
            ? ar
              ? 'العقد موقّع — ارفع المستندات الآن'
              : 'Contract signed — upload documents now'
            : ar
              ? 'مطلوب منك إجراء'
              : 'Action needed from you'}
      </strong>
      <span className="lease-docs-notice__body">
        {rejected
          ? ar
            ? 'ستجد السبب بجانب كل بند مرفوض. استبدل الملف ثم اضغط «تأكيد والمتابعة وإرسال المستندات».'
            : 'The reason is next to each rejected item. Replace the file, then press “Confirm, continue and send documents”.'
          : phase === 'awaiting_documents_review'
            ? ar
              ? 'وصلت ملفاتك وهي قيد مراجعة المالك أو من يمثله.'
              : 'Your files arrived and are under review by the owner or their representative.'
            : needsAttest || !lifecycle.customerDocumentsSentAt
              ? ar
                ? 'ارفع كل المستندات والشيكات، ثم اضغط «تأكيد والمتابعة وإرسال المستندات» — يُبلَّغ المالك مرة واحدة بعد الإرسال.'
                : 'Upload every document and cheque, then press “Confirm, continue and send documents” — the owner is notified once after you send.'
              : ar
                ? 'وصلت ملفاتك وهي قيد مراجعة المالك أو من يمثله.'
                : 'Your files arrived and are under review by the owner or their representative.'}
      </span>
    </div>
  );
}

/** Prominent alert when the owner rejected one or more package items after review. */
function PackageReturnedNotice({
  locale,
  lifecycle,
}: Pick<LeaseJourneyProps, 'locale' | 'lifecycle'>) {
  const ar = locale === 'ar';
  const rejectedDocs = lifecycle.requirements.filter((item) => item.status === 'rejected');
  const rejectedCheques = lifecycle.cheques.filter((item) => item.status === 'rejected');
  const names = [
    ...rejectedDocs.map((item) => (ar ? item.labelAr : item.labelEn || item.labelAr)),
    ...rejectedCheques.map((item) => (ar ? item.labelAr : item.labelEn)),
  ];
  return (
    <div className="lease-package-returned" role="alert">
      <strong>{ar ? 'تنبيه: أُرجعت ملفات للمراجعة' : 'Alert: files returned for revision'}</strong>
      <p>
        {ar
          ? 'طلب المالك بديلاً أوضح. عدّل البنود أدناه ثم أعد إرسال الحزمة.'
          : 'The owner asked for a clearer replacement. Fix the items below, then send the package again.'}
      </p>
      {names.length ? (
        <ul>
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      ) : null}
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

/** After every file is uploaded: attest + notify the owner once. */
function DocumentsSendPanel({ locale, referenceCode, lifecycle }: LeaseJourneyProps) {
  const ar = locale === 'ar';
  const router = useRouter();
  const requirements = lifecycle.requirements ?? [];
  const cheques = lifecycle.cheques ?? [];
  const hasPackage = requirements.length > 0 || cheques.length > 0;
  const packageReady =
    hasPackage &&
    !requirements.some((item) => item.status === 'pending' || item.status === 'rejected') &&
    !cheques.some((item) => item.status === 'pending' || item.status === 'rejected');
  const sent = Boolean(lifecycle.customerDocumentsSentAt);
  const attested = Boolean(lifecycle.tenantAttestedAt);
  const [checked, setChecked] = useState(attested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPackage) return null;

  async function send() {
    if (!packageReady) {
      setError(
        ar
          ? 'ارفع كل المستندات والشيكات المطلوبة أولاً.'
          : 'Upload every required document and cheque first.',
      );
      return;
    }
    if (!checked && !attested) {
      setError(ar ? 'يجب التأشير على الإقرار أولاً.' : 'Tick the confirmation box first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await browserNextMutation(
        `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/documents/send`,
        { method: 'POST', body: JSON.stringify({ accepted: true }) },
      );
      router.refresh();
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  if (sent && packageReady) {
    return (
      <p className="notice notice--success" role="status">
        {ar
          ? 'تم إرسال المستندات والشيكات للمراجعة. سيُبلَّغ المالك ويراجعها قريباً.'
          : 'Documents and cheques were sent for review. The owner has been notified.'}
      </p>
    );
  }

  return (
    <div className="lease-attestation" role="group" aria-labelledby="lease-docs-send-title">
      <h3 id="lease-docs-send-title">
        {ar ? 'تأكيد وإرسال المستندات' : 'Confirm and send documents'}
      </h3>
      <p className="muted">
        {ar
          ? 'بعد رفع كل الملفات: أكّد صحة بياناتك ثم أرسل الحزمة. يُبلَّغ المالك مرة واحدة عند الضغط على الزر — وليس عند رفع كل ملف على حدة.'
          : 'After every file is uploaded: confirm your details, then send the package. The owner is emailed once when you press the button — not on each upload.'}
      </p>
      {!packageReady ? (
        <p className="notice notice--info" role="status">
          {ar
            ? 'أكمل رفع كل المستندات والشيكات أدناه/أعلاه ليصبح زر الإرسال متاحاً.'
            : 'Finish uploading every document and cheque so the send button becomes available.'}
        </p>
      ) : null}
      <label className="lease-attestation__check">
        <input
          type="checkbox"
          checked={checked || attested}
          disabled={attested || busy}
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
        disabled={busy || !packageReady || (!checked && !attested)}
        onClick={() => void send()}
      >
        {busy
          ? ar
            ? 'جارٍ الإرسال…'
            : 'Sending…'
          : ar
            ? 'تأكيد والمتابعة وإرسال المستندات'
            : 'Confirm, continue and send documents'}
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

function LeaseDocuments({ lifecycle, locale, referenceCode }: LeaseJourneyProps) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ code: string; file: File } | null>(null);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'step'>('list');
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(`bhd-doc-view:${referenceCode}`);
      if (stored === 'step' || stored === 'list') setViewMode(stored);
    } catch {
      /* private mode */
    }
  }, [referenceCode]);

  function chooseMode(mode: 'list' | 'step') {
    setViewMode(mode);
    try {
      sessionStorage.setItem(`bhd-doc-view:${referenceCode}`, mode);
    } catch {
      /* ignore */
    }
  }

  function pick(code: string, event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    if (picked.type !== 'application/pdf' && !picked.type.startsWith('image/')) {
      setError(ar ? 'أرسل صورة أو ملف PDF.' : 'Send an image or a PDF.');
      return;
    }
    const duplicate = otherSlotUsingUploadFileName(
      picked.name,
      bookingUploadFileSlots({
        requirements: lifecycle.requirements,
        cheques: lifecycle.cheques,
      }),
      `doc:${code}`,
    );
    if (duplicate) {
      const message = ar
        ? `المستند مكرر: الملف «${duplicate}» مرفوع في حقل آخر — استبدله بملف مختلف.`
        : `Duplicate document: “${duplicate}” is already attached elsewhere — replace it with a different file.`;
      setError(message);
      window.alert(message);
      return;
    }
    setError(null);
    setPending({ code, file: picked });
  }

  async function send(code: string, prepared: File) {
    setBusy(code);
    setPending(null);
    try {
      const duplicate = otherSlotUsingUploadFileName(
        prepared.name,
        bookingUploadFileSlots({
          requirements: lifecycle.requirements,
          cheques: lifecycle.cheques,
        }),
        `doc:${code}`,
      );
      if (duplicate) {
        throw new Error(
          ar
            ? `اسم الملف «${duplicate}» مستخدم في حقل آخر — ارفع ملفاً مختلفاً لكل مستند.`
            : `The file name “${duplicate}” is already used on another field — upload a different file for each document.`,
        );
      }
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

  const cheques = lifecycle.cheques ?? [];
  const needsTeamVerify = (item: { status: string; autoApproved?: boolean; verified?: boolean }) =>
    item.autoApproved && item.status === 'approved' && !item.verified;
  const remainingDocs = lifecycle.requirements.filter(
    (item) => item.status !== 'approved' || needsTeamVerify(item),
  );
  const remainingCheques = cheques.filter(
    (item) => item.status !== 'approved' || needsTeamVerify(item),
  );
  const remaining = [
    ...remainingDocs.map((item) => ({
      key: `doc-${item.code}`,
      status: item.status,
      label: ar ? item.labelAr : item.labelEn || item.labelAr,
      pendingVerify: needsTeamVerify(item),
    })),
    ...remainingCheques.map((item) => ({
      key: `cheque-${item.key}`,
      status: item.status,
      label: ar ? item.labelAr : item.labelEn || item.labelAr,
      pendingVerify: needsTeamVerify(item),
    })),
  ];
  const orderedRequirements = [...lifecycle.requirements].sort((left, right) => {
    const rank = (status: string) =>
      status === 'pending' || status === 'rejected' ? 0 : status === 'submitted' ? 1 : 2;
    return rank(left.status) - rank(right.status);
  });
  const actionQueue = orderedRequirements.filter(
    (item) => item.status === 'pending' || item.status === 'rejected',
  );
  const uploadedRequirements = orderedRequirements.filter(
    (item) => item.status !== 'pending' && item.status !== 'rejected',
  );
  const stepItem = actionQueue.length
    ? actionQueue[Math.min(stepIndex, actionQueue.length - 1)]!
    : null;

  function renderDocItem(item: (typeof lifecycle.requirements)[number]) {
    const canUpload = item.status !== 'approved';
    const fileHref = item.fileName
      ? `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/files/doc-${encodeURIComponent(item.code)}`
      : null;
    return (
      <li key={item.code} className={`lease-docs__item lease-docs__item--${item.status}`}>
        <DocStatusMark status={item.status} ar={ar} viewer="tenant" />
        <div className="lease-docs__text">
          <strong>{ar ? item.labelAr : item.labelEn || item.labelAr}</strong>
          <span>
            {item.autoApproved && item.status === 'approved' && !item.verified
              ? requirementStatus(item, ar)
              : docStatusLabel(item.status, ar, 'tenant')}
          </span>
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
            <DocFileThumb
              href={fileHref}
              label={ar ? item.labelAr : item.labelEn || item.labelAr}
              onOpen={() =>
                setPreview({
                  href: fileHref,
                  label: ar ? item.labelAr : item.labelEn || item.labelAr,
                })
              }
            />
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
                disabled={busy !== null}
                onChange={(event) => pick(item.code, event)}
              />
            </label>
          ) : null}
        </div>
      </li>
    );
  }
  const totalItems = lifecycle.requirements.length + cheques.length;
  const fullyApprovedCount = totalItems - remaining.length;
  const pendingVerifyCount = remaining.filter((item) => item.pendingVerify).length;

  return (
    <div className="lease-docs-wrap">
      <h3 className="lease-docs__heading">
        {ar ? '📎 المستندات المطلوبة' : '📎 Required documents'}
      </h3>
      <ul className="doc-status-legend" aria-label={ar ? 'مفتاح الحالات' : 'Status key'}>
        <li>
          <DocStatusMark status="approved" ar={ar} viewer="tenant" />
          <span>{ar ? 'مكتمل / معتمد (أخضر)' : 'Complete / approved (green)'}</span>
        </li>
        <li>
          <DocStatusMark status="submitted" ar={ar} viewer="tenant" />
          <span>{ar ? 'تم الرفع — بانتظار اعتماد المالك' : 'Uploaded — awaiting owner approval'}</span>
        </li>
        <li>
          <DocStatusMark status="pending" ar={ar} viewer="tenant" />
          <span>{ar ? 'ناقص — يحتاج رفع (أحمر)' : 'Missing — needs upload (red)'}</span>
        </li>
        <li>
          <DocStatusMark status="rejected" ar={ar} viewer="tenant" />
          <span>{ar ? 'مرفوض — استبدل الملف (أحمر)' : 'Rejected — replace file (red)'}</span>
        </li>
      </ul>
      <div className="lease-docs__modes" role="group" aria-label={ar ? 'طريقة عرض المستندات' : 'Document view'}>
        <button type="button" aria-pressed={viewMode === 'list'} onClick={() => chooseMode('list')}>
          {ar ? 'القائمة' : 'List'}
        </button>
        <button type="button" aria-pressed={viewMode === 'step'} onClick={() => chooseMode('step')}>
          {ar ? 'واحداً تلو الآخر' : 'One by one'}
        </button>
      </div>
      {remaining.length ? (
        <div className="lease-docs-remaining" role="status">
          <strong>
            {pendingVerifyCount
              ? ar
                ? `بانتظار اعتماد المالك: ${remaining.length}`
                : `Awaiting owner verification: ${remaining.length}`
              : ar
                ? `المتبقي للاعتماد: ${remaining.length}`
                : `Still awaiting approval: ${remaining.length}`}
          </strong>
          <span className="muted">
            {ar
              ? `${fullyApprovedCount} معتمدة نهائياً من ${totalItems}`
              : `${fullyApprovedCount} of ${totalItems} fully approved`}
          </span>
          <ul className="lease-docs-remaining__list">
            {remaining.map((item) => {
              const markStatus = item.pendingVerify ? 'submitted' : item.status;
              return (
                <li
                  key={item.key}
                  className={`lease-docs-remaining__item lease-docs-remaining__item--${markStatus}`}
                >
                  <DocStatusMark status={markStatus} ar={ar} viewer="tenant" />
                  <span>{item.label}</span>
                  <small>
                    {item.pendingVerify
                      ? ar
                        ? 'قُبل إلكترونياً — قيد تحقق الفريق'
                        : 'Accepted electronically — team verifying'
                      : docStatusLabel(item.status, ar, 'tenant')}
                  </small>
                </li>
              );
            })}
          </ul>
          {pendingVerifyCount ? (
            <p className="notice notice--info">
              {ar
                ? 'العقد قد يكون معتمداً وموقّعاً، لكن المستندات أعلاه ما زالت بانتظار اعتماد المالك يدوياً. إن اتضح أن المستندات أو البيانات غير صحيحة يحق للمؤجر إلغاء العقد مع تحمل المستأجر كافة التكاليف والمسؤولية.'
                : 'The contract may already be approved and signed, but the files above still need the owner’s manual verification. If documents or details prove incorrect, the landlord may cancel and you bear all costs and responsibility.'}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="notice notice--success" role="status">
          {ar
            ? 'كل المستندات والشيكات معتمدة من المالك ✓'
            : 'Every document and cheque is owner-approved ✓'}
        </p>
      )}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {viewMode === 'step' ? (
        <div className="lease-docs__step">
          {stepItem ? (
            <>
              <div className="lease-docs__step-head">
                <strong>{ar ? stepItem.labelAr : stepItem.labelEn || stepItem.labelAr}</strong>
                <span className="muted">
                  {ar
                    ? `${Math.min(stepIndex, actionQueue.length - 1) + 1} من ${actionQueue.length} متبقٍ`
                    : `${Math.min(stepIndex, actionQueue.length - 1) + 1} of ${actionQueue.length} remaining`}
                </span>
              </div>
              <span>
                {stepItem.status === 'rejected' && stepItem.note
                  ? ar
                    ? `ملاحظة المالك: ${stepItem.note}`
                    : `Owner note: ${stepItem.note}`
                  : ar
                    ? 'ارفع هذا المستند، ثم ينتقل التركيز إلى المستند التالي.'
                    : 'Upload this document, then focus moves to the next one.'}
              </span>
              <div className="lease-docs__step-actions">
                <label className="button button--primary lease-docs__upload">
                  {busy === stepItem.code
                    ? ar
                      ? 'جارٍ الإرسال…'
                      : 'Sending…'
                    : stepItem.status === 'rejected'
                      ? ar
                        ? 'استبدال المستند'
                        : 'Replace document'
                      : ar
                        ? 'رفع المستند'
                        : 'Upload document'}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    hidden
                    disabled={busy !== null}
                    onChange={(event) => pick(stepItem.code, event)}
                  />
                </label>
                {actionQueue.length > 1 ? (
                  <>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={busy !== null || stepIndex <= 0}
                      onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
                    >
                      {ar ? 'السابق' : 'Previous'}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={busy !== null || stepIndex >= actionQueue.length - 1}
                      onClick={() =>
                        setStepIndex((index) => Math.min(actionQueue.length - 1, index + 1))
                      }
                    >
                      {ar ? 'التالي' : 'Next'}
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <p className="notice notice--success" role="status">
              {ar
                ? 'رُفعت كل المستندات المطلوبة. المرفوع يظهر أسفل القائمة.'
                : 'Every required document is uploaded. Uploaded files sit at the bottom of the list.'}
            </p>
          )}
          {uploadedRequirements.length ? (
            <ul className="lease-docs lease-docs--checklist">
              {uploadedRequirements.map((item) => renderDocItem(item))}
            </ul>
          ) : null}
        </div>
      ) : (
        <ul className="lease-docs lease-docs--checklist">
          {orderedRequirements.map((item) => renderDocItem(item))}
        </ul>
      )}
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

function LeaseContractSign({ lifecycle, locale, referenceCode, mode }: LeaseJourneyProps) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [attestedLocal, setAttestedLocal] = useState(Boolean(lifecycle.tenantAttestedAt));
  const needsAttest = lifecycle.requireTenantAttestation && !attestedLocal;
  const [gateOpen, setGateOpen] = useState(true);
  const [dataOk, setDataOk] = useState(!needsAttest);
  const [termsOk, setTermsOk] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contract = lifecycle.contract;
  if (!contract) return null;

  async function confirmGate() {
    if (needsAttest && !dataOk) {
      setError(ar ? 'يجب التأشير على إقرار صحة البيانات أولاً.' : 'Tick the data accuracy box first.');
      return;
    }
    if (!termsOk) {
      setError(
        ar ? 'أكّد أولاً أنك قرأت العقد ووافقت عليه.' : 'First confirm you read and accept the contract.',
      );
      return;
    }
    setGateBusy(true);
    setError(null);
    try {
      if (needsAttest) {
        await browserNextMutation(
          `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/attestation`,
          { method: 'POST', body: JSON.stringify({ accepted: true }) },
        );
        setAttestedLocal(true);
      }
      setGateOpen(false);
    } catch (caught) {
      setError(errorText(caught, ar));
    } finally {
      setGateBusy(false);
    }
  }

  async function sign(signaturePng: string) {
    if (gateOpen) {
      setError(
        ar ? 'أكمل التأكيد في النافذة أولاً ثم وقّع.' : 'Finish the confirmation popup first, then sign.',
      );
      return;
    }
    if (!termsOk) {
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
      {gateOpen ? (
        <div
          className="lease-sign-gate"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lease-sign-gate-title"
        >
          <div className="lease-sign-gate__card">
            <h3 id="lease-sign-gate-title">
              {ar ? 'تأكيد صحة البيانات والعقد' : 'Confirm details and contract'}
            </h3>
            <p className="muted">
              {ar
                ? 'المستندات تُراجع يدوياً قبل التسليم. أي اختلاف أو عدم صحة يمنح المالك حق إلغاء الحجز مع تحمّلك كامل المسؤولية.'
                : 'Documents are reviewed manually before handover. Any mismatch lets the owner cancel, and you bear full responsibility.'}
            </p>
            {lifecycle.requireTenantAttestation ? (
              <label className="lease-attestation__check">
                <input
                  type="checkbox"
                  checked={dataOk || attestedLocal}
                  disabled={attestedLocal || gateBusy}
                  onChange={(event) => setDataOk(event.target.checked)}
                />
                <span>
                  {ar
                    ? 'أقرّ بأن جميع بياناتي ومستنداتي صحيحة وكاملة، وأتحمّل المسؤولية كاملة إن تبيّن خلاف ذلك، وأعلم بحق المالك في إلغاء الحجز قبل التسليم.'
                    : 'I confirm all my details and documents are true and complete, I accept full responsibility if they are not, and I understand the owner may cancel before handover.'}
                </span>
              </label>
            ) : null}
            <Link
              className="button button--quiet"
              href={`/tenant/contracts/${encodeURIComponent(contract.id)}`}
              target="_blank"
            >
              {ar ? `اقرأ العقد ${contract.reference} كاملاً` : `Read ${contract.reference} in full`}
            </Link>
            <label className="lease-attestation__check">
              <input
                type="checkbox"
                checked={termsOk}
                disabled={gateBusy}
                onChange={(event) => setTermsOk(event.target.checked)}
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
            <button
              type="button"
              className="button button--primary"
              disabled={gateBusy || !termsOk || (needsAttest && !dataOk)}
              onClick={() => void confirmGate()}
            >
              {gateBusy
                ? ar
                  ? 'جارٍ الحفظ…'
                  : 'Saving…'
                : ar
                  ? 'تأكيد والمتابعة للتوقيع'
                  : 'Confirm and continue to sign'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <Link
            className="button button--quiet"
            href={`/tenant/contracts/${encodeURIComponent(contract.id)}`}
            target="_blank"
          >
            {ar ? `اقرأ العقد ${contract.reference} كاملاً` : `Read ${contract.reference} in full`}
          </Link>
          <p className="notice notice--success" role="status">
            {ar
              ? 'تم التأكيد — ارسم توقيعك أدناه لإتمام العقد.'
              : 'Confirmed — draw your signature below to finish the contract.'}
          </p>
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
        </>
      )}
    </div>
  );
}
