import 'server-only';

export type AiEndpoint = { url: string; apiKey: string; model: string };

const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

/**
 * OpenAI-compatible chat endpoint: Vercel AI Gateway (`AI_GATEWAY_API_KEY`, or the Vercel OIDC token
 * forwarded on the request) or OpenAI directly (`OPENAI_API_KEY`). `AI_MODEL` overrides the model.
 */
export function resolveAiEndpoint(oidcToken: string | null): AiEndpoint | null {
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

/** One JSON-mode chat turn; throws `ai_failed` on any provider or parsing failure. */
export async function aiChatJson(
  endpoint: AiEndpoint,
  system: string,
  instruction: string,
  payload: unknown,
  label: string,
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
        { role: 'system', content: system },
        { role: 'user', content: `${instruction}\n\nINPUT:\n${JSON.stringify(payload)}` },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    console.error(
      `${label} request failed`,
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
