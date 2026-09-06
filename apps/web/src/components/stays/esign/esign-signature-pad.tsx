'use client';

import { useCallback, useEffect, useRef } from 'react';

type Props = {
  locale: string;
  onAccept: (dataUrl: string) => void;
  onBack?: () => void;
};

export function EsignSignaturePad({ locale, onAccept, onBack }: Props) {
  const ar = locale === 'ar';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasStroke = useRef(false);

  const paintBlank = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ratio = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
    const width = parent?.clientWidth || Math.min(520, window.innerWidth - 32);
    const height = Math.max(220, Math.min(360, Math.round(window.innerHeight * 0.38)));
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#f4efe6';
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#102820';
    hasStroke.current = false;
  }, []);

  useEffect(() => {
    paintBlank();
    const onResize = () => paintBlank();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [paintBlank]);

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
    hasStroke.current = true;
  }

  function onPointerUp() {
    drawing.current = false;
  }

  function accept() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke.current) return;
    onAccept(canvas.toDataURL('image/png'));
  }

  return (
    <div className="esign-sign">
      <p className="esign-sign__lede muted">
        {ar ? 'وقّع بإصبعك داخل المساحة أدناه' : 'Sign with your finger in the pad below'}
      </p>
      <div className="esign-sign__pad-wrap">
        <canvas
          ref={canvasRef}
          className="esign-sign__pad"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
      <div className="esign-sign__actions">
        {onBack ? (
          <button type="button" className="button button--quiet" onClick={onBack}>
            {ar ? 'رجوع' : 'Back'}
          </button>
        ) : null}
        <button type="button" className="button button--quiet" onClick={paintBlank}>
          {ar ? 'مسح' : 'Clear'}
        </button>
        <button type="button" className="button button--primary" onClick={accept}>
          {ar ? 'تأكيد التوقيع' : 'Confirm signature'}
        </button>
      </div>
    </div>
  );
}
