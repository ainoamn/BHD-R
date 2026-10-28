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
  const sw = 'videoWidth' in source ? source.videoWidth || source.clientWidth : source.naturalWidth;
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

function isCoarsePointerMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse), (max-width: 899px)').matches;
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
  const cameraFileRef = useRef<HTMLInputElement | null>(null);
  const galleryFileRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [liveUnavailable, setLiveUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  const openNativeCamera = useCallback(() => {
    cameraFileRef.current?.click();
  }, []);

  const openGallery = useCallback(() => {
    galleryFileRef.current?.click();
  }, []);

  const startLiveCamera = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setLiveUnavailable(true);
      return false;
    }
    setStarting(true);
    setLiveUnavailable(false);
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setReady(true);
      setLiveUnavailable(false);
      return true;
    } catch {
      setLiveUnavailable(true);
      setReady(false);
      return false;
    } finally {
      setStarting(false);
    }
  }, [facingMode, stopStream]);

  /** User-gesture entry: try live preview, else open the device camera app. */
  async function openCamera() {
    setBusy(true);
    try {
      const ok = await startLiveCamera();
      if (!ok) {
        openNativeCamera();
        onErrorRef.current?.(
          ar
            ? 'افتح كاميرا الجهاز والتقط صورة البطاقة، أو اختر من المعرض.'
            : 'Open the device camera to capture the ID, or pick from the gallery.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

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
      stopStream();
      onCaptured(dataUrl);
    } catch (caught) {
      onError?.(caught instanceof Error ? caught.message : 'upload_failed');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  const preferNativeFirst = frame === 'id' && isCoarsePointerMobile();

  return (
    <div className="esign-cam">
      <div className={`esign-cam__stage esign-cam__stage--${frame}`}>
        <video
          ref={videoRef}
          className="esign-cam__video"
          playsInline
          muted
          autoPlay
          style={facingMode === 'user' ? { transform: 'scaleX(-1)' } : undefined}
        />
        {overlay && ready ? <div className="esign-cam__overlay">{overlay}</div> : null}
        {!ready ? (
          <div className="esign-cam__gate">
            <p className="esign-cam__hint">
              {starting
                ? ar
                  ? 'جارٍ فتح الكاميرا…'
                  : 'Opening camera…'
                : frame === 'id'
                  ? ar
                    ? 'افتح الكاميرا لتصوير البطاقة، أو اختر صورة من المعرض'
                    : 'Open the camera to photograph the ID, or pick from the gallery'
                  : ar
                    ? 'افتح الكاميرا لالتقاط صورة مباشرة لوجهك داخل الإطار، أو اختر من المعرض'
                    : 'Open the camera for a live photo of your face in the frame, or pick from the gallery'}
            </p>
          </div>
        ) : null}
      </div>

      <div className="esign-cam__actions">
        {ready ? (
          <button
            type="button"
            className="button button--primary esign-cam__shutter"
            disabled={busy}
            onClick={() => void captureFromCamera()}
          >
            {busy ? (ar ? 'جارٍ…' : 'Working…') : ar ? 'التقاط' : 'Capture'}
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary esign-cam__shutter"
            disabled={busy || starting}
            onClick={() => {
              if (preferNativeFirst) {
                openNativeCamera();
                return;
              }
              void openCamera();
            }}
          >
            {starting ? (ar ? 'جارٍ الفتح…' : 'Opening…') : ar ? 'افتح الكاميرا' : 'Open camera'}
          </button>
        )}
        {!ready && !preferNativeFirst ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy || starting}
            onClick={openNativeCamera}
          >
            {ar ? 'كاميرا الجهاز' : 'Device camera'}
          </button>
        ) : null}
        {ready && liveUnavailable === false ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => {
              stopStream();
              openNativeCamera();
            }}
          >
            {ar ? 'كاميرا الجهاز' : 'Device camera'}
          </button>
        ) : null}
        <button
          type="button"
          className="button button--quiet"
          disabled={busy || starting}
          onClick={openGallery}
        >
          {ar ? 'من المعرض' : 'Gallery'}
        </button>
      </div>

      {/* Native camera app — separate from gallery so capture= does not block album pick. */}
      <input
        ref={cameraFileRef}
        type="file"
        accept="image/*"
        capture={facingMode === 'user' ? 'user' : 'environment'}
        className="esign-cam__file"
        onChange={(e) => void onFileChange(e)}
      />
      <input
        ref={galleryFileRef}
        type="file"
        accept="image/*"
        className="esign-cam__file"
        onChange={(e) => void onFileChange(e)}
      />
    </div>
  );
}
