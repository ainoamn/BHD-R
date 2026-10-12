'use client';

import { useState } from 'react';
import { browserNextMutation } from '@/lib/api';

const ARABIC = /[\u0600-\u06FF]/;

/**
 * Arabic and English name side by side. Leaving one filled and the other empty asks the AI for
 * the other spelling; the button re-translates on demand. The customer can always edit the result.
 */
export function BilingualNameField({
  idPrefix,
  labelAr,
  labelEn,
  valueAr,
  valueEn,
  onChange,
  locale,
  kind = 'person',
}: {
  idPrefix: string;
  labelAr: string;
  labelEn: string;
  valueAr: string;
  valueEn: string;
  onChange: (patch: { nameAr?: string; nameEn?: string }) => void;
  locale: 'ar' | 'en';
  kind?: 'person' | 'company';
}) {
  const ar = locale === 'ar';
  const [busy, setBusy] = useState<'ar' | 'en' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function translate(target: 'ar' | 'en', source: string) {
    const text = source.trim();
    if (text.length < 2 || busy) return;
    setBusy(target);
    setNote(null);
    try {
      const result = await browserNextMutation<{ text: string; engine: 'ai' | 'machine' }>(
        '/api/public/name-translate',
        { method: 'POST', body: JSON.stringify({ text, target, kind }) },
      );
      if (result.text) {
        onChange(target === 'en' ? { nameEn: result.text } : { nameAr: result.text });
        setNote(
          ar
            ? 'تُرجم الاسم تلقائياً — راجعه وعدّله إن لزم كما في الهوية أو الجواز.'
            : 'Translated automatically — check it against the ID or passport.',
        );
      }
    } catch {
      setNote(
        ar
          ? 'تعذّرت الترجمة التلقائية — اكتب الاسم يدوياً.'
          : 'Auto-translate failed — type it in.',
      );
    } finally {
      setBusy(null);
    }
  }

  function translateMissing() {
    if (valueAr.trim() && !valueEn.trim()) void translate('en', valueAr);
    else if (valueEn.trim() && !valueAr.trim()) void translate('ar', valueEn);
  }

  return (
    <div className="bilingual-name span-2">
      <div className="field">
        <label htmlFor={`${idPrefix}-ar`}>
          {labelAr}
          <span aria-hidden="true"> *</span>
        </label>
        <input
          id={`${idPrefix}-ar`}
          className="input"
          dir="rtl"
          lang="ar"
          required
          maxLength={200}
          value={valueAr}
          onChange={(event) => onChange({ nameAr: event.target.value })}
          onBlur={translateMissing}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-en`}>
          {labelEn}
          <span aria-hidden="true"> *</span>
        </label>
        <input
          id={`${idPrefix}-en`}
          className="input"
          dir="ltr"
          lang="en"
          required
          maxLength={200}
          value={valueEn}
          onChange={(event) => onChange({ nameEn: event.target.value })}
          onBlur={translateMissing}
        />
      </div>
      <div className="bilingual-name__tools">
        <button
          type="button"
          className="button button--quiet bilingual-name__ai"
          disabled={busy !== null || (!valueAr.trim() && !valueEn.trim())}
          onClick={() =>
            valueAr.trim() && ARABIC.test(valueAr)
              ? void translate('en', valueAr)
              : void translate('ar', valueEn || valueAr)
          }
        >
          {busy
            ? ar
              ? 'جارٍ الترجمة…'
              : 'Translating…'
            : ar
              ? 'ترجمة فورية بالذكاء الاصطناعي'
              : 'Instant AI translation'}
        </button>
        {note ? (
          <small className="muted" role="status">
            {note}
          </small>
        ) : null}
      </div>
    </div>
  );
}
