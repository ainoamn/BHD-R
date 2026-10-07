import 'server-only';
import { machineTranslate } from '@/lib/machine-translate';

type Lang = 'ar' | 'en';
type Kind = 'heading' | 'clause';

type AiEndpoint = { url: string; apiKey: string; model: string };

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

/**
 * OpenAI-compatible chat endpoint: Vercel AI Gateway (`AI_GATEWAY_API_KEY`, or the Vercel OIDC token
 * forwarded on the request) or OpenAI directly (`OPENAI_API_KEY`). `AI_MODEL` overrides the model.
 */
function resolveEndpoint(oidcToken: string | null): AiEndpoint | null {
  const model = process.env.AI_MODEL?.trim();
  const gatewayKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (gatewayKey) {
    return { url: GATEWAY_URL, apiKey: gatewayKey, model: model || 'openai/gpt-4.1-mini' };
  }
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
    const base = (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    );
    return { url: `${base}/chat/completions`, apiKey: openAiKey, model: model || 'gpt-4.1-mini' };
  }
  const oidc = oidcToken?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  if (oidc) return { url: GATEWAY_URL, apiKey: oidc, model: model || 'openai/gpt-4.1-mini' };
  return null;
}

const SYSTEM_PROMPT = [
  'You are a senior legal drafter and translator for real-estate agreements in the Sultanate of Oman',
  '(property sale, residential monthly/yearly lease, and short-term daily rental booked online).',
  'Arabic output must be precise Modern Standard Arabic legal drafting (فصحى قانونية) as used in Omani contracts;',
  'English output must be clear, formal legal English.',
  'Never invent obligations, amounts, dates, durations, parties, or law references that are not in the source.',
  'Preserve numbers, amounts, currency, dates, names, and unit or plot numbers exactly.',
  'Do not add numbering, bullets, quotation marks, or headings — the document numbers itself.',
  'Respond with a single JSON object only.',
].join(' ');

async function chatJson(
  endpoint: AiEndpoint,
  instruction: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${endpoint.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: endpoint.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${instruction}\n\nINPUT:\n${JSON.stringify(payload)}` },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    console.error(
      'terms ai request failed',
      response.status,
      (await response.text()).slice(0, 300),
    );
    throw new Error('ai_failed');
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = body.choices?.[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new Error('ai_failed');
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const LANG_NAME: Record<Lang, string> = { ar: 'Arabic', en: 'English' };

export type TermsAiContext = { oidcToken: string | null };

export async function translateTerms(
  context: TermsAiContext,
  input: { from: Lang; items: { kind: Kind; text: string }[] },
): Promise<{ engine: 'ai' | 'machine'; translations: string[] }> {
  const to: Lang = input.from === 'ar' ? 'en' : 'ar';
  const endpoint = resolveEndpoint(context.oidcToken);
  if (!endpoint) {
    const translations: string[] = [];
    for (const item of input.items) {
      const translated = await machineTranslate(item.text, to);
      if (!translated) throw new Error('ai_failed');
      translations.push(translated);
    }
    return { engine: 'machine', translations };
  }
  const result = await chatJson(
    endpoint,
    [
      `Translate each item from ${LANG_NAME[input.from]} to ${LANG_NAME[to]} as contract terms and conditions.`,
      'Items of kind "heading" are short section titles; "clause" items are full contractual sentences.',
      'Use the established legal terminology (e.g. البائع/Seller, المشتري/Buyer, المؤجر/Landlord, المستأجر/Tenant,',
      'العربون/deposit, وديعة التأمين/security deposit, نقل الملكية/transfer of title, وزارة الإسكان والتخطيط العمراني/Ministry of Housing and Urban Planning).',
      'Return {"translations": [string, ...]} with exactly one translation per item, in the same order.',
    ].join(' '),
    { items: input.items },
  );
  const list = Array.isArray(result.translations) ? result.translations : [];
  const translations = input.items.map((item, index) =>
    cleanText(list[index], item.kind === 'heading' ? 200 : 1_200),
  );
  if (translations.some((text) => !text)) throw new Error('ai_failed');
  return { engine: 'ai', translations };
}

export async function rephraseTerm(
  context: TermsAiContext,
  input: { lang: Lang; kind: Kind; text: string; mode: string },
): Promise<{ text: string }> {
  const endpoint = resolveEndpoint(context.oidcToken);
  if (!endpoint) throw new Error('ai_unconfigured');
  const result = await chatJson(
    endpoint,
    [
      `Rewrite this ${input.kind === 'heading' ? 'section heading' : 'contract clause'} in ${LANG_NAME[input.lang]}`,
      `for a ${input.mode} agreement so it is legally sound, unambiguous, concise, and grammatically correct.`,
      'Keep the same meaning and parties; do not add new obligations or numbers.',
      'Return {"text": string}.',
    ].join(' '),
    { text: input.text },
  );
  const text = cleanText(result.text, input.kind === 'heading' ? 200 : 1_200);
  if (!text) throw new Error('ai_failed');
  return { text };
}

export async function proofreadTerm(
  context: TermsAiContext,
  input: { lang: Lang; kind: Kind; text: string; uiLang: Lang },
): Promise<{ corrected: string; issues: string[] }> {
  const endpoint = resolveEndpoint(context.oidcToken);
  if (!endpoint) throw new Error('ai_unconfigured');
  const result = await chatJson(
    endpoint,
    [
      `Proofread this ${LANG_NAME[input.lang]} ${input.kind === 'heading' ? 'heading' : 'contract clause'}.`,
      'Fix only spelling, grammar, punctuation, and clearly wrong legal terms; keep the wording otherwise unchanged.',
      `Return {"corrected": string, "issues": [string, ...]} where each issue briefly explains one correction in ${LANG_NAME[input.uiLang]}.`,
      'Return an empty issues array when the text is already correct.',
    ].join(' '),
    { text: input.text },
  );
  const corrected =
    cleanText(result.corrected, input.kind === 'heading' ? 200 : 1_200) || input.text;
  const issues = (Array.isArray(result.issues) ? result.issues : [])
    .map((issue) => cleanText(issue, 300))
    .filter(Boolean)
    .slice(0, 10);
  return { corrected, issues };
}
