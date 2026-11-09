'use client';

import { useState } from 'react';
import { ModalPortal } from '@/components/modal-portal';
import { EsignCameraCapture } from '@/components/stays/esign/esign-camera-capture';

/**
 * Full-screen selfie desk: open camera / gallery, then Send now or Retake.
 */
export function SelfieCaptureDialog({
  locale,
  title,
  busy = false,
  error = null,
  onClose,
  onSend,
}: {
  locale: 'ar' | 'en';
  title: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSend: (dataUrl: string) => void | Promise<void>;
}) {
  const ar = locale === 'ar';
  const [shot, setShot] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  function requestClose() {
    if (busy) return;
    onClose();
  }

  return (
    <ModalPortal onClose={requestClose}>
      <div
        className="selfie-capture"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        dir={ar ? 'rtl' : 'ltr'}
        onClick={(event) => {
          if (event.target === event.currentTarget) requestClose();
        }}
      >
        <div className="selfie-capture__panel">
          <header className="selfie-capture__bar">
            <strong>{title}</strong>
            <button
              type="button"
              className="selfie-capture__ghost"
              disabled={busy}
              onClick={requestClose}
            >
              {ar ? 'إغلاق' : 'Close'}
            </button>
          </header>

          {shot ? (
            <div className="selfie-capture__review">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot} alt={ar ? 'صورتك' : 'Your selfie'} />
              <div className="selfie-capture__actions">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => void onSend(shot)}
                >
                  {busy ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : ar ? 'أرسل الآن' : 'Send now'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={busy}
                  onClick={() => {
                    setCamError(null);
                    setShot(null);
                  }}
                >
                  {ar ? 'أعد التقاط الصورة' : 'Retake photo'}
                </button>
              </div>
            </div>
          ) : (
            <div className="selfie-capture__cam">
              <p className="muted selfie-capture__hint">
                {ar
                  ? 'افتح الكاميرا أو اختر من المعرض، ثم التقط صورة سيلفي واضحة لوجهك.'
                  : 'Open the camera or pick from the gallery, then take a clear selfie of your face.'}
              </p>
              <EsignCameraCapture
                locale={locale}
                facingMode="user"
                frame="selfie"
                onCaptured={setShot}
                onError={() =>
                  setCamError(
                    ar
                      ? 'تعذّر تشغيل الكاميرا؛ اسمح بالوصول إليها أو اختر صورة من المعرض.'
                      : 'The camera could not start; allow access or pick a photo from the gallery.',
                  )
                }
              />
            </div>
          )}

          {camError || error ? (
            <p className="notice notice--error" role="alert">
              {error ?? camError}
            </p>
          ) : null}
        </div>
      </div>
    </ModalPortal>
  );
}
