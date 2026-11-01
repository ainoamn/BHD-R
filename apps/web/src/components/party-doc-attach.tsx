'use client';

import { useRef, useState } from 'react';
import { compressImageFile } from '@/lib/compress-image';
import type { PartyDocAttach } from '@/lib/profile-completeness';

/** Source pick limit before compression (phone photos are often 2–8 MB). */
const MAX_SOURCE_BYTES = 12_000_000;
/** Final attachment size after compression — matches reservation party schema. */
const MAX_ATTACH_BYTES = 1_100_000;
const MAX_DATA_URL_CHARS = 1_500_000;

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('read_failed'));
    };
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

/** File picker that stores a small attachment meta (+ data URL) on the party form. */
export function PartyDocAttachField({
  id,
  label,
  value,
  onChange,
  locale,
  accept = 'image/*,application/pdf',
  required,
}: {
  id: string;
  label: string;
  value: PartyDocAttach | null | undefined;
  onChange: (next: PartyDocAttach | undefined) => void;
  locale: 'ar' | 'en';
  accept?: string;
  required?: boolean;
}) {
  const ar = locale === 'ar';
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function attach(file: File | undefined) {
    setError(null);
    if (!file) {
      onChange(undefined);
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError(
        ar
          ? 'الملف أكبر من 12 ميغابايت. صوّر المستند من جديد بدقة أقل.'
          : 'File is larger than 12 MB. Retake the document at a lower resolution.',
      );
      return;
    }

    setBusy(true);
    try {
      const prepared = file.type.startsWith('image/') ? await compressImageFile(file) : file;
      if (prepared.size > MAX_ATTACH_BYTES) {
        setError(
          ar
            ? 'الملف ما زال كبيراً بعد الضغط (الحد نحو 1 ميغابايت). استخدم صورة أوضح بحجم أصغر أو PDF أخف.'
            : 'File is still too large after compression (~1 MB max). Use a smaller photo or PDF.',
        );
        onChange(undefined);
        return;
      }
      const dataUrl = await readDataUrl(prepared);
      if (dataUrl.length > MAX_DATA_URL_CHARS) {
        setError(
          ar
            ? 'تعذّر إرفاق الملف لأنه كبير جداً بعد التحويل.'
            : 'Could not attach the file — it is still too large after encoding.',
        );
        onChange(undefined);
        return;
      }
      onChange({
        name: file.name.slice(0, 200),
        mime: prepared.type || file.type || 'application/octet-stream',
        size: prepared.size,
        dataUrl,
      });
    } catch {
      setError(
        ar
          ? 'تعذّر قراءة الملف. جرّب صورة JPEG/PNG أو PDF.'
          : 'Could not read the file. Try a JPEG/PNG photo or a PDF.',
      );
      onChange(undefined);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={`field party-doc-attach${error ? ' is-error' : ''}${value ? ' is-ready' : ''}`}>
      <span className="party-doc-attach__label" id={`${id}-label`}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </span>
      <input
        ref={inputRef}
        id={id}
        className="party-doc-attach__input"
        type="file"
        accept={accept}
        disabled={busy}
        tabIndex={-1}
        aria-labelledby={`${id}-label`}
        onChange={(event) => {
          void attach(event.currentTarget.files?.[0]);
        }}
      />
      <button
        type="button"
        className="button button--secondary party-doc-attach__button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy
          ? ar
            ? 'جاري التجهيز…'
            : 'Preparing…'
          : value?.name
            ? ar
              ? 'استبدال الملف'
              : 'Replace file'
            : ar
              ? 'رفع الملف'
              : 'Upload file'}
      </button>
      {error ? (
        <p className="field__hint party-doc-attach__error" role="alert">
          {error}
        </p>
      ) : null}
      {value?.name ? (
        <p className="field__hint party-doc-attach__ok" dir="ltr">
          ✓ {value.name} · {Math.max(1, Math.round(value.size / 1024))} KB
        </p>
      ) : !busy && !error ? (
        <p className="field__hint muted">
          {ar
            ? 'صورة أو PDF — الصور الكبيرة تُضغط تلقائياً (حتى نحو 1 ميغابايت).'
            : 'Image or PDF — large photos are compressed automatically (~1 MB).'}
        </p>
      ) : null}
    </div>
  );
}
