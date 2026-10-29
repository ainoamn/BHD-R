'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { fetchBrowserCsrfToken } from '@/lib/api';
import { stayConfirmedReturnPath } from '@/lib/stay-esign-flags';
import { EsignCameraCapture } from '@/components/stays/esign/esign-camera-capture';
import { EsignSignaturePad } from '@/components/stays/esign/esign-signature-pad';
import { OmaniIdFrame, SelfiePortraitFrame } from '@/components/stays/esign/omani-id-frame';

type Step = 'contract' | 'sign' | 'id_front' | 'id_back' | 'selfie' | 'review' | 'done';
type CaptureStep = 'sign' | 'id_front' | 'id_back' | 'selfie';

const CAPTURE_STEPS: CaptureStep[] = ['sign', 'id_front', 'id_back', 'selfie'];

const STEP_CODE: Record<CaptureStep, 'signature' | 'id-front' | 'id-back' | 'selfie'> = {
  sign: 'signature',
  id_front: 'id-front',
  id_back: 'id-back',
  selfie: 'selfie',
};

export type StayEsignDocsReturn = {
  note: string;
  rejected: string[];
  locked: string[];
  replaced?: string[];
  /** E-sign captures already re-uploaded from the confirmed page. */
  stagedEsign?: string[];
  /**
   * Base path for locked / staged file previews, e.g.
   * `/api/public/bookings/deposits/RSV-…/files` (no trailing slash).
   * Must be a plain string — functions cannot cross the RSC→client boundary.
   */
  filesBase: string;
};

function lockedPreviewHref(filesBase: string, code: string): string {
  const file =
    code === 'civil_id_copy'
      ? 'party-civil-id'
      : code === 'passport_copy'
        ? 'party-passport'
        : code === 'cr_copy'
          ? 'party-cr'
          : code;
  return `${filesBase}/${file}`;
}

