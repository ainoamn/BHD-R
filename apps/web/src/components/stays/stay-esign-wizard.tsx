'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 'contract' | 'sign' | 'id_front' | 'id_back' | 'selfie' | 'done';

export function StayEsignWizard({
  locale,
  referenceCode,
  contractHtml,
}: {
  locale: string;
  referenceCode: string;
  contractHtml: string;
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [step, setStep] = useState<Step>('contract');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [idFront, setIdFront] = useState<string | null>(null);
  const [idBack, setIdBack] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#f4efe6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.min(420, window.innerWidth - 48);
    canvas.width = width * ratio;
    canvas.height = 180 * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = '180px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#102820';
    clearCanvas();
  }, [modalOpen, clearCanvas]);

  function pointerPos(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointerPos(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointerPos(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function onPointerUp() {
    drawing.current = false;
  }

  function acceptSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSignatureDataUrl(canvas.toDataURL('image/png'));
    setModalOpen(false);
    setStep('id_front');
  }

  async function readFileAsDataUrl(file: File): Promise<string> {
    if (file.size > 3_500_000) {
      throw new Error(ar ? 'حجم الصورة كبير جداً (حد أقصى ~3.5MB)' : 'Image too large (max ~3.5MB)');
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('read_failed'));
      reader.readAsDataURL(file);
    });
  }

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
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error?.messageAr ?? payload?.error?.message ?? 'esign_failed');
      }
      setStep('done');
      router.push(`/${locale}/stays/booking/confirmed?ref=${encodeURIComponent(referenceCode)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'esign_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stay-esign">
      {step === 'contract' ? (
        <section className="stay-esign__panel">
          <h1>{ar ? 'عقد الإقامة والتوقيع الإلكتروني' : 'Stay contract & e-signature'}</h1>
          <p className="muted">
            {ar
              ? 'راجع شروط الإقامة وبيانات الحجز، ثم وقّع إلكترونياً وارفع صور الهوية والسيلفي.'
              : 'Review stay terms and booking details, then sign and upload ID photos + selfie.'}
          </p>
          <div
            className="stay-esign__contract"
            dangerouslySetInnerHTML={{ __html: contractHtml }}
          />
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              setModalOpen(true);
              setStep('sign');
            }}
          >
            {ar ? 'الموافقة وتوقيع العقد' : 'Agree & sign contract'}
          </button>
        </section>
      ) : null}

      {step === 'id_front' || step === 'id_back' || step === 'selfie' ? (
        <section className="stay-esign__panel">
          <h2>
            {step === 'id_front'
              ? ar
                ? 'صورة البطاقة من الأمام'
                : 'ID card — front'
              : step === 'id_back'
                ? ar
                  ? 'صورة البطاقة من الخلف'
                  : 'ID card — back'
                : ar
                  ? 'صورة سيلفي'
                  : 'Selfie'}
          </h2>
          <input
            type="file"
            accept="image/*"
            capture={step === 'selfie' ? 'user' : 'environment'}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void (async () => {
                try {
                  const data = await readFileAsDataUrl(file);
                  if (step === 'id_front') {
                    setIdFront(data);
                    setStep('id_back');
                  } else if (step === 'id_back') {
                    setIdBack(data);
                    setStep('selfie');
                  } else {
                    setSelfie(data);
                  }
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : 'upload_failed');
                }
              })();
            }}
          />
          {step === 'selfie' && selfie ? (
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
          ) : null}
        </section>
      ) : null}

      {modalOpen ? (
        <div className="stay-esign__modal" role="dialog" aria-modal="true">
          <div className="stay-esign__modal-card">
            <header>
              <h3>{ar ? 'الموافقة وتوقيع العقد' : 'Agree & sign'}</h3>
              <button type="button" className="button button--quiet" onClick={() => setModalOpen(false)}>
                ×
              </button>
            </header>
            <p className="muted">{ar ? 'أضف توقيعك' : 'Add your signature'}</p>
            <canvas
              ref={canvasRef}
              className="stay-esign__pad"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            <div className="stay-esign__modal-actions">
              <button type="button" className="button button--quiet" onClick={clearCanvas}>
                {ar ? 'مسح' : 'Clear'}
              </button>
              <button type="button" className="button button--primary" onClick={acceptSignature}>
                {ar ? 'موافقة' : 'Agree'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
