'use client';

import { useRef, useState } from 'react';
import { fileFromDataUrl } from '@/components/handover-selfie';
import { compressPhoto } from '@/components/stays/stay-handover-form';
import { EsignCameraCapture } from '@/components/stays/esign/esign-camera-capture';
import { ApiError, browserNextMutation } from '@/lib/api';
import { HANDOVER_PHOTO_MAX } from '@/lib/stay-handover';
import {
  REQUEST_VIDEO_MAX_BYTES,
  closureProofMissing,
  requestMediaStageLabel,
  tenantRequestErrorText,
  type RequestMedia,
  type RequestMediaStage,
} from '@/lib/tenant-requests-shared';

function mediaHref(requestId: string, mediaId: string): string {
  return `/api/tenant/requests/${encodeURIComponent(requestId)}/media/${encodeURIComponent(mediaId)}`;
}

/** Sends one photo (shrunk first) or short video to a request; throws a request error code. */
export async function uploadRequestMedia(
  requestId: string,
  stage: RequestMediaStage,
  file: File,
): Promise<void> {
  let body: Blob = file;
  if (file.type.startsWith('image/')) {
    body = fileFromDataUrl(await compressPhoto(file, HANDOVER_PHOTO_MAX));
  } else if (!file.type.startsWith('video/') || file.size > REQUEST_VIDEO_MAX_BYTES) {
    throw new ApiError(400, 'tenant_request_media', '');
  }
  await browserNextMutation(
    `/api/tenant/requests/${encodeURIComponent(requestId)}/media?stage=${stage}`,
    {
      method: 'POST',
      body,
      headers: { 'content-type': body.type || 'application/octet-stream' },
      signal: AbortSignal.timeout(120_000),
    },
  );
}

/** Photos and videos on a request, grouped by who added them and when. */
export function RequestMediaGallery({
  requestId,
  media,
  ar,
}: {
  requestId: string;
  media: readonly RequestMedia[];
  ar: boolean;
}) {
  if (!media.length) return null;
  return (
    <div className="request-media">
      {media.map((item) => {
        const href = mediaHref(requestId, item.id);
        return (
          <figure
            key={item.id}
            className={`request-media__item request-media__item--${item.stage}`}
          >
            {item.kind === 'video' ? (
              <video src={href} controls preload="metadata" playsInline />
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                <img src={href} alt={requestMediaStageLabel(item.stage, ar)} loading="lazy" />
              </a>
            )}
            <figcaption>
              <b>{requestMediaStageLabel(item.stage, ar)}</b>
              {item.name ? <span>{item.name}</span> : null}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/** A button that picks (or shoots) a photo or video and adds it to the request at once. */
export function RequestMediaButton({
  requestId,
  stage,
  ar,
  label,
  accept,
  capture,
  onAdded,
  className = 'button button--quiet button--tiny',
}: {
  requestId: string;
  stage: RequestMediaStage;
  ar: boolean;
  label: string;
  accept: string;
  capture?: 'user' | 'environment';
  onAdded: () => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadRequestMedia(requestId, stage, file);
      onAdded();
    } catch (caught) {
      setError(tenantRequestErrorText(caught instanceof ApiError ? caught.code : null, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="request-media__pick">
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (ar ? 'جارٍ الرفع…' : 'Uploading…') : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        {...(capture ? { capture } : {})}
        hidden
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {error ? (
        <small className="notice notice--error" role="alert">
          {error}
        </small>
      ) : null}
    </span>
  );
}

/**
 * The maintenance team's side of a request: photos or videos while working, then the two things
 * required before it can be closed — a photo of the fixed problem and a live selfie of the person
 * who fixed it.
 */
export function ClosureProofPanel({
  requestId,
  media,
  locale,
  onAdded,
}: {
  requestId: string;
  media: readonly RequestMedia[];
  locale: 'ar' | 'en';
  onAdded: () => void;
}) {
  const ar = locale === 'ar';
  const missing = closureProofMissing(media);
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendSelfie() {
    if (!shot) return;
    setBusy(true);
    setError(null);
    try {
      await uploadRequestMedia(requestId, 'selfie', fileFromDataUrl(shot));
      setShot(null);
      setSelfieOpen(false);
      onAdded();
    } catch (caught) {
      setError(tenantRequestErrorText(caught instanceof ApiError ? caught.code : null, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="closure-proof">
      <legend>
        {ar ? 'فريق الصيانة: التوثيق وإثبات الإنجاز' : 'Maintenance team: evidence and proof'}
      </legend>
      <p className="muted">
        {ar
          ? 'أرفق صوراً أو فيديو أثناء العمل متى شئت. وقبل إغلاق البلاغ يلزم إرفاق صورة تُثبت أن المشكلة حُلّت، وصورة سيلفي حيّة لمن أنجز العمل؛ يراهما المستأجر مع إشعار الإنجاز.'
          : 'Add photos or video while working. Before closing, attach a photo proving the fix and a live selfie of whoever did the work; the tenant sees both with the completion notice.'}
      </p>
      <ul className="closure-proof__checks">
        <li className={missing.includes('after') ? '' : 'closure-proof__done'}>
          {missing.includes('after') ? '◻️' : '✅'}{' '}
          {ar ? 'صورة بعد الإصلاح' : 'Photo after the fix'}
        </li>
        <li className={missing.includes('selfie') ? '' : 'closure-proof__done'}>
          {missing.includes('selfie') ? '◻️' : '✅'}{' '}
          {ar ? 'سيلفي من أنجز العمل' : 'Selfie of who fixed it'}
        </li>
      </ul>
      <div className="tenant-request__buttons">
        <RequestMediaButton
          requestId={requestId}
          stage="work"
          ar={ar}
          label={ar ? '📎 صورة أو فيديو أثناء العمل' : '📎 Photo or video while working'}
          accept="image/*,video/mp4,video/quicktime,video/webm"
          onAdded={onAdded}
        />
        <RequestMediaButton
          requestId={requestId}
          stage="after"
          ar={ar}
          label={ar ? '📷 صورة بعد الإصلاح' : '📷 Photo after the fix'}
          accept="image/*"
          capture="environment"
          onAdded={onAdded}
          className={`button button--tiny ${missing.includes('after') ? 'button--primary' : 'button--quiet'}`}
        />
        <button
          type="button"
          className={`button button--tiny ${missing.includes('selfie') ? 'button--primary' : 'button--quiet'}`}
          onClick={() => setSelfieOpen((open) => !open)}
        >
          {ar ? '🤳 سيلفي من أنجز العمل' : '🤳 Selfie of who fixed it'}
        </button>
      </div>
      {selfieOpen ? (
        <div className="closure-proof__selfie">
          {shot ? (
            <div className="handover-selfie__review">
              <img src={shot} alt={ar ? 'السيلفي' : 'Selfie'} />
              <div className="handover-selfie__actions">
                <button
                  type="button"
                  className="button button--primary button--tiny"
                  disabled={busy}
                  onClick={() => void sendSelfie()}
                >
                  {busy
                    ? ar
                      ? 'جارٍ الإرسال…'
                      : 'Sending…'
                    : ar
                      ? 'إرفاق السيلفي'
                      : 'Attach selfie'}
                </button>
                <button
                  type="button"
                  className="button button--quiet button--tiny"
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
                    ? 'تعذّر تشغيل الكاميرا الأمامية؛ اسمح بالوصول إليها ثم أعد المحاولة.'
                    : 'The front camera could not start; allow access and try again.',
                )
              }
            />
          )}
        </div>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
