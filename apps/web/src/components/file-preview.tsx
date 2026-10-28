'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ModalPortal } from './modal-portal';

export type PreviewFile = {
  href: string;
  label: string;
  /** Extra facts under the title (cheque number, amount, bank…). */
  details?: ReactNode;
  /** Approve / reject / custom actions in the header. */
  actions?: ReactNode;
};

type Loaded = { url: string; mime: string };

/**
 * Shows an uploaded file over the page instead of a new tab. Images load straight into an
 * <img> (reusing a thumbnail already on the page); anything else — a PDF — is fetched once and
 * shown from a local blob URL, since the file routes forbid framing.
 */
export function FilePreviewDialog({
  file,
  ar,
  onClose,
}: {
  file: PreviewFile;
  ar: boolean;
  onClose: () => void;
}) {
  const [asImage, setAsImage] = useState(true);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAsImage(true);
  }, [file.href]);

  useEffect(() => {
    if (asImage) return;
    const controller = new AbortController();
    let url: string | null = null;
    setLoaded(null);
    setFailed(false);
    fetch(file.href, { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('file_unavailable');
        const blob = await response.blob();
        url = URL.createObjectURL(blob);
        setLoaded({ url, mime: blob.type });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.href, asImage]);

  const image = loaded?.mime.startsWith('image/');
  const pdf = loaded?.mime === 'application/pdf';

  return (
    <ModalPortal onClose={onClose}>
      <div
        className="file-preview"
        role="dialog"
        aria-modal="true"
        aria-label={file.label}
        dir={ar ? 'rtl' : 'ltr'}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="file-preview__panel">
          <header className="file-preview__bar">
            <div className="file-preview__heading">
              <strong>{file.label}</strong>
              {file.details ? <div className="file-preview__details">{file.details}</div> : null}
            </div>
            <div className="file-preview__actions">
              {file.actions}
              {asImage || loaded ? (
                <a
                  className="file-preview__button"
                  href={asImage ? file.href : (loaded?.url ?? file.href)}
                  download={file.label}
                >
                  {ar ? 'تنزيل' : 'Download'}
                </a>
              ) : null}
              <button type="button" className="file-preview__button" onClick={onClose} autoFocus>
                {ar ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </header>
          <div className="file-preview__body">
            {asImage ? (
              <img src={file.href} alt={file.label} onError={() => setAsImage(false)} />
            ) : failed ? (
              <p className="file-preview__note">
                {ar
                  ? 'تعذّر تحميل الملف، أعد المحاولة.'
                  : 'The file could not be loaded; try again.'}
              </p>
            ) : !loaded ? (
              <p className="file-preview__note" role="status">
                {ar ? 'جارٍ تحميل الملف…' : 'Loading the file…'}
              </p>
            ) : image ? (
              <img src={loaded.url} alt={file.label} />
            ) : pdf ? (
              <iframe src={loaded.url} title={file.label} />
            ) : (
              <p className="file-preview__note">
                {ar
                  ? 'لا يمكن معاينة هذا النوع من الملفات هنا؛ استخدم زر التنزيل.'
                  : 'This file type cannot be previewed here; use Download.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
