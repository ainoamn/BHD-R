'use client';

import { useEffect, useState } from 'react';
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

type Assist = {
  engine: 'ai' | 'machine';
  translation: string;
  corrected: string | null;
  rephrased: string | null;
  target: NoteLang;
};

/** Idle time after typing before the note is checked and translated. */
const ASSIST_DELAY_MS = 1200;
const ASSIST_MIN_CHARS = 6;

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
 * Under a note field: while the writer pauses, shows a live translation into the other language
 * and, from AI, a corrected and a clearer wording to adopt. The translation can be added below
 * the original, so the guest, owner, and accountant each read the note in their language.
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
  const [assist, setAssist] = useState<(Assist & { forText: string }) | null>(null);
  const [checking, setChecking] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const original = noteOriginal(value);
  const translated = hasNoteTranslation(value);
  const target = otherLanguage(noteLanguage(original));
  const [targetAr, targetEn] = LANG_LABEL[target];
  const live = assist && assist.forText === original && dismissedFor !== original ? assist : null;

  useEffect(() => {
    if (disabled || translated || original.length < ASSIST_MIN_CHARS) return;
    if (dismissedFor === original || assist?.forText === original) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setChecking(true);
      browserNextMutation<Assist>('/api/owner/notes/assist', {
        method: 'POST',
        body: JSON.stringify({ text: original.slice(0, NOTE_TRANSLATE_MAX) }),
        signal: controller.signal,
      })
        .then((result) => setAssist({ ...result, forText: original }))
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setChecking(false);
        });
    }, ASSIST_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      setChecking(false);
    };
  }, [original, translated, disabled, dismissedFor, assist?.forText]);

  function addTranslation(text: string, engine: Result['engine']) {
    const next = joinNoteTranslation(original, text, target);
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
        ? `أُضيفت الترجمة إلى ${targetAr} أسفل الملاحظة (${engineLabel(engine, true)}). راجعها قبل الحفظ.`
        : `${targetEn} translation added below the note (${engineLabel(engine, false)}). Review it before saving.`,
    });
  }

  function adopt(text: string) {
    onChange(text.slice(0, max));
    setStatus(null);
  }

  async function translate() {
    if (original.length < 2 || busy) return;
    if (live) {
      addTranslation(live.translation, live.engine);
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await requestTranslation(original.slice(0, NOTE_TRANSLATE_MAX), target);
      addTranslation(result.text, result.engine);
    } catch (error) {
      setStatus({ tone: 'error', text: errorMessage(error, ar) });
    } finally {
      setBusy(false);
    }
  }

  const suggestions = live
    ? [
        live.corrected
          ? {
              key: 'corrected',
              label: ar ? 'تصحيح إملائي ونحوي مقترح' : 'Suggested spelling and grammar fix',
              text: live.corrected,
              action: ar ? 'استخدم التصحيح' : 'Use the fix',
            }
          : null,
        live.rephrased
          ? {
              key: 'rephrased',
              label: ar ? 'صياغة أوضح مقترحة' : 'Suggested clearer wording',
              text: live.rephrased,
              action: ar ? 'استخدم هذه الصياغة' : 'Use this wording',
            }
          : null,
      ].filter((item) => item !== null)
    : [];
  const sourceDir = noteLanguage(original) === 'ar' ? 'rtl' : 'ltr';

  return (
    <div className="note-translate">
      {live && !translated ? (
        <div className="note-assist" aria-live="polite">
          <div className="note-assist__item">
            <span className="note-assist__label">
              <span aria-hidden="true">✨</span>
              {ar
                ? `الترجمة الفورية إلى ${targetAr} · ${engineLabel(live.engine, true)}`
                : `Live ${targetEn} translation · ${engineLabel(live.engine, false)}`}
            </span>
            <p lang={target} dir={target === 'ar' ? 'rtl' : 'ltr'}>
              {live.translation}
            </p>
          </div>
          {suggestions.map((item) => (
            <div key={item.key} className="note-assist__item note-assist__item--suggest">
              <span className="note-assist__label">{item.label}</span>
              <p dir={sourceDir}>{item.text}</p>
              <button
                type="button"
                className="note-translate__button"
                disabled={disabled}
                onClick={() => adopt(item.text)}
              >
                {item.action}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="note-translate__button note-translate__button--quiet note-assist__dismiss"
            onClick={() => setDismissedFor(original)}
          >
            {ar ? 'إخفاء الاقتراحات' : 'Hide suggestions'}
          </button>
        </div>
      ) : checking && !translated ? (
        <small className="note-translate__hint" role="status">
          {ar ? 'جارٍ مراجعة الملاحظة وترجمتها…' : 'Checking and translating the note…'}
        </small>
      ) : null}
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
              : live
                ? ar
                  ? 'أضف الترجمة أسفل الملاحظة'
                  : 'Add the translation below the note'
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
