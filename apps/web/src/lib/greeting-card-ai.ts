import 'server-only';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { aiChatJson, resolveAiEndpoint, type AiEndpoint } from '@/lib/ai-chat';
import {
  COMPANY_NAME_AR,
  COMPANY_NAME_EN,
  PRODUCT_NAME,
} from '@/lib/email-template';
import type { GreetingDesignVersion } from '@/lib/greeting-campaigns-shared';
import { publicWebOrigin } from '@/lib/seo';

export type GreetingCardBrief = {
  occasion: string;
  occasionDate: string;
  /** Admin notes / raw meaning — AI rewrites into ceremonial copy. */
  meaning: string;
  changeRequest?: string | null | undefined;
  avoidMotifs?: string[] | undefined;
};

type AiDesignSpec = {
  headlineAr: string;
  headlineEn: string;
  bodyAr: string;
  bodyEn: string;
  accent: string;
  accentSoft: string;
  motif: string;
  imagePrompt: string;
};

/** Paths from public/brand/bhd-official-symbol.svg (viewBox 548×171). */
const MARK_PATHS = `
  <path fill="#08a39f" d="M0 0h100c31 0 48 17 48 43 0 18-9 31-25 39 20 6 31 22 31 42 0 28-21 47-53 47H30v-28h70c16 0 26-8 26-20 0-13-11-22-29-22H0V74h97c15 0 24-8 24-21 0-15-10-25-25-25H28L0 0Z"/>
  <path fill="#08a39f" d="M385 0h74c52 0 89 35 89 85 0 51-37 86-89 86h-74l28-28h46c36 0 61-23 61-58 0-34-25-57-61-57h-46L385 0Z"/>
  <path fill="#174b70" d="M190 109l30-27h90V0h30v171h-30v-62h-90v62h-30v-62Z"/>`;

function asString(value: unknown, fallback: string, max = 240): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return (trimmed || fallback).slice(0, max);
}

function asHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const m = value.trim().match(/^#([0-9a-fA-F]{6})$/);
  return m ? `#${m[1]!.toLowerCase()}` : fallback;
}

function parseSpec(raw: Record<string, unknown>, brief: GreetingCardBrief): AiDesignSpec {
  return {
    headlineAr: asString(raw.headlineAr, `تهنئة بمناسبة ${brief.occasion}`, 80),
    headlineEn: asString(raw.headlineEn, `Happy ${brief.occasion}`, 80),
    bodyAr: asString(
      raw.bodyAr,
      'بأسمى آيات التهاني والتبريكات، تتقدم عائلة بن حمود للتطوير بأطيب الأمنيات في هذه المناسبة العزيزة.',
      320,
    ),
    bodyEn: asString(
      raw.bodyEn,
      'Bin Hamood Development extends its warmest congratulations on this cherished occasion.',
      320,
    ),
    accent: asHex(raw.accent, '#0b8f8a'),
    accentSoft: asHex(raw.accentSoft, '#e6f6f5'),
    motif: asString(raw.motif, 'omani celebration', 60),
    imagePrompt: asString(
      raw.imagePrompt,
      `Photorealistic vertical Oman greeting card for ${brief.occasion}, traditional dress, fort and mosque, teal and gold`,
      900,
    ),
  };
}

