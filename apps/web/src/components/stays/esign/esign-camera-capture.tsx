'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export type CaptureFrame = 'id' | 'selfie';

type Props = {
  locale: string;
  facingMode: 'user' | 'environment';
  frame: CaptureFrame;
  onCaptured: (dataUrl: string) => void;
  onError?: (message: string) => void;
  overlay?: ReactNode;
};

/** Cover-crop video/image into target aspect, return JPEG data URL. */
function cropToAspect(
  source: HTMLVideoElement | HTMLImageElement,
  aspectW: number,
  aspectH: number,
  maxEdge = 1280,
  mirror = false,
): string {
  const sw =
    'videoWidth' in source ? source.videoWidth || source.clientWidth : source.naturalWidth;
  const sh =
    'videoHeight' in source ? source.videoHeight || source.clientHeight : source.naturalHeight;
  if (!sw || !sh) throw new Error('capture_empty');

  const targetRatio = aspectW / aspectH;
  const sourceRatio = sw / sh;
  let sx = 0;
  let sy = 0;
  let cw = sw;
  let ch = sh;
  if (sourceRatio > targetRatio) {
    cw = sh * targetRatio;
    sx = (sw - cw) / 2;
  } else {
    ch = sw / targetRatio;
    sy = (sh - ch) / 2;
  }

  const outW = aspectW >= aspectH ? maxEdge : Math.round(maxEdge * (aspectW / aspectH));
  const outH = aspectW >= aspectH ? Math.round(maxEdge * (aspectH / aspectW)) : maxEdge;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_failed');
  if (mirror) {
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, sx, sy, cw, ch, 0, 0, outW, outH);
  return canvas.toDataURL('image/jpeg', 0.86);
}

export function EsignCameraCapture({
  locale,
  facingMode,
  frame,
  onCaptured,
  onError,
  overlay,
}: Props) {
  const ar = locale === 'ar';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      stopStream();
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraDenied(true);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setReady(true);
        setCameraDenied(false);
      } catch {
        if (!cancelled) {
          setCameraDenied(true);
          onErrorRef.current?.(
            ar ? 'تعذّر فتح الكاميرا — يمكنك الرفع من المعرض' : 'Camera unavailable — use gallery',
          );
        }
      }
    }
    void start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facingMode, ar, stopStream]);

  async function captureFromCamera() {
    const video = videoRef.current;
    if (!video || !ready) return;
    setBusy(true);
    try {
      const aspect = frame === 'selfie' ? ([3, 4] as const) : ([856, 540] as const);
      const dataUrl = cropToAspect(video, aspect[0], aspect[1], 1280, facingMode === 'user');
      onCaptured(dataUrl);
    } catch (caught) {
      onError?.(caught instanceof Error ? caught.message : 'capture_failed');
    } finally {
      setBusy(false);
    }
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 3_500_000) {
      onError?.(ar ? 'حجم الصورة كبير جداً (حد أقصى ~3.5MB)' : 'Image too large (max ~3.5MB)');
      return;
    }
    setBusy(true);
    try {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('read_failed'));
        img.src = objectUrl;
      });
      const aspect = frame === 'selfie' ? ([3, 4] as const) : ([856, 540] as const);
      const dataUrl = cropToAspect(img, aspect[0], aspect[1], 1280, false);
      URL.revokeObjectURL(objectUrl);
      onCaptured(dataUrl);
    } catch (caught) {
      onError?.(caught instanceof Error ? caught.message : 'upload_failed');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  return (
    <div className="esign-cam">
      <div className={`esign-cam__stage esign-cam__stage--${frame}`}>
        <video
          ref={videoRef}
          className="esign-cam__video"
          playsInline
          muted
          autoPlay
          // Mirror selfie for natural UX
          style={facingMode === 'user' ? { transform: 'scaleX(-1)' } : undefined}
        />
        {overlay ? <div className="esign-cam__overlay">{overlay}</div> : null}
        {!ready && !cameraDenied ? (
          <p className="esign-cam__hint">{ar ? 'جارٍ فتح الكاميرا…' : 'Opening camera…'}</p>
        ) : null}
        {cameraDenied ? (
          <p className="esign-cam__hint">
            {ar ? 'الكاميرا غير متاحة — استخدم المعرض' : 'Camera unavailable — use gallery'}
          </p>
        ) : null}
      </div>
      <div className="esign-cam__actions">
        {!cameraDenied ? (
          <button
            type="button"
            className="button button--primary esign-cam__shutter"
            disabled={!ready || busy}
            onClick={() => void captureFromCamera()}
          >
            {busy ? (ar ? 'جارٍ…' : 'Working…') : ar ? 'التقاط' : 'Capture'}
          </button>
        ) : null}
        <button
          type="button"
          className="button button--quiet"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {ar ? 'من المعرض' : 'Gallery'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture={facingMode === 'user' ? 'user' : 'environment'}
          className="esign-cam__file"
          onChange={(e) => void onFileChange(e)}
        />
      </div>
    </div>
  );
}
