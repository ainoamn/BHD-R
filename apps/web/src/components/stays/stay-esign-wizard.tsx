'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { stayConfirmedReturnPath } from '@/lib/stay-esign-flags';
import { EsignCameraCapture } from '@/components/stays/esign/esign-camera-capture';
import { EsignSignaturePad } from '@/components/stays/esign/esign-signature-pad';
import { OmaniIdFrame, SelfiePortraitFrame } from '@/components/stays/esign/omani-id-frame';

type Step = 'contract' | 'sign' | 'id_front' | 'id_back' | 'selfie' | 'review' | 'done';

const STEP_ORDER: Step[] = ['contract', 'sign', 'id_front', 'id_back', 'selfie', 'review', 'done'];

export function StayEsignWizard({
  locale,
  referenceCode,
  contractHtml,
  initiallyComplete = false,
}: {
  locale: string;
  referenceCode: string;
  contractHtml: string;
  initiallyComplete?: boolean;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [step, setStep] = useState<Step>(initiallyComplete ? 'done' : 'contract');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [idFront, setIdFront] = useState<string | null>(null);
  const [idBack, setIdBack] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [signedAtLabel, setSignedAtLabel] = useState<string | null>(null);

  const goToConfirmed = useCallback(() => {
    router.push(stayConfirmedReturnPath(locale, referenceCode));
  }, [locale, referenceCode, router]);

  const progressIndex = useMemo(() => {
    const idx = STEP_ORDER.indexOf(step);
    return idx < 0 ? 0 : Math.min(idx, STEP_ORDER.length - 2);
  }, [step]);

  const progressTotal = STEP_ORDER.length - 1; // exclude done from "active" bar scale
  const progressPct = Math.round(((progressIndex + 1) / progressTotal) * 100);

  const stepTitle = useMemo(() => {
    switch (step) {
      case 'contract':
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
  }, [ar, step]);

  async function submitEsign() {
    if (!signatureDataUrl || !idFront || !idBack || !selfie) {
      setError(ar ? 'أكمل التوقيع وصور الهوية والسيلفي' : 'Complete signature and all photos');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/public/stays/bookings/${encodeURIComponent(referenceCode)}/esign`,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-requested-with': 'BHD-R',
          },
          body: JSON.stringify({
            signaturePng: signatureDataUrl,
            idFrontPng: idFront,
            idBackPng: idBack,
            selfiePng: selfie,
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'esign_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stay-esign stay-esign--fullscreen" data-step={step}>
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
            <p className="muted stay-esign__lede">
              {ar
                ? 'راجع شروط الإقامة وبيانات الحجز، ثم وافق ووقّع إلكترونياً.'
                : 'Review stay terms and booking details, then agree and sign electronically.'}
            </p>
            <div
              className="stay-esign__contract"
              dangerouslySetInnerHTML={{ __html: contractHtml }}
            />
          </section>
        ) : null}

        {step === 'sign' ? (
          <section className="stay-esign__panel">
            <EsignSignaturePad
              locale={locale}
              onBack={() => setStep('contract')}
              onAccept={(dataUrl) => {
                setSignatureDataUrl(dataUrl);
                setError(null);
                setStep('id_front');
              }}
            />
          </section>
        ) : null}

        {step === 'id_front' || step === 'id_back' ? (
          <section className="stay-esign__panel stay-esign__panel--capture">
            <p className="stay-esign__guide">
              {step === 'id_front'
                ? ar
                  ? 'حاذِ وجه البطاقة الشخصية داخل الإطار ثم التقط الصورة'
                  : 'Align the ID front inside the frame, then capture'
                : ar
                  ? 'حاذِ ظهر البطاقة الشخصية داخل الإطار ثم التقط الصورة'
                  : 'Align the ID back inside the frame, then capture'}
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
                    setStep('id_back');
                  } else {
                    setIdBack(dataUrl);
                    setStep('selfie');
                  }
                }}
              />
            </div>
            <div className="stay-esign__footer-nav">
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setStep(step === 'id_front' ? 'sign' : 'id_front')}
              >
                {ar ? 'رجوع' : 'Back'}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'selfie' ? (
          <section className="stay-esign__panel stay-esign__panel--capture">
            <p className="stay-esign__guide">
              {ar
                ? 'افتح الكاميرا الأمامية وضع وجهك داخل الإطار الطولي'
                : 'Use the front camera and place your face inside the portrait frame'}
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
                  setStep('review');
                }}
              />
            </div>
            <div className="stay-esign__footer-nav">
              <button type="button" className="button button--quiet" onClick={() => setStep('id_back')}>
                {ar ? 'رجوع' : 'Back'}
              </button>
            </div>
          </section>
        ) : null}

        {step === 'review' ? (
          <section className="stay-esign__panel stay-esign__panel--scroll">
            <p className="muted stay-esign__lede">
              {ar ? 'راجع المرفقات قبل إتمام التوقيع الإلكتروني.' : 'Review attachments before completing e-sign.'}
            </p>
            <div className="esign-review-grid">
              {signatureDataUrl ? (
                <figure className="esign-review-card">
                  <figcaption>{ar ? 'التوقيع' : 'Signature'}</figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={signatureDataUrl} alt="" />
                  <button type="button" className="button button--quiet" onClick={() => setStep('sign')}>
                    {ar ? 'تعديل' : 'Edit'}
                  </button>
                </figure>
              ) : null}
              {idFront ? (
                <figure className="esign-review-card">
                  <figcaption>{ar ? 'البطاقة — أمام' : 'ID — front'}</figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={idFront} alt="" />
                  <button type="button" className="button button--quiet" onClick={() => setStep('id_front')}>
                    {ar ? 'تعديل' : 'Edit'}
                  </button>
                </figure>
              ) : null}
              {idBack ? (
                <figure className="esign-review-card">
                  <figcaption>{ar ? 'البطاقة — خلف' : 'ID — back'}</figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={idBack} alt="" />
                  <button type="button" className="button button--quiet" onClick={() => setStep('id_back')}>
                    {ar ? 'تعديل' : 'Edit'}
                  </button>
                </figure>
              ) : null}
              {selfie ? (
                <figure className="esign-review-card esign-review-card--portrait">
                  <figcaption>{ar ? 'الصورة الشخصية' : 'Portrait'}</figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={selfie} alt="" />
                  <button type="button" className="button button--quiet" onClick={() => setStep('selfie')}>
                    {ar ? 'تعديل' : 'Edit'}
                  </button>
                </figure>
              ) : null}
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
                  {ar
                    ? 'من موقع بن حمود للتطوير — BHD R'
                    : 'By Bin Hamood Development — BHD R'}
                </p>
                {signedAtLabel ? (
                  <p className="muted stay-esign__seal-time" dir="ltr">
                    {signedAtLabel}
                  </p>
                ) : null}
              </div>
            </div>
            <div
              className="stay-esign__contract stay-esign__contract--signed"
              dangerouslySetInnerHTML={{ __html: contractHtml }}
            />
            {signatureDataUrl ? (
              <figure className="stay-esign__signed-figure">
                <figcaption>{ar ? 'توقيعك' : 'Your signature'}</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={signatureDataUrl} alt="" />
              </figure>
            ) : null}
          </section>
        ) : null}
      </div>

      {step === 'contract' ? (
        <footer className="stay-esign__dock">
          <button type="button" className="button button--primary" onClick={() => setStep('sign')}>
            {ar ? 'الموافقة والمتابعة للتوقيع' : 'Agree & continue to sign'}
          </button>
        </footer>
      ) : null}

      {step === 'review' ? (
        <footer className="stay-esign__dock">
          <button type="button" className="button button--quiet" onClick={() => setStep('selfie')}>
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
        <footer className="stay-esign__dock">
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
