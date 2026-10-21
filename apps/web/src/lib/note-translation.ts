export type NoteLang = 'ar' | 'en';

export const NOTE_TRANSLATE_MAX = 2000;

const MARKER: Record<NoteLang, string> = { ar: '— العربية —', en: '— English —' };
const MARKER_LINE = /\n*^— (?:English|العربية) —$\n?/m;

/** Language the note is mostly written in, by letter count. */
export function noteLanguage(text: string): NoteLang {
  const arabic = text.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return arabic >= latin ? 'ar' : 'en';
}

export function otherLanguage(lang: NoteLang): NoteLang {
  return lang === 'ar' ? 'en' : 'ar';
}

/** Note text before an appended translation (the whole text when there is none). */
export function noteOriginal(value: string): string {
  const match = MARKER_LINE.exec(value);
  return (match ? value.slice(0, match.index) : value).trim();
}

export function hasNoteTranslation(value: string): boolean {
  return MARKER_LINE.test(value);
}

/** Original note, a language marker line, then the translation — readable by both audiences. */
export function joinNoteTranslation(
  original: string,
  translated: string,
  target: NoteLang,
): string {
  return `${original.trim()}\n${MARKER[target]}\n${translated.trim()}`;
}

/** Prefer the half of a bilingual note that matches the reader’s language. */
export function noteForLocale(value: string, locale: NoteLang): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!hasNoteTranslation(trimmed)) return trimmed;
  const original = noteOriginal(trimmed);
  const match = trimmed.match(/\n— (?:English|العربية) —\n([\s\S]*)$/);
  const translated = match?.[1]?.trim() ?? '';
  return noteLanguage(original) === locale ? original : translated || original;
}
