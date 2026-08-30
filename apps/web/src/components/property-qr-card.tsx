'use client';

import { useEffect, useState } from 'react';

/** Client QR linking to the absolute property page URL (current origin). */
export function PropertyQrCard({
  path,
  labelAr,
  labelEn,
  locale,
  size = 120,
  showUrl = false,
}: {
  path: string;
  labelAr: string;
  labelEn: string;
  locale: 'ar' | 'en';
  size?: number;
  /** Hide raw URL under the code (public listing preference). */
  showUrl?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const ar = locale === 'ar';
  const px = Math.max(88, Math.min(180, size));

  useEffect(() => {
    const absolute = new URL(path, window.location.origin).toString();
    let cancelled = false;
    void import('qrcode')
      .then((mod) =>
        mod.toDataURL(absolute, {
          // Higher ECC so a center logo overlay still scans reliably.
          errorCorrectionLevel: 'H',
          margin: 1,
          width: px,
          color: { dark: '#0f172a', light: '#ffffff' },
        }),
      )
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path, px]);

  return (
    <aside className="property-qr" aria-label={ar ? labelAr : labelEn}>
      <div className="property-qr__frame">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="property-qr__code"
            src={src}
            width={px}
            height={px}
            alt={ar ? 'رمز QR للعقار' : 'Property QR code'}
          />
        ) : (
          <div
            className="property-qr__placeholder"
            style={{ width: px, height: px }}
            aria-hidden="true"
          />
        )}
        <span className="property-qr__badge" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/bhd-official-symbol.svg" alt="" />
        </span>
      </div>
      <p>
        <strong>{ar ? labelAr : labelEn}</strong>
      </p>
      {showUrl ? (
        <p className="muted property-qr__url" dir="ltr">
          {typeof window !== 'undefined'
            ? new URL(path, window.location.origin).toString()
            : path}
        </p>
      ) : null}
    </aside>
  );
}