async function designSpec(endpoint: AiEndpoint, brief: GreetingCardBrief): Promise<AiDesignSpec> {
  const avoid = (brief.avoidMotifs ?? []).slice(0, 8);
  const raw = await aiChatJson(
    endpoint,
    [
      'You are a senior bilingual copywriter and art director for Bin Hamood Development (BHD R) in Oman.',
      'Return JSON only. Never copy the admin notes verbatim — rewrite into polished ceremonial greeting copy.',
      'headlineAr: elegant Modern Standard Arabic title (max ~12 words), e.g. تهنئة بمناسبة …',
      'bodyAr: 1–2 poetic Arabic sentences suitable for a corporate national greeting card;',
      'mention youth / nation / occasion naturally when relevant; warm, dignified, non-political.',
      'headlineEn/bodyEn: matching formal English.',
      'Colors: hex #rrggbb; teal #0b8f8a, navy #174b70, gold #c49a3c — avoid purple neon.',
      'motif: short English visual theme DIFFERENT from avoidMotifs.',
      'imagePrompt: detailed ENGLISH prompt for a finished vertical PHOTOGRAPHIC greeting CARD:',
      'Omani people in traditional dress when fitting, forts/mosque/flag, teal wave frames, gold accents,',
      'Islamic geometric corner, CLEAR Arabic headline+body rendered on the card, date ribbon if dated,',
      'clean pale top band (~12%) with no faces for logo overlay; no English brand logos or watermarks.',
    ].join(' '),
    'Write professional card copy and an imagePrompt from this occasion brief.',
    {
      occasion: brief.occasion,
      occasionDate: brief.occasionDate,
      adminNotes: brief.meaning,
      changeRequest: brief.changeRequest ?? null,
      avoidMotifs: avoid,
      brandAr: COMPANY_NAME_AR,
      brandEn: COMPANY_NAME_EN,
      product: PRODUCT_NAME,
    },
    'greeting-card-design',
    60_000,
  );
  const spec = parseSpec(raw, brief);
  // Reject near-copies of raw admin notes as "professional" copy.
  if (
    brief.meaning &&
    spec.bodyAr.replace(/\s+/g, '') === brief.meaning.trim().replace(/\s+/g, '') &&
    brief.meaning.trim().length > 40
  ) {
    spec.bodyAr = asString(
      null,
      'بأسمى آيات التهاني والتبريكات، تتقدم شركة بن حمود للتطوير بأطيب الأمنيات لجميع أبنائنا في هذه المناسبة الغالية.',
      320,
    );
  }
  return spec;
}

type ImageEndpoint = { url: string; apiKey: string; model: string; kind: 'gateway' | 'openai' };

export function resolveAiImageEndpoint(oidcToken: string | null = null): ImageEndpoint | null {
  const modelOverride = process.env.AI_IMAGE_MODEL?.trim();
  const gatewayKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (gatewayKey) {
    return {
      url: 'https://ai-gateway.vercel.sh/v1/images/generations',
      apiKey: gatewayKey,
      model: modelOverride || 'openai/gpt-image-2',
      kind: 'gateway',
    };
  }
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
    const base = (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    );
    return {
      url: `${base}/images/generations`,
      apiKey: openAiKey,
      model: modelOverride || 'gpt-image-2',
      kind: 'openai',
    };
  }
  const oidc = oidcToken?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  if (oidc) {
    return {
      url: 'https://ai-gateway.vercel.sh/v1/images/generations',
      apiKey: oidc,
      model: modelOverride || 'openai/gpt-image-2',
      kind: 'gateway',
    };
  }
  return null;
}

function buildFullImagePrompt(spec: AiDesignSpec, brief: GreetingCardBrief): string {
  const dateLabel = brief.occasionDate
    ? new Intl.DateTimeFormat('ar-OM-u-nu-latn', {
        day: 'numeric',
        month: 'long',
        timeZone: 'Asia/Muscat',
      }).format(new Date(`${brief.occasionDate}T12:00:00+04:00`))
    : '';
  return [
    spec.imagePrompt,
    `Finished vertical digital greeting card, 3:4, photorealistic print quality.`,
    `Render Arabic headline clearly: «${spec.headlineAr}».`,
    `Render Arabic greeting clearly: «${spec.bodyAr}».`,
    dateLabel ? `Gold ribbon with «${dateLabel}» and subtle Omani khanjar emblem.` : '',
    `Palette teal ${spec.accent}, navy #174b70, soft gold. Theme: ${spec.motif}.`,
    brief.changeRequest ? `Revision: ${brief.changeRequest}` : '',
    `Top 12% clean soft band (no faces) for logo. No English logos, no watermark.`,
  ]
    .filter(Boolean)
    .join(' ');
}

