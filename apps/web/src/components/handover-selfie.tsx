'use client';

import { useState } from 'react';
import { SelfieCaptureDialog } from '@/components/selfie-capture-dialog';
import { compressPhoto } from '@/components/stays/stay-handover-form';
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(dataUrl: string) {
    setBusy(true);
    setError(null);
    try {
      const data = await compressPhoto(fileFromDataUrl(dataUrl), HANDOVER_PHOTO_MAX);
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
      setOpen(false);
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
            ? 'سجّل ممثل المالك محضر التسليم من جهته. التقط صورة لوجهك بكاميرا هاتفك الأمامية الآن — إلزامية قبل ظهور محضر التسليم واعتبار العقار مسلَّماً؛ تُرفق كإثبات لاستلامك المفتاح.'
            : 'The owner’s representative filed their side of the handover. Take a photo of your face with your front camera now — required before the handover report appears and the premises count as handed over; it joins the record as proof you received the key.'
          : ar
            ? `مسح ${scannedBy ?? 'ممثل المالك'} رمزك. التقط صورة لوجهك بكاميرا هاتفك الأمامية لتظهر له فوراً ويطابقها معك، وتُرفق بمحضر التسليم. في الوقت نفسه يلتقط ممثل المالك صورة سيلفي لنفسه، فيُوثَّق التسليم بوجه المستلم والمسلِّم معاً.`
            : `${scannedBy ?? 'The owner’s representative'} scanned your code. Take a photo of your face with your front camera; it shows on their screen at once and joins the handover record. At the same time the representative takes a selfie of themselves, so the record carries both faces.`}
      </p>
      <div className="handover-selfie__launch">
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            setError(null);
            setBusy(false);
            setOpen(true);
          }}
        >
          {ar ? 'التقاط / رفع صورة سيلفي' : 'Take / upload selfie'}
        </button>
      </div>
      {error && !open ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {open ? (
        <SelfieCaptureDialog
          locale={locale}
          title={ar ? 'صورة سيلفي للتسليم' : 'Handover selfie'}
          busy={busy}
          error={error}
          onClose={() => {
            if (busy) return;
            setOpen(false);
            setError(null);
          }}
          onSend={send}
        />
      ) : null}
    </section>
  );
}
