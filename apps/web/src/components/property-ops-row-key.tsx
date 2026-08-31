'use client';

import { useEffect, useState } from 'react';

/**
 * Row key for ops property list: cover thumbnail when available, else QR.
 * Clicking the cover opens a simple lightbox.
 */
export function PropertyOpsRowKey({
  propertyId,
  coverImageUrl,
  locale,
  name,
}: {
  propertyId: string;
  coverImageUrl?: string | null | undefined;
  locale: 'ar' | 'en';
  name?: string | undefined;
}) {
  const ar = locale === 'ar';
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const cover = coverImageUrl?.trim() || null;

  useEffect(() => {
    if (cover || !propertyId) return;
    const path = `/${locale}/properties/${propertyId}`;
    const absolute = new URL(path, window.location.origin).toString();
    let cancelled = false;
    void import('qrcode')
      .then((mod) =>
        mod.toDataURL(absolute, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 96,
          color: { dark: '#0f172a', light: '#ffffff' },
        }),
      )
      .then((dataUrl) => {
        if (!cancelled) setQrSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cover, propertyId, locale]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  if (cover) {
    return (
      <>
        <button
          type="button"
          className="ops-row-key ops-row-key--photo"
          onClick={() => setLightbox(true)}
          aria-label={ar ? 'تكبير صورة العقار' : 'Enlarge property photo'}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt={name || ''} loading="lazy" />
        </button>
        {lightbox ? (
          <div
            className="ops-row-key-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={ar ? 'صورة العقار' : 'Property photo'}
            onClick={() => setLightbox(false)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover}
              alt={name || ''}
              onClick={(event) => event.stopPropagation()}
            />
            <button
              type="button"
              className="ops-row-key-lightbox__close"
              onClick={() => setLightbox(false)}
            >
              {ar ? 'إغلاق' : 'Close'}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <span className="ops-row-key ops-row-key--qr" aria-label={ar ? 'رمز العقار' : 'Property code'}>
      {qrSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrSrc} alt="" width={48} height={48} />
      ) : (
        <span className="ops-row-key__placeholder" aria-hidden="true" />
      )}
    </span>
  );
}
