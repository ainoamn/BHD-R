'use client';

import type { PartyDocAttach } from '@/lib/profile-completeness';

const MAX_BYTES = 900_000;

/** File picker that stores a small attachment meta (+ optional data URL) on the party form. */
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
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={id}
        className="input"
        type="file"
        accept={accept}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) {
            onChange(undefined);
            return;
          }
          if (file.size > MAX_BYTES) {
            onChange(undefined);
            event.target.value = '';
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = typeof reader.result === 'string' ? reader.result : undefined;
            onChange({
              name: file.name.slice(0, 200),
              mime: file.type || 'application/octet-stream',
              size: file.size,
              ...(dataUrl && dataUrl.length < 1_500_000 ? { dataUrl } : {}),
            });
          };
          reader.readAsDataURL(file);
        }}
      />
      {value?.name ? (
        <p className="field__hint muted" dir="ltr">
          {value.name} · {Math.round(value.size / 1024)} KB
        </p>
      ) : (
        <p className="field__hint muted">
          {ar ? 'صورة أو PDF — حتى حوالي 900 ك.ب.' : 'Image or PDF — up to ~900 KB.'}
        </p>
      )}
    </div>
  );
}
