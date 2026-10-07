'use client';

import { useState, useTransition } from 'react';
import { TermsLetterheadFooter, TermsLetterheadHeader } from '@/components/terms-document';
import { ApiError, fetchBrowserCsrfToken, humanizeBrowserError } from '@/lib/api';
import { TERMS_LOGO_MAX_CHARS, type TermsLetterhead } from '@/lib/booking-terms';

const LOGO_MAX_WIDTH = 480;
const LOGO_MAX_HEIGHT = 200;

/** Downscales the logo in the browser and returns a PNG (or JPEG if PNG is too large) data URL. */
async function logoToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('invalid_image'));
      element.src = url;
    });
    const scale = Math.min(1, LOGO_MAX_WIDTH / image.width, LOGO_MAX_HEIGHT / image.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('invalid_image');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/png');
    if (data.length > TERMS_LOGO_MAX_CHARS) {
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      data = canvas.toDataURL('image/jpeg', 0.85);
    }
    if (data.length > TERMS_LOGO_MAX_CHARS) throw new Error('logo_too_large');
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function putLetterhead(body: TermsLetterhead): Promise<TermsLetterhead> {
  const send = async (csrf: string) =>
    fetch('/api/owner/booking-terms/letterhead', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  let response = await send(await fetchBrowserCsrfToken());
  if (response.status === 403) response = await send(await fetchBrowserCsrfToken(true));
  const payload = (await response.json().catch(() => null)) as {
    ok?: true;
    letterhead?: TermsLetterhead;
    error?: { code?: string };
  } | null;
  if (!response.ok || !payload?.ok || !payload.letterhead) {
    const code = payload?.error?.code ?? 'update_failed';
    throw new ApiError(response.status, code, code);
  }
  return payload.letterhead;
}

export function TermsLetterheadEditor({
  locale,
  initial,
}: {
  locale: 'ar' | 'en';
  initial: TermsLetterhead;
}) {
  const ar = locale === 'ar';
  const [form, setForm] = useState<TermsLetterhead>(initial);
  const [saved, setSaved] = useState<TermsLetterhead>(initial);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  function update(patch: Partial<TermsLetterhead>) {
    setMessage(null);
    setForm((current) => ({ ...current, ...patch }));
  }

  async function onLogo(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setMessage({
        kind: 'error',
        text: ar ? 'اختر صورة PNG أو JPG أو WEBP.' : 'Choose a PNG, JPG or WEBP image.',
      });
      return;
    }
    try {
      update({ logoDataUrl: await logoToDataUrl(file) });
    } catch {
      setMessage({
        kind: 'error',
        text: ar
          ? 'تعذّر قراءة الشعار — جرّب صورة أصغر.'
          : 'Could not read the logo — try a smaller image.',
      });
    }
  }

  function save() {
    startTransition(async () => {
      setMessage(null);
      try {
        const next = await putLetterhead(form);
        setForm(next);
        setSaved(next);
        setMessage({
          kind: 'success',
          text: ar ? 'تم حفظ ترويسة الطباعة.' : 'Print letterhead saved.',
        });
      } catch (caught) {
        setMessage({
          kind: 'error',
          text:
            caught instanceof ApiError && caught.code === 'forbidden'
              ? ar
                ? 'ليست لديك صلاحية تعديل الترويسة.'
                : 'You cannot edit the letterhead.'
              : humanizeBrowserError(caught, ar),
        });
      }
    });
  }

  const field = (
    key: Exclude<keyof TermsLetterhead, 'logoDataUrl'>,
    label: string,
    dir: 'rtl' | 'ltr',
    multiline = false,
  ) => (
    <div className="field">
      <label htmlFor={`letterhead-${key}`}>{label}</label>
      {multiline ? (
        <textarea
          id={`letterhead-${key}`}
          className="textarea"
          rows={2}
          dir={dir}
          maxLength={400}
          value={form[key]}
          onChange={(event) => update({ [key]: event.target.value })}
        />
      ) : (
        <input
          id={`letterhead-${key}`}
          className="input"
          dir={dir}
          maxLength={key === 'phone' ? 40 : 160}
          value={form[key]}
          onChange={(event) => update({ [key]: event.target.value })}
        />
      )}
    </div>
  );

  return (
    <section className="form-shell terms-letterhead-editor" aria-labelledby="letterhead-title">
      <h2 id="letterhead-title">{ar ? 'ترويسة الطباعة' : 'Print letterhead'}</h2>
      <p className="muted">
        {ar
          ? 'عند طباعة الشروط والأحكام يظهر شعار الشركة واسمها في الأعلى، وعنوان الشركة في الأسفل.'
          : 'Printed terms show the company logo and name at the top and the company address at the bottom.'}
      </p>

      <div className="terms-letterhead-editor__grid">
        <div className="field terms-letterhead-editor__logo">
          <span className="field__label">{ar ? 'شعار الشركة' : 'Company logo'}</span>
          {form.logoDataUrl ? (
            <img src={form.logoDataUrl} alt="" className="terms-letterhead-editor__logo-preview" />
          ) : (
            <span className="muted">{ar ? 'لا يوجد شعار' : 'No logo'}</span>
          )}
          <div className="terms-letterhead-editor__logo-actions">
            <label className="button button--quiet">
              {ar ? 'رفع شعار' : 'Upload logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => {
                  void onLogo(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
            {form.logoDataUrl ? (
              <button
                type="button"
                className="button button--quiet"
                onClick={() => update({ logoDataUrl: null })}
              >
                {ar ? 'إزالة الشعار' : 'Remove logo'}
              </button>
            ) : null}
          </div>
        </div>
        {field('nameAr', ar ? 'اسم الشركة بالعربية' : 'Company name (Arabic)', 'rtl')}
        {field('nameEn', ar ? 'اسم الشركة بالإنجليزية' : 'Company name (English)', 'ltr')}
        {field('addressAr', ar ? 'العنوان بالعربية' : 'Address (Arabic)', 'rtl', true)}
        {field('addressEn', ar ? 'العنوان بالإنجليزية' : 'Address (English)', 'ltr', true)}
        {field('phone', ar ? 'الهاتف' : 'Phone', 'ltr')}
        {field('email', ar ? 'البريد الإلكتروني' : 'Email', 'ltr')}
        {field('registrationNumber', ar ? 'رقم السجل التجاري' : 'Commercial registration', 'ltr')}
      </div>

      <div
        className="terms-letterhead-editor__preview"
        aria-label={ar ? 'معاينة الترويسة' : 'Preview'}
      >
        <TermsLetterheadHeader letterhead={form} />
        <p className="muted terms-letterhead-editor__preview-body">
          {ar ? '… الشروط والأحكام …' : '… terms and conditions …'}
        </p>
        <TermsLetterheadFooter letterhead={form} />
      </div>

      <div className="stays-checkout__nav booking-terms-editor__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={pending || !dirty}
          onClick={save}
        >
          {pending ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ الترويسة' : 'Save letterhead'}
        </button>
      </div>
      {message ? (
        <p
          className={`notice ${message.kind === 'success' ? 'notice--success' : 'notice--error'}`}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
