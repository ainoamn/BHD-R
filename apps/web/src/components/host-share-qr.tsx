'use client';

import { useState } from 'react';

const CARD_W = 1080;
const CARD_H = 1350;
const QR_SIZE = 820;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image_failed'));
    image.src = src;
  });
}

/** A printable card: the code, the host's name and a one-line call to scan. */
async function shareCardPng(svg: string, name: string, ar: boolean): Promise<Blob> {
  const sized = svg.replace('<svg ', `<svg width="${QR_SIZE}" height="${QR_SIZE}" `);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const qr = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_failed');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    ctx.fillStyle = '#08a39f';
    ctx.fillRect(0, 0, CARD_W, 18);
    ctx.direction = ar ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#092d24';
    ctx.font = '700 64px "IBM Plex Sans Arabic", Tahoma, sans-serif';
    ctx.fillText(name, CARD_W / 2, 150, CARD_W - 120);
    ctx.fillStyle = '#66756f';
    ctx.font = '500 40px "IBM Plex Sans Arabic", Tahoma, sans-serif';
    ctx.fillText(
      ar ? 'امسح الرمز لعرض العقارات والمباني' : 'Scan to see the properties and buildings',
      CARD_W / 2,
      225,
      CARD_W - 120,
    );
    ctx.drawImage(qr, (CARD_W - QR_SIZE) / 2, 290, QR_SIZE, QR_SIZE);
    ctx.fillStyle = '#174b70';
    ctx.font = '700 40px "IBM Plex Sans", sans-serif';
    ctx.direction = 'ltr';
    ctx.fillText('BHD R · r.bhd-om.com', CARD_W / 2, CARD_H - 90);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('png_failed'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Shareable QR of the public host profile, with copy, share and a downloadable card. */
export function HostShareQr({
  svg,
  url,
  name,
  locale,
}: {
  svg: string;
  url: string;
  name: string;
  locale: 'ar' | 'en';
}) {
  const ar = locale === 'ar';
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = ar
    ? `تعرّف على عقارات ${name} ومبانيه على BHD R:\n${url}`
    : `See ${name}'s properties on BHD R:\n${url}`;

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2_400);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      flash(ar ? 'نُسخ رابط الملف.' : 'Profile link copied.');
    } catch {
      flash(ar ? 'تعذّر النسخ.' : 'Could not copy.');
    }
  };

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: name, text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    await copy();
  };

  const download = async () => {
    setBusy(true);
    try {
      const blob = await shareCardPng(svg, name, ar);
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'bhd-r-host-qr.png';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
    } catch {
      flash(ar ? 'تعذّر تجهيز الصورة.' : 'Could not prepare the image.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="host-share" aria-labelledby="host-share-title">
      <div
        className="host-share__code"
        role="img"
        aria-label={ar ? 'رمز QR لملف المالك' : 'Host profile QR code'}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="host-share__body">
        <h2 id="host-share-title">{ar ? 'شارك ملف المالك' : 'Share this profile'}</h2>
        <p className="muted">
          {ar
            ? 'امسح الرمز بكاميرا الهاتف لفتح هذه الصفحة مباشرة والاطلاع على العقارات والمباني. اطبعه أو أرسله لعملائك.'
            : 'Scan with a phone camera to open this page and browse the properties and buildings. Print it or send it to clients.'}
        </p>
        <p className="host-share__url" dir="ltr">
          {url}
        </p>
        <div className="host-share__actions">
          <button type="button" className="button button--primary" onClick={() => void share()}>
            {ar ? 'مشاركة' : 'Share'}
          </button>
          <a
            className="button button--quiet"
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer"
          >
            {ar ? 'واتساب' : 'WhatsApp'}
          </a>
          <button type="button" className="button button--quiet" onClick={() => void copy()}>
            {ar ? 'نسخ الرابط' : 'Copy link'}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => void download()}
          >
            {busy ? (ar ? 'جارٍ التجهيز…' : 'Preparing…') : ar ? 'تنزيل الرمز' : 'Download code'}
          </button>
        </div>
        {notice ? (
          <p className="host-share__notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </section>
  );
}