export function StayEsignWizard({
  locale,
  referenceCode,
  contractHtml,
  contractDocument,
  signatureSerial = null,
  initiallyComplete = false,
  submitUrl,
  continuePath,
  contractTitle,
  requireCsrf = false,
  docsReturn = null,
}: {
  locale: string;
  referenceCode: string;
  contractHtml?: string;
  /** Server-rendered official document; replaces `contractHtml` and is refreshed once signed. */
  contractDocument?: ReactNode;
  /** E-signature serial (ES-YYYY-NNNNNN) once the document is signed. */
  signatureSerial?: string | null;
  initiallyComplete?: boolean;
  /** Defaults to the stays e-sign endpoint. */
  submitUrl?: string;
  continuePath?: string;
  contractTitle?: { ar: string; en: string };
  /** Signed-in flows (long-term bookings) post with the session CSRF token. */
  requireCsrf?: boolean;
  /** Owner asked for selective document fixes; locked captures stay read-only. */
  docsReturn?: StayEsignDocsReturn | null;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const locked = useMemo(
    () => new Set((docsReturn?.locked ?? []).map((code) => code.trim())),
    [docsReturn],
  );
  const staged = useMemo(
    () => new Set((docsReturn?.stagedEsign ?? []).map((code) => code.trim())),
    [docsReturn],
  );
  const captureOpen = useCallback(
    (step: CaptureStep) => {
      const code = STEP_CODE[step];
      if (locked.has(code)) return false;
      // Already replaced from the confirmed page — keep for review, skip re-capture.
      if (staged.has(code)) return false;
      return true;
    },
    [locked, staged],
  );
  const [step, setStep] = useState<Step>(initiallyComplete ? 'done' : 'contract');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [idFront, setIdFront] = useState<string | null>(null);
  const [idBack, setIdBack] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [signedAtLabel, setSignedAtLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!docsReturn?.filesBase) return;
    // Locked / staged previews use file URLs; open captures start empty.
    if (locked.has('signature')) {
      setSignatureDataUrl(lockedPreviewHref(docsReturn.filesBase, 'signature'));
    }
    if (locked.has('id-front') || staged.has('id-front')) {
      setIdFront(lockedPreviewHref(docsReturn.filesBase, 'id-front'));
    }
    if (locked.has('id-back') || staged.has('id-back')) {
      setIdBack(lockedPreviewHref(docsReturn.filesBase, 'id-back'));
    }
    if (locked.has('selfie') || staged.has('selfie')) {
      setSelfie(lockedPreviewHref(docsReturn.filesBase, 'selfie'));
    }
  }, [docsReturn, locked, staged]);

  const goToConfirmed = useCallback(() => {
    router.push(continuePath ?? stayConfirmedReturnPath(locale, referenceCode));
  }, [continuePath, locale, referenceCode, router]);

  const nextAfter = useCallback(
    (from: CaptureStep | 'contract'): Step => {
      const start = from === 'contract' ? -1 : CAPTURE_STEPS.indexOf(from);
      for (let i = start + 1; i < CAPTURE_STEPS.length; i += 1) {
        const candidate = CAPTURE_STEPS[i]!;
        if (captureOpen(candidate)) return candidate;
      }
      return 'review';
    },
    [captureOpen],
  );

  const prevBefore = useCallback(
    (from: CaptureStep | 'review'): Step => {
      if (from === 'review') {
        for (let i = CAPTURE_STEPS.length - 1; i >= 0; i -= 1) {
          const candidate = CAPTURE_STEPS[i]!;
          if (captureOpen(candidate)) return candidate;
        }
        return 'contract';
      }
      const start = CAPTURE_STEPS.indexOf(from);
      for (let i = start - 1; i >= 0; i -= 1) {
        const candidate = CAPTURE_STEPS[i]!;
        if (captureOpen(candidate)) return candidate;
      }
      return 'contract';
    },
    [captureOpen],
  );

  const activeCaptureOrder = useMemo(
    () => CAPTURE_STEPS.filter((item) => captureOpen(item)),
    [captureOpen],
  );
  const progressIndex = useMemo(() => {
    if (step === 'contract') return 0;
    if (step === 'review' || step === 'done') return activeCaptureOrder.length + 1;
    const idx = activeCaptureOrder.indexOf(step);
    return idx < 0 ? 1 : idx + 1;
  }, [activeCaptureOrder, step]);
  const progressTotal = Math.max(2, activeCaptureOrder.length + 2);
  const progressPct = Math.round(((progressIndex + 1) / progressTotal) * 100);

  const stepTitle = useMemo(() => {
    switch (step) {
      case 'contract':
        if (contractTitle) return ar ? contractTitle.ar : contractTitle.en;
        return ar ? 'عقد الإقامة' : 'Stay contract';
      case 'sign':
        return ar ? 'التوقيع الإلكتروني' : 'E-signature';
      case 'id_front':
        return ar ? 'صورة البطاقة من الأمام' : 'ID card — front';
      case 'id_back':
        return ar ? 'صورة البطاقة من الخلف' : 'ID card — back';
      case 'selfie':
        return ar ? 'صورة شخصية' : 'Portrait photo';
      case 'review':
        return ar ? 'مراجعة وإرسال' : 'Review & submit';
      case 'done':
        return ar ? 'تم الاعتماد' : 'Approved';
      default:
        return '';
    }
  }, [ar, contractTitle, step]);

  async function submitEsign() {
    const needSignature = captureOpen('sign');
    const needFront = captureOpen('id_front');
    const needBack = captureOpen('id_back');
    const needSelfie = captureOpen('selfie');
    if (
      (needSignature && !signatureDataUrl?.startsWith('data:image/')) ||
      (needFront && !idFront?.startsWith('data:image/')) ||
      (needBack && !idBack?.startsWith('data:image/')) ||
      (needSelfie && !selfie?.startsWith('data:image/'))
    ) {
      setError(
        ar ? 'أكمل التوقيع وصور الهوية المطلوبة' : 'Complete the required signature and photos',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        submitUrl ?? `/api/public/stays/bookings/${encodeURIComponent(referenceCode)}/esign`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-requested-with': 'BHD-R',
            ...(requireCsrf ? { 'x-csrf-token': await fetchBrowserCsrfToken() } : {}),
          },
          body: JSON.stringify({
            ...(needSignature ? { signaturePng: signatureDataUrl } : {}),
            ...(needFront ? { idFrontPng: idFront } : {}),
            ...(needBack ? { idBackPng: idBack } : {}),
            ...(needSelfie ? { selfiePng: selfie } : {}),
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: { messageAr?: string; message?: string };
        completed?: boolean;
        signedAt?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error?.messageAr ?? payload?.error?.message ?? 'esign_failed');
      }
      const at = payload?.signedAt ? new Date(payload.signedAt) : new Date();
      setSignedAtLabel(
        new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(at),
      );
      setStep('done');
      if (contractDocument) router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'esign_failed');
    } finally {
      setBusy(false);
    }
  }

  function reviewCard(label: string, src: string | null, open: boolean, editStep: CaptureStep) {
    if (!src) return null;
    const code = STEP_CODE[editStep];
    const ownerLocked = locked.has(code);
    const fromConfirmed = staged.has(code);
    return (
      <figure
        className={`esign-review-card${editStep === 'selfie' ? ' esign-review-card--portrait' : ''}`}
      >
        <figcaption>
          {label}
          {ownerLocked ? (
            <span className="esign-review-locked">{ar ? 'معتمد — مقفل' : 'Approved — locked'}</span>
          ) : fromConfirmed ? (
            <span className="esign-review-locked">
              {ar ? 'رُفع من صفحة التأكيد' : 'Uploaded from confirmation'}
            </span>
          ) : null}
        </figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" />
        {open ? (
          <button type="button" className="button button--quiet" onClick={() => setStep(editStep)}>
            {ar ? 'تعديل' : 'Edit'}
          </button>
        ) : ownerLocked ? (
          <p className="muted esign-review-locked-note">
            {ar ? 'اعتمده المالك ولا يمكن تغييره' : 'Approved by the owner — cannot be changed'}
          </p>
        ) : fromConfirmed ? (
          <p className="muted esign-review-locked-note">
            {ar
              ? 'للتعديل ارجع لصفحة التأكيد وارفع ملفاً جديداً'
              : 'To change it, go back to confirmation and upload again'}
          </p>
        ) : null}
      </figure>
    );
  }

  return (
    <div
      className={`stay-esign stay-esign--fullscreen${contractDocument ? ' stay-esign--document' : ''}`}
      data-step={step}
    >
      {step !== 'done' ? (
        <header className="stay-esign__top">
          <div className="stay-esign__brand" aria-hidden>
            <img src="/brand/bhd-official-symbol.svg" alt="" width="72" height="24" />
            <span>R</span>
          </div>
          <div className="stay-esign__top-text">
            <p className="stay-esign__ref" dir="ltr">
              {referenceCode}
            </p>
            <h1 className="stay-esign__title">{stepTitle}</h1>
          </div>
          <div className="stay-esign__progress" aria-hidden>
            <span style={{ width: `${progressPct}%` }} />
          </div>
        </header>
      ) : null}

      <div className="stay-esign__body">
        {step === 'contract' ? (
          <section className="stay-esign__panel stay-esign__panel--scroll">
            {docsReturn ? (
              <div className="notice notice--info stay-esign__return-note" role="status">
                {docsReturn.note ? (
                  <p>
                    {ar ? 'ملاحظة المالك: ' : 'Owner note: '}«{docsReturn.note}»
                  </p>
                ) : null}
                {docsReturn.rejected.length ? (
                  <p>
                    {ar ? 'أعد التقاط: ' : 'Re-capture: '}
                    <strong>
                      {docsReturn.rejected
                        .map((code) => {
                          if (code === 'id-front') return ar ? 'الهوية — أمام' : 'ID — front';
                          if (code === 'id-back') return ar ? 'الهوية — خلف' : 'ID — back';
                          if (code === 'selfie') return ar ? 'السيلفي' : 'Selfie';
                          if (code === 'signature') return ar ? 'التوقيع' : 'Signature';
                          if (code === 'civil_id_copy')
                            return ar ? 'نسخة البطاقة' : 'Civil ID copy';
                          if (code === 'passport_copy') return ar ? 'نسخة الجواز' : 'Passport copy';
                          if (code === 'cr_copy') return ar ? 'السجل التجاري' : 'CR copy';
                          return code;
                        })
                        .join(ar ? '، ' : ', ')}
                    </strong>
                    {ar ? ' — المعتمدة مقفلة.' : ' — approved ones stay locked.'}
                  </p>
                ) : null}
                {(() => {
                  const replaced = new Set(docsReturn.replaced ?? []);
                  const partyOpen = docsReturn.rejected.filter(
                    (code) =>
                      (code === 'civil_id_copy' ||
                        code === 'passport_copy' ||
                        code === 'cr_copy') &&
                      !replaced.has(code),
                  );
                  if (!partyOpen.length) return null;
                  return (
                    <p className="notice notice--warning" role="status">
                      {ar
                        ? 'ارفع نسخة البطاقة / الجواز / السجل من صفحة التأكيد أولاً (زر «رفع مستند جديد»)، ثم عد هنا للتوقيع.'
                        : 'Upload the civil ID / passport / CR copy from the confirmation page first (Upload new file), then return here to sign.'}
                    </p>
                  );
                })()}
              </div>
            ) : null}
            <p className="muted stay-esign__lede">
              {contractTitle
                ? ar
                  ? 'راجع بنود العقد وبيانات الحجز، ثم وافق ووقّع إلكترونياً وأرفق مستنداتك.'
                  : 'Review the contract terms and booking details, then agree, sign, and attach your documents.'
                : ar
                  ? 'راجع بيانات الحجز، ثم وافق ووقّع إلكترونياً. الشروط مطوية ويمكن فتحها عند الحاجة.'
                  : 'Review booking details, then agree and sign. Terms are collapsed — open them if you need to read.'}
            </p>
            <div className="stay-esign__actions stay-esign__actions--top">
              <button
                type="button"
                className="button button--primary"
                onClick={() => setStep(nextAfter('contract'))}
              >
                {ar ? 'الموافقة والمتابعة للتوقيع' : 'Agree & continue to sign'}
              </button>
            </div>
            {contractDocument ? (
              <div className="stay-esign__document">{contractDocument}</div>
            ) : (
              <div
                className="stay-esign__contract"
                dangerouslySetInnerHTML={{ __html: contractHtml ?? '' }}
              />
            )}
          </section>
        ) : null}

        {step === 'sign' && captureOpen('sign') ? (
          <section className="stay-esign__panel">
            <EsignSignaturePad
              locale={locale}
              onBack={() => setStep(prevBefore('sign'))}
              onAccept={(dataUrl) => {
                setSignatureDataUrl(dataUrl);
                setError(null);
                setStep(nextAfter('sign'));
              }}
            />
          </section>
        ) : null}

        {(step === 'id_front' || step === 'id_back') &&
        captureOpen(step === 'id_front' ? 'id_front' : 'id_back') ? (
          <section className="stay-esign__panel stay-esign__panel--capture">
            <p className="stay-esign__guide">
              {step === 'id_front'
                ? ar
                  ? 'صوّر وجه البطاقة الشخصية بوضوح داخل الإطار — للتحقق من مطابقتها للحجز'
                  : 'Photograph the front of your ID clearly inside the frame — to match it with the booking'
                : ar
                  ? 'صوّر ظهر البطاقة الشخصية بوضوح داخل الإطار'
                  : 'Photograph the back of your ID clearly inside the frame'}
            </p>
            <p className="muted stay-esign__privacy">
              {ar
                ? 'هذه الصور تُستخدم فقط لاستكمال عقد الإقامة وتُعد جزءاً مكمّلاً ومتمّماً له.'
                : 'These photos are used only to complete the stay contract and form an integral part of it.'}
            </p>
            <div className="esign-id-stage">
              <EsignCameraCapture
                locale={locale}
                facingMode="environment"
                frame="id"
                overlay={
                  <OmaniIdFrame
                    side={step === 'id_front' ? 'front' : 'back'}
                    className="esign-id-stage__svg"
                  />
                }
                onError={(message) => setError(message)}
                onCaptured={(dataUrl) => {
                  setError(null);
                  if (step === 'id_front') {
                    setIdFront(dataUrl);
                    setStep(nextAfter('id_front'));
                  } else {
                    setIdBack(dataUrl);
                    setStep(nextAfter('id_back'));
                  }
                }}
              />
            </div>
            <div className="stay-esign__footer-nav">
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setStep(prevBefore(step === 'id_front' ? 'id_front' : 'id_back'))}
              >
                {ar ? 'رجوع' : 'Back'}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'selfie' && captureOpen('selfie') ? (
          <section className="stay-esign__panel stay-esign__panel--capture">
            <p className="stay-esign__guide">
              {ar
                ? 'لحماية حجزك والتحقق من شخصيتك: افتح الكاميرا الأمامية وضع وجهك داخل الإطار — نحتاج صورة مباشرة لمطابقتها مع البطاقة والحجز.'
                : 'To protect your booking and verify it’s you: open the front camera and place your face in the frame — we need a live photo to match your ID and booking.'}
            </p>
            <p className="muted stay-esign__privacy">
              {ar
                ? 'سياسة الموقع تطلب صورة مباشرة لهذا الغرض فقط. الصور تُستخدم لاستكمال عقد الإقامة وتُعد مكمّلة ومتمّمة له، ولا تُستخدم لأي غرض آخر.'
                : 'Site policy requires a live photo for this purpose only. Photos complete the stay contract as an integral part of it, and are not used for anything else.'}
            </p>
            <div className="esign-selfie-stage">
              <EsignCameraCapture
                locale={locale}
                facingMode="user"
                frame="selfie"
                overlay={<SelfiePortraitFrame className="esign-selfie-stage__svg" />}
                onError={(message) => setError(message)}
                onCaptured={(dataUrl) => {
                  setError(null);
                  setSelfie(dataUrl);
                  setStep(nextAfter('selfie'));
                }}
              />
            </div>
            <div className="stay-esign__footer-nav">
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setStep(prevBefore('selfie'))}
              >
                {ar ? 'رجوع' : 'Back'}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'review' ? (
          <section className="stay-esign__panel stay-esign__panel--scroll">
            <p className="muted stay-esign__lede">
              {ar
                ? 'راجع المرفقات قبل إتمام التوقيع الإلكتروني.'
                : 'Review attachments before completing e-sign.'}
            </p>
            <div className="esign-review-grid">
              {reviewCard(
                ar ? 'التوقيع' : 'Signature',
                signatureDataUrl,
                captureOpen('sign'),
                'sign',
              )}
              {reviewCard(
                ar ? 'البطاقة — أمام' : 'ID — front',
                idFront,
                captureOpen('id_front'),
                'id_front',
              )}
              {reviewCard(
                ar ? 'البطاقة — خلف' : 'ID — back',
                idBack,
                captureOpen('id_back'),
                'id_back',
              )}
              {reviewCard(
                ar ? 'الصورة الشخصية' : 'Portrait',
                selfie,
                captureOpen('selfie'),
                'selfie',
              )}
            </div>
          </section>
        ) : null}

        {step === 'done' ? (
          <section className="stay-esign__panel stay-esign__done">
            <div className="stay-esign__seal" role="status">
              <span className="stay-esign__seal-mark" aria-hidden>
                ✓
              </span>
              <div>
                <p className="stay-esign__seal-title">
                  {ar ? 'العقد معتمد إلكترونياً' : 'Contract electronically approved'}
                </p>
                <p className="stay-esign__seal-sub">
                  {ar ? 'من موقع بن حمود للتطوير — BHD R' : 'By Bin Hamood Development — BHD R'}
                </p>
                {signatureSerial ? (
                  <p className="stay-esign__seal-serial">
                    {ar ? 'رقم التوقيع الإلكتروني ' : 'E-signature No. '}
                    <bdi dir="ltr">{signatureSerial}</bdi>
                  </p>
                ) : null}
                {signedAtLabel ? (
                  <p className="muted stay-esign__seal-time" dir="ltr">
                    {signedAtLabel}
                  </p>
                ) : null}
              </div>
            </div>
            {contractDocument ? (
              <div className="stay-esign__document">{contractDocument}</div>
            ) : (
              <div
                className="stay-esign__contract stay-esign__contract--signed"
                dangerouslySetInnerHTML={{ __html: contractHtml ?? '' }}
              />
            )}
            {signatureDataUrl && !contractDocument ? (
              <figure className="stay-esign__signed-figure">
                <figcaption>{ar ? 'توقيعك' : 'Your signature'}</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={signatureDataUrl} alt="" />
              </figure>
            ) : null}
          </section>
        ) : null}
      </div>

      {step === 'review' ? (
        <footer className="stay-esign__dock">
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setStep(prevBefore('review'))}
          >
            {ar ? 'رجوع' : 'Back'}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void submitEsign()}
          >
            {busy
              ? ar
                ? 'جارٍ الإرسال…'
                : 'Submitting…'
              : ar
                ? 'إتمام التوقيع الإلكتروني'
                : 'Complete e-signature'}
          </button>
        </footer>
      ) : null}

      {step === 'done' ? (
        <footer className="stay-esign__dock stay-esign__dock--done">
          <button type="button" className="button button--primary" onClick={goToConfirmed}>
            {ar ? 'متابعة إلى تفاصيل الحجز' : 'Continue to booking details'}
          </button>
        </footer>
      ) : null}

      {error ? (
        <p className="field__error stay-esign__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