async function generateRaster(imageEndpoint: ImageEndpoint, prompt: string): Promise<Buffer> {
  const isGptImage = /gpt-image/i.test(imageEndpoint.model);
  const isDale = /dall-e/i.test(imageEndpoint.model);
  const body: Record<string, unknown> = {
    model: imageEndpoint.model,
    prompt: prompt.slice(0, 3000),
    n: 1,
    size: isGptImage ? '1024x1536' : '1024x1024',
  };
  if (isGptImage) {
    body.quality = 'medium';
    body.output_format = 'jpeg';
  } else if (isDale) {
    body.response_format = 'b64_json';
    body.quality = 'hd';
  } else {
    body.response_format = 'b64_json';
  }

  const response = await fetch(imageEndpoint.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${imageEndpoint.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(110_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    console.error(
      'greeting image gen failed',
      imageEndpoint.model,
      response.status,
      (await response.text()).slice(0, 400),
    );
    throw new Error('ai_failed');
  }
  const json = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const first = json.data?.[0];
  if (first?.b64_json) return Buffer.from(first.b64_json, 'base64');
  if (first?.url) {
    const img = await fetch(first.url, { signal: AbortSignal.timeout(45_000), cache: 'no-store' });
    if (!img.ok) throw new Error('ai_failed');
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error('ai_failed');
}

/** Multimodal chat models that return images (Vercel AI Gateway). */
async function generateRasterViaChat(chat: AiEndpoint, prompt: string): Promise<Buffer> {
  const models =
    chat.url.includes('ai-gateway.vercel.sh')
      ? [
          'google/gemini-2.5-flash-image-preview',
          'google/gemini-2.0-flash-preview-image-generation',
          'openai/gpt-4.1',
        ]
      : [];
  for (const model of models) {
    try {
      const response = await fetch(chat.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${chat.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: `Generate one finished greeting-card image (no explanation).\n\n${prompt.slice(0, 2800)}`,
            },
          ],
          modalities: ['text', 'image'],
        }),
        signal: AbortSignal.timeout(110_000),
        cache: 'no-store',
      });
      if (!response.ok) {
        console.error(
          'greeting chat-image failed',
          model,
          response.status,
          (await response.text()).slice(0, 300),
        );
        continue;
      }
      const json = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: unknown;
            images?: unknown;
          };
        }>;
      };
      const message = json.choices?.[0]?.message;
      const extracted = extractImageBuffer(message);
      if (extracted) return extracted;
    } catch (error) {
      console.error('greeting chat-image error', model, error instanceof Error ? error.message : error);
    }
  }
  throw new Error('ai_failed');
}

function extractImageBuffer(message: { content?: unknown; images?: unknown } | undefined): Buffer | null {
  if (!message) return null;
  const fromImages = readImageList(message.images);
  if (fromImages) return fromImages;
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (!part || typeof part !== 'object') continue;
      const row = part as Record<string, unknown>;
      if (row.type === 'image_url' && row.image_url && typeof row.image_url === 'object') {
        const url = (row.image_url as { url?: string }).url;
        const buf = dataUrlToBuffer(url);
        if (buf) return buf;
      }
      if (typeof row.b64_json === 'string') return Buffer.from(row.b64_json, 'base64');
      if (typeof row.image === 'string') {
        const buf = dataUrlToBuffer(row.image) ?? Buffer.from(row.image, 'base64');
        if (buf.length > 1000) return buf;
      }
    }
  }
  if (typeof message.content === 'string') {
    const match = message.content.match(/data:image\/[a-zA-Z+]+;base64,([A-Za-z0-9+/=]+)/);
    if (match?.[1]) return Buffer.from(match[1], 'base64');
  }
  return null;
}

function readImageList(value: unknown): Buffer | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.b64_json === 'string') return Buffer.from(row.b64_json, 'base64');
    if (typeof row.image_url === 'string') {
      const buf = dataUrlToBuffer(row.image_url);
      if (buf) return buf;
    }
    if (row.image_url && typeof row.image_url === 'object') {
      const buf = dataUrlToBuffer((row.image_url as { url?: string }).url);
      if (buf) return buf;
    }
    if (typeof row.url === 'string') {
      const buf = dataUrlToBuffer(row.url);
      if (buf) return buf;
    }
  }
  return null;
}

function dataUrlToBuffer(value: string | null | undefined): Buffer | null {
  if (!value) return null;
  const match = value.match(/^data:image\/[a-zA-Z+]+;base64,([A-Za-z0-9+/=]+)$/);
  if (match?.[1]) return Buffer.from(match[1], 'base64');
  return null;
}

