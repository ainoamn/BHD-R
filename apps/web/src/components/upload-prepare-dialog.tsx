'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ModalPortal } from '@/components/modal-portal';

type Props = {
  file: File;
  ar: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: (file: File) => void;
};

/**
 * Before upload: preview PDF/image; for images allow brightness/contrast and a simple crop.
 */
export function UploadPrepareDialog({ file, ar, title, onCancel, onConfirm }: Props) {
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drag = useRef<{
    mode: 'new' | 'move';
    startX: number;
    startY: number;
    origin: { x: number; y: number; w: number; h: number } | null;
  } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pointInStage(clientX: number, clientY: number) {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return { x, y };
  }

  function onPointerDown(event: ReactPointerEvent) {
    if (!isImage) return;
    const point = pointInStage(event.clientX, event.clientY);
    if (!point) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = {
      mode: crop ? 'move' : 'new',
      startX: point.x,
      startY: point.y,
      origin: crop,
    };
    if (!crop) setCrop({ x: point.x, y: point.y, w: 0.01, h: 0.01 });
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (!drag.current) return;
    const point = pointInStage(event.clientX, event.clientY);
    if (!point) return;
    if (drag.current.mode === 'new') {
      const x = Math.min(drag.current.startX, point.x);
      const y = Math.min(drag.current.startY, point.y);
      const w = Math.abs(point.x - drag.current.startX);
      const h = Math.abs(point.y - drag.current.startY);
      setCrop({ x, y, w: Math.max(0.05, w), h: Math.max(0.05, h) });
      return;
    }
    const origin = drag.current.origin;
    if (!origin) return;
    const dx = point.x - drag.current.startX;
    const dy = point.y - drag.current.startY;
    setCrop({
      x: Math.min(1 - origin.w, Math.max(0, origin.x + dx)),
      y: Math.min(1 - origin.h, Math.max(0, origin.y + dy)),
      w: origin.w,
      h: origin.h,
    });
  }

  function onPointerUp() {
    drag.current = null;
  }

  async function exportImage(): Promise<File> {
    const image = imgRef.current;
    if (!image) throw new Error('image_missing');
    await (image.decode?.() ?? Promise.resolve());
    const natW = image.naturalWidth || image.width;
    const natH = image.naturalHeight || image.height;
    const region = crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const sx = Math.round(region.x * natW);
    const sy = Math.round(region.y * natH);
    const sw = Math.max(1, Math.round(region.w * natW));
    const sh = Math.max(1, Math.round(region.h * natH));
    const maxEdge = 1600;
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_failed');
    const b = 1 + brightness / 100;
    const c = 1 + contrast / 100;
    ctx.filter = `brightness(${b}) contrast(${c})`;
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('encode_failed'))),
        'image/jpeg',
        0.86,
      );
    });
    const base = file.name.replace(/\.[^.]+$/, '') || 'document';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  }

  async function confirm() {
    setBusy(true);
    try {
      if (isImage) onConfirm(await exportImage());
      else onConfirm(file);
    } catch {
      onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalPortal onClose={onCancel}>
      <div
        className="upload-prepare"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        dir={ar ? 'rtl' : 'ltr'}
        onClick={(event) => {
          if (event.target === event.currentTarget) onCancel();
        }}
      >
        <div className="upload-prepare__panel">
          <header className="upload-prepare__bar">
            <strong>{title}</strong>
            <button type="button" className="upload-prepare__ghost" onClick={onCancel}>
              {ar ? 'إغلاق' : 'Close'}
            </button>
          </header>

          {isPdf && objectUrl ? (
            <iframe className="upload-prepare__pdf" title={title} src={objectUrl} />
          ) : null}

          {isImage && objectUrl ? (
            <div className="upload-prepare__editor">
              <div
                ref={stageRef}
                className="upload-prepare__stage"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={objectUrl}
                  alt=""
                  draggable={false}
                  style={{
                    filter: `brightness(${1 + brightness / 100}) contrast(${1 + contrast / 100})`,
                  }}
                />
                {crop ? (
                  <div
                    className="upload-prepare__crop"
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.w * 100}%`,
                      height: `${crop.h * 100}%`,
                    }}
                  />
                ) : null}
              </div>
              <p className="muted upload-prepare__hint">
                {ar
                  ? 'اسحب لتحديد منطقة القص. حرّك المربع بعد إنشائه. اضبط الإضاءة والتباين ثم أكّد.'
                  : 'Drag to set the crop. Move the box after creating it. Adjust light, then confirm.'}
              </p>
              <div className="upload-prepare__controls">
                <label>
                  {ar ? 'الإضاءة' : 'Brightness'}
                  <input
                    type="range"
                    min={-40}
                    max={40}
                    value={brightness}
                    onChange={(event) => setBrightness(Number(event.target.value))}
                  />
                </label>
                <label>
                  {ar ? 'التباين' : 'Contrast'}
                  <input
                    type="range"
                    min={-30}
                    max={40}
                    value={contrast}
                    onChange={(event) => setContrast(Number(event.target.value))}
                  />
                </label>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => {
                    setCrop(null);
                    setBrightness(0);
                    setContrast(0);
                  }}
                >
                  {ar ? 'إعادة ضبط' : 'Reset'}
                </button>
              </div>
            </div>
          ) : null}

          {!isImage && !isPdf ? (
            <p className="notice notice--error" role="alert">
              {ar ? 'يُقبل صورة أو ملف PDF فقط.' : 'Only an image or PDF is accepted.'}
            </p>
          ) : null}

          <footer className="upload-prepare__actions">
            <button type="button" className="button button--quiet" onClick={onCancel} disabled={busy}>
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={busy || (!isImage && !isPdf)}
              onClick={() => void confirm()}
            >
              {busy
                ? ar
                  ? 'جارٍ التجهيز…'
                  : 'Preparing…'
                : ar
                  ? 'تأكيد الإرسال'
                  : 'Confirm upload'}
            </button>
          </footer>
        </div>
      </div>
    </ModalPortal>
  );
}
