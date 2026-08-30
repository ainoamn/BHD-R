'use client';

import { useEffect, useState } from 'react';

/** Client QR linking to the absolute property page URL (current origin). */
export function PropertyQrCard({
  path,
  labelAr,
  labelEn,
  locale,
}: {
  path: string;
  labelAr: string;
  labelEn: string;
  locale: 'ar' | 'en';
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [url, setUrl] = useState(path);
  const ar = locale === 'ar';

  useEffect(() => {
    const absolute = new URL(path, window.location.origin).toString();
    setUrl(absolute);
    let cancelled = false;
    void import('qrcode')
      .then((mod) =>
        mod.toDataURL(absolute, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 180,
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
  }, [path]);

  return (
    <aside className="property-qr" aria-label={ar ? labelAr : labelEn}>
      <div className="property-qr__frame">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} width={180} height={180} alt={ar ? 'رمز QR للعقار' : 'Property QR code'} />
        ) : (
          <div className="property-qr__placeholder" aria-hidden="true" />
        )}
      </div>
      <p>
        <strong>{ar ? labelAr : labelEn}</strong>
      </p>
      <p className="muted" dir="ltr">
        {url}
      </p>
    </aside>
  );
}
