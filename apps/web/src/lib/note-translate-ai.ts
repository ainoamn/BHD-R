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

const LANG_NAME: Record<NoteLang, string> = { ar: 'Arabic', en: 'English' };

export type NoteTranslation = { engine: 'ai' | 'machine'; text: string };

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
