'use client';

import { useState } from 'react';
import { ApiError, browserNextMutation, humanizeBrowserError } from '@/lib/api';
import {
  NOTE_TRANSLATE_MAX,
  hasNoteTranslation,
  joinNoteTranslation,
  noteLanguage,
  noteOriginal,
  otherLanguage,
  type NoteLang,
} from '@/lib/note-translation';

type Result = { engine: 'ai' | 'machine'; text: string };

const LANG_LABEL: Record<NoteLang, [string, string]> = {
  ar: ['العربية', 'Arabic'],
  en: ['الإنجليزية', 'English'],
};

function requestTranslation(text: string, target: NoteLang): Promise<Result> {
  return browserNextMutation<Result>('/api/owner/notes/translate', {
    method: 'POST',
    body: JSON.stringify({ text, target }),
    signal: AbortSignal.timeout(60_000),
  });
}

function errorMessage(error: unknown, ar: boolean): string {
  if (error instanceof ApiError) {
    if (error.code === 'rate_limited') {
      return ar
        ? 'طلبات ترجمة كثيرة خلال دقيقة؛ انتظر قليلاً ثم أعد المحاولة.'
        : 'Too many translations in a minute; wait a moment and try again.';
    }
    if (error.code === 'ai_failed' || error.code === 'ai_unconfigured') {
      return ar
        ? 'تعذّرت الترجمة الآن، أعد المحاولة بعد قليل.'
        : 'Translation is unavailable right now; try again shortly.';
    }
  }
  return humanizeBrowserError(error, ar);
}

function engineLabel(engine: Result['engine'], ar: boolean): string {
  if (engine === 'ai') return ar ? 'بالذكاء الاصطناعي' : 'by AI';
  return ar ? 'ترجمة آلية' : 'machine translation';
}

/**
 * Under a note field: adds the note's translation into the other language below the original,
 * so the guest, owner, and accountant each read it in their language.
 */
export function NoteTranslateBar({
  value,
  onChange,
  locale,
  max,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  locale: 'ar' | 'en';
  max: number;
  disabled?: boolean;
}) {
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const original = noteOriginal(value);
  const translated = hasNoteTranslation(value);
  const target = otherLanguage(noteLanguage(original));
  const [targetAr, targetEn] = LANG_LABEL[target];

  async function translate() {
    if (original.length < 2 || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await requestTranslation(original.slice(0, NOTE_TRANSLATE_MAX), target);
      const next = joinNoteTranslation(original, result.text, target);
      if (next.length > max) {
        setStatus({
          tone: 'error',
          text: ar
            ? `الملاحظة مع ترجمتها أطول من الحد (${max} حرفاً)؛ اختصر النص ثم أعد الترجمة.`
            : `The note with its translation exceeds ${max} characters; shorten it and translate again.`,
        });
        return;
      }
      onChange(next);
      setStatus({
        tone: 'ok',
        text: ar
          ? `أُضيفت الترجمة إلى ${targetAr} أسفل الملاحظة (${engineLabel(result.engine, true)}). راجعها قبل الحفظ.`
          : `${targetEn} translation added below the note (${engineLabel(result.engine, false)}). Review it before saving.`,
      });
    } catch (error) {
      setStatus({ tone: 'error', text: errorMessage(error, ar) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="note-translate">
      <div className="note-translate__actions">
        <button
          type="button"
          className="note-translate__button"
          disabled={disabled || busy || original.length < 2}
          onClick={() => void translate()}
        >
          <span aria-hidden="true">✨</span>
          {busy
            ? ar
              ? 'جارٍ الترجمة…'
              : 'Translating…'
            : translated
              ? ar
                ? `تحديث الترجمة إلى ${targetAr}`
                : `Update ${targetEn} translation`
              : ar
                ? `ترجمة إلى ${targetAr}`
                : `Translate to ${targetEn}`}
        </button>
        {translated && !busy ? (
          <button
            type="button"
            className="note-translate__button note-translate__button--quiet"
            disabled={disabled}
            onClick={() => {
              onChange(original);
              setStatus(null);
            }}
          >
            {ar ? 'إزالة الترجمة' : 'Remove translation'}
          </button>
        ) : null}
      </div>
      {status ? (
        <small
          className={status.tone === 'error' ? 'note-translate__error' : 'note-translate__hint'}
          role={status.tone === 'error' ? 'alert' : 'status'}
        >
          {status.text}
        </small>
      ) : null}
    </div>
  );
}

/** A read-only note with an on-demand translation into the reader's language (not saved). */
export function TranslatableNote({ text, locale }: { text: string; locale: 'ar' | 'en' }) {
  const ar = locale === 'ar';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = noteLanguage(text);
  const target = source === locale ? otherLanguage(source) : locale;
  const [targetAr, targetEn] = LANG_LABEL[target];

  async function toggle() {
    if (result) {
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await requestTranslation(text.slice(0, NOTE_TRANSLATE_MAX), target));
    } catch (caught) {
      setError(errorMessage(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="note-translate note-translate--inline">
      {result ? (
        <span
          className="note-translate__result"
          lang={target}
          dir={target === 'ar' ? 'rtl' : 'ltr'}
        >
          {result.text}
          <small> ({engineLabel(result.engine, ar)})</small>
        </span>
      ) : null}
      <button
        type="button"
        className="note-translate__button note-translate__button--quiet"
        disabled={busy}
        onClick={() => void toggle()}
      >
        <span aria-hidden="true">✨</span>
        {busy
          ? ar
            ? 'جارٍ الترجمة…'
            : 'Translating…'
          : result
            ? ar
              ? 'إخفاء الترجمة'
              : 'Hide translation'
            : ar
              ? `ترجمة إلى ${targetAr}`
              : `Translate to ${targetEn}`}
      </button>
      {error ? (
        <small className="note-translate__error" role="alert">
          {error}
        </small>
      ) : null}
    </span>
  );
}