function brandOverlaySvg(width: number, height: number, companyAr: string): Buffer {
  const markW = Math.round(Math.min(width * 0.28, 220));
  const markH = Math.round((markW * 171) / 548);
  const padX = Math.round(markW * 0.18);
  const padY = Math.round(markH * 0.35);
  const badgeW = markW + padX * 2;
  const badgeH = markH + padY * 2 + 22;
  const left = Math.round((width - badgeW) / 2);
  const top = Math.max(12, Math.round(height * 0.028));
  const radius = Math.round(badgeH * 0.22);
  const escaped = companyAr
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="${left}" y="${top}" width="${badgeW}" height="${badgeH}" rx="${radius}"
        fill="#ffffff" fill-opacity="0.92" stroke="#08a39f" stroke-opacity="0.35" stroke-width="2"/>
      <svg x="${left + padX}" y="${top + padY - 4}" width="${markW}" height="${markH}" viewBox="0 0 548 171">
        ${MARK_PATHS}
      </svg>
      <text x="${width / 2}" y="${top + badgeH - 10}" text-anchor="middle"
        font-family="Tahoma, Arial, sans-serif" font-size="${Math.max(11, Math.round(width * 0.018))}"
        font-weight="700" fill="#174b70">${escaped}</text>
    </svg>`,
  );
}

async function brandAndCompress(raster: Buffer): Promise<{ mime: string; base64: string }> {
  const resized = await sharp(raster, { failOn: 'none', limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: 1024,
      height: 1536,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1536;
  const jpeg = await sharp(resized)
    .composite([{ input: brandOverlaySvg(width, height, COMPANY_NAME_AR), top: 0, left: 0 }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  let output = jpeg;
  if (output.length > 340_000) {
    output = await sharp(jpeg).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
  }
  return { mime: 'image/jpeg', base64: output.toString('base64') };
}

/**
 * Generate AI copy + photorealistic card with BHD logo.
 * Throws `ai_unconfigured` / `ai_failed` / `ai_image_failed` — never returns a fake text-only success.
 */
export async function generateGreetingDesign(
  brief: GreetingCardBrief,
  oidcToken: string | null = null,
): Promise<GreetingDesignVersion> {
  const chatEndpoint = resolveAiEndpoint(oidcToken);
  if (!chatEndpoint) throw new Error('ai_unconfigured');

  const spec = await designSpec(chatEndpoint, brief);
  const prompt = buildFullImagePrompt(spec, brief);
  const imageEndpoint = resolveAiImageEndpoint(oidcToken);

  let imageMime: string | null = null;
  let imageBase64: string | null = null;

  const imageCandidates: ImageEndpoint[] = [];
  if (imageEndpoint) {
    if (imageEndpoint.kind === 'gateway') {
      imageCandidates.push(
        imageEndpoint,
        { ...imageEndpoint, model: 'openai/gpt-image-1' },
        { ...imageEndpoint, model: 'openai/dall-e-3' },
        { ...imageEndpoint, model: 'bfl/flux-2-pro' },
      );
    } else {
      imageCandidates.push(
        imageEndpoint,
        { ...imageEndpoint, model: 'gpt-image-1' },
        { ...imageEndpoint, model: 'dall-e-3' },
      );
    }
  }

  for (const candidate of imageCandidates) {
    try {
      const raster = await generateRaster(candidate, prompt);
      const branded = await brandAndCompress(raster);
      imageMime = branded.mime;
      imageBase64 = branded.base64;
      break;
    } catch (error) {
      console.error(
        'greeting raster failed',
        candidate.model,
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (!imageBase64) {
    try {
      const raster = await generateRasterViaChat(chatEndpoint, prompt);
      const branded = await brandAndCompress(raster);
      imageMime = branded.mime;
      imageBase64 = branded.base64;
    } catch (error) {
      console.error('greeting chat-image fallback failed', error instanceof Error ? error.message : error);
    }
  }

  if (!imageBase64 || !imageMime) throw new Error('ai_image_failed');

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    promptNote: brief.changeRequest?.trim() || null,
    headlineAr: spec.headlineAr,
    headlineEn: spec.headlineEn,
    bodyAr: spec.bodyAr,
    bodyEn: spec.bodyEn,
    accent: spec.accent,
    accentSoft: spec.accentSoft,
    motif: spec.motif,
    imagePrompt: spec.imagePrompt,
    svg: '',
    imageMime,
    imageBase64,
  };
}

export function greetingCardPublicPath(campaignId: string, designId: string): string {
  return `/api/public/greeting-card/${campaignId}/${designId}`;
}

export function greetingCardPublicUrl(campaignId: string, designId: string): string {
  return `${publicWebOrigin()}${greetingCardPublicPath(campaignId, designId)}`;
}
