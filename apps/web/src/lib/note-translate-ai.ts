import 'server-only';
import { aiChatJson, resolveAiEndpoint } from '@/lib/ai-chat';
import { machineTranslate } from '@/lib/machine-translate';
import type { NoteLang } from '@/lib/note-translation';

const SYSTEM_PROMPT = [
  'You translate short operational notes written by property owners, their representatives, and accountants',
  'in the Sultanate of Oman about bookings: guest check-in and check-out, unit condition, damages, missing items,',
  'cleaning, deposit refund decisions and deductions, transfers, and contract remarks.',
  'Translate faithfully between Arabic and English. Arabic output is clear, polite Modern Standard Arabic;',
  'English output is clear, polite, professional English.',
  'Keep the meaning and tone; never add, drop, or soften facts.',
  'Preserve numbers, amounts, currency (ر.ع. is OMR), dates, times, names, phone numbers, unit numbers,',
  'and booking or contract references exactly. Keep line breaks.',
  'Respond with a single JSON object only.',
].join(' ');

const ASSIST_PROMPT = [
  SYSTEM_PROMPT,
  "You also help the writer: fix spelling, grammar and punctuation in the note's own language, and",
  'suggest a clearer, polite, professional wording of the same facts in that language.',
  'Never invent facts, amounts or names, and never change numbers, dates or references.',
].join(' ');

const LANG_NAME: Record<NoteLang, string> = { ar: 'Arabic', en: 'English' };

export type NoteTranslation = { engine: 'ai' | 'machine'; text: string };

/** Translation of the note plus, from AI only, a corrected and a reworded version in its language. */
export type NoteAssist = {
  engine: 'ai' | 'machine';
  translation: string;
  corrected: string | null;
  rephrased: string | null;
};

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

function suggestion(value: unknown, ...same: string[]): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim().slice(0, 4000);
  return same.some((other) => squash(other) === squash(text)) ? null : text;
}

/** As-you-type help for a note: translation, correction and rewording in one AI call. */
export async function assistNote(
  context: { oidcToken: string | null },
  input: { text: string; source: NoteLang; target: NoteLang },
): Promise<NoteAssist> {
  const endpoint = resolveAiEndpoint(context.oidcToken);
  if (endpoint) {
    try {
      const result = await aiChatJson(
        endpoint,
        ASSIST_PROMPT,
        [
          `The note is written in ${LANG_NAME[input.source]}.`,
          'Return {"translation": string, "corrected": string, "rephrased": string}:',
          `"translation" is the intended meaning translated correctly into ${LANG_NAME[input.target]};`,
          `"corrected" is the note in ${LANG_NAME[input.source]} with only spelling, grammar and punctuation fixed (the same text when nothing needs fixing);`,
          `"rephrased" is a clearer, polite and professional wording in ${LANG_NAME[input.source]} with the same facts.`,
        ].join(' '),
        { text: input.text },
        'note assist',
        30_000,
      );
      const translation = typeof result.translation === 'string' ? result.translation.trim() : '';
      if (translation) {
        const corrected = suggestion(result.corrected, input.text);
        return {
          engine: 'ai',
          translation: translation.slice(0, 4000),
          corrected,
          rephrased: suggestion(result.rephrased, input.text, corrected ?? input.text),
        };
      }
    } catch {
      /* fall back to machine translation */
    }
  }
  const machine = await machineTranslate(input.text, input.target);
  if (!machine) throw new Error('ai_failed');
  return { engine: 'machine', translation: machine, corrected: null, rephrased: null };
}

/** AI translation of a booking note, falling back to free machine translation. */
export async function translateNote(
  context: { oidcToken: string | null },
  input: { text: string; target: NoteLang },
): Promise<NoteTranslation> {
  const endpoint = resolveAiEndpoint(context.oidcToken);
  if (endpoint) {
    try {
      const result = await aiChatJson(
        endpoint,
        SYSTEM_PROMPT,
        `Translate this note into ${LANG_NAME[input.target]}. Return {"text": string}.`,
        { text: input.text },
        'note translate',
      );
      const text = typeof result.text === 'string' ? result.text.trim() : '';
      if (text) return { engine: 'ai', text: text.slice(0, 4000) };
    } catch {
      /* fall back to machine translation */
    }
  }
  const machine = await machineTranslate(input.text, input.target);
  if (!machine) throw new Error('ai_failed');
  return { engine: 'machine', text: machine };
}
