import 'server-only';
import { aiChatJson, resolveAiEndpoint } from '@/lib/ai-chat';
import { machineTranslate } from '@/lib/machine-translate';

const SYSTEM_PROMPT = [
  'You convert personal and company names between Arabic and English for official lease and sale',
  'contracts in the Sultanate of Oman. Personal names are transliterated the way they appear on Omani',
  'and Gulf ID cards and passports (e.g. محمد بن سالم البلوشي → Mohammed Bin Salim Al Balushi),',
  'not translated word by word. Company names keep their legal form (ش.م.م → LLC, ش.م.ع.ع → SAOG,',
  'مؤسسة → Establishment, شركة → Company) and well-known brand spellings.',
  'Never add titles, honorifics or words that are not in the source.',
  'Respond with a single JSON object only.',
].join(' ');

export type NameKind = 'person' | 'company';

/** AI transliteration of a name for the other contract language, with machine translation as fallback. */
export async function translateName(
  context: { oidcToken: string | null },
  input: { text: string; target: 'ar' | 'en'; kind: NameKind },
): Promise<{ engine: 'ai' | 'machine'; text: string }> {
  const endpoint = resolveAiEndpoint(context.oidcToken);
  if (endpoint) {
    try {
      const result = await aiChatJson(
        endpoint,
        SYSTEM_PROMPT,
        `Write this ${input.kind === 'company' ? 'company' : 'person'} name in ${
          input.target === 'ar' ? 'Arabic script' : 'English (Latin letters)'
        }. Return {"text": string}.`,
        { name: input.text },
        'name translate',
      );
      const text = typeof result.text === 'string' ? result.text.trim() : '';
      if (text) return { engine: 'ai', text: text.slice(0, 200) };
    } catch {
      /* fall back to machine translation */
    }
  }
  const machine = await machineTranslate(input.text, input.target);
  if (!machine) throw new Error('ai_failed');
  return { engine: 'machine', text: machine.trim().slice(0, 200) };
}
