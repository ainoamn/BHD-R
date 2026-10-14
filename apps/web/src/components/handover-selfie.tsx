'use client';

import { useState } from 'react';
import { compressPhoto } from '@/components/stays/stay-handover-form';
import { EsignCameraCapture } from '@/components/stays/esign/esign-camera-capture';
import { ApiError, browserNextMutation } from '@/lib/api';
import { HANDOVER_PHOTO_MAX } from '@/lib/stay-handover';

export function fileFromDataUrl(dataUrl: string): File {
  const [head, body = ''] = dataUrl.split(',');
  const type = /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'image/jpeg';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], 'selfie.jpg', { type });
}

/**
 * The tenant's selfie at the door, from the front camera of their own phone. It replaces the
 * photo the owner's representative used to take, and becomes part of the handover record.
 */
export function HandoverSelfieCard({
  locale,
  referenceCode,
  scannedBy,
  owed,
  onSent,
}: {
  locale: 'ar' | 'en';
  referenceCode: string;
  scannedBy: string | null;
  /** The record is already waiting for the tenant; the selfie is the step before accepting. */
  owed?: boolean;
  onSent: () => void;
}) {
  const ar = locale === 'ar';
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!shot) return;
    setBusy(true);
    setError(null);
    try {
      const data = await compressPhoto(fileFromDataUrl(shot), HANDOVER_PHOTO_MAX);
      await browserNextMutation(
        `/api/public/bookings/deposits/${encodeURIComponent(referenceCode)}/handover`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'selfie',
            photo: { data, takenAt: new Date().toISOString(), source: 'camera' },
          }),
        },
      );
      onSent();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.message && caught.code !== 'api_error'
          ? caught.message
          : ar
            ? 'تعذّر إرسال الصورة، أعد المحاولة.'
            : 'The photo could not be sent; try again.',
      );
      setBusy(false);
    }
  }

  return (
    <section
      className="guest-stay-detail__card handover-selfie"
      aria-labelledby="handover-selfie-title"
    >
      <h2 id="handover-selfie-title">{ar ? 'التقط صورة سيلفي لنفسك الآن' : 'Take a selfie now'}</h2>
      <p>
        {owed
          ? ar
            ? 'قبل أن توافق على استلام العقار التقط صورة لوجهك بكاميرا هاتفك الأمامية؛ تُرفق بمحضر التسليم كإثبات لاستلامك المفتاح.'
            : 'Before accepting the premises, take a photo of your face with your front camera; it joins the handover record as proof you received the key.'
          : ar
            ? `مسح ${scannedBy ?? 'ممثل المالك'} رمزك. التقط صورة لوجهك بكاميرا هاتفك الأمامية لتظهر له فوراً ويطابقها معك، وتُرفق بمحضر التسليم. في الوقت نفسه يلتقط ممثل المالك صورة سيلفي لنفسه، فيُوثَّق التسليم بوجه المستلم والمسلِّم معاً.`
            : `${scannedBy ?? 'The owner’s representative'} scanned your code. Take a photo of your face with your front camera; it shows on their screen at once and joins the handover record. At the same time the representative takes a selfie of themselves, so the record carries both faces.`}
      </p>
      {shot ? (
        <div className="handover-selfie__review">
          <img src={shot} alt={ar ? 'صورتك' : 'Your selfie'} />
          <div className="handover-selfie__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void send()}
            >
              {busy ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : ar ? 'إرسال الصورة' : 'Send photo'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => setShot(null)}
            >
              {ar ? 'إعادة الالتقاط' : 'Retake'}
            </button>
          </div>
        </div>
      ) : (
        <EsignCameraCapture
          locale={locale}
          facingMode="user"
          frame="selfie"
          onCaptured={setShot}
          onError={() =>
            setError(
              ar
                ? 'تعذّر تشغيل الكاميرا؛ اسمح بالوصول إليها أو التقط الصورة من زر الرفع.'
                : 'The camera could not start; allow access or use the upload button.',
            )
          }
        />
      )}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
