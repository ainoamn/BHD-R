import 'server-only';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
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

/** Official BHD mark paths (viewBox 548×171). */
const MARK_PATHS = `
  <path fill="#08a39f" d="M0 0h100c31 0 48 17 48 43 0 18-9 31-25 39 20 6 31 22 31 42 0 28-21 47-53 47H30v-28h70c16 0 26-8 26-20 0-13-11-22-29-22H0V74h97c15 0 24-8 24-21 0-15-10-25-25-25H28L0 0Z"/>
  <path fill="#08a39f" d="M385 0h74c52 0 89 35 89 85 0 51-37 86-89 86h-74l28-28h46c36 0 61-23 61-58 0-34-25-57-61-57h-46L385 0Z"/>
  <path fill="#174b70" d="M190 109l30-27h90V0h30v171h-30v-62h-90v62h-30v-62Z"/>`;

/**
 * Simplified Oman national flag (hoist red + white/red/green + white khanjar cue).
 * Colours match the real flag; emblem is a clear simplified khanjar/swords mark.
 */
function omanFlagSvg(x: number, y: number, w: number, h: number): string {
  const hoist = w * 0.28;
  const stripe = (h / 3);
  return `<g transform="translate(${x} ${y})">
    <rect width="${w}" height="${h}" rx="3" fill="#C8102E"/>
    <rect x="${hoist}" y="0" width="${w - hoist}" height="${stripe}" fill="#FFFFFF"/>
    <rect x="${hoist}" y="${stripe}" width="${w - hoist}" height="${stripe}" fill="#C8102E"/>
    <rect x="${hoist}" y="${stripe * 2}" width="${w - hoist}" height="${stripe}" fill="#00843D"/>
    <g fill="#FFFFFF" transform="translate(${hoist * 0.18} ${h * 0.22}) scale(${(hoist * 0.012).toFixed(3)})">
      <path d="M40 8c6 18 8 36 8 54 0 14-2 26-6 36l12 4c5-12 8-28 8-40 0-20-3-40-10-58L40 8z"/>
      <path d="M28 90h36l-6 14H34z"/>
      <path d="M10 70c18-8 36-10 54-6l2 12c-16-3-32-2-48 6z"/>
      <path d="M10 86c18 8 36 10 54 6l2-12c-16 3-32 2-48-6z"/>
    </g>
    <rect width="${w}" height="${h}" rx="3" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.5"/>
  </g>`;
}

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
      'بأسمى آيات التهاني والتبريكات، تتقدم شركة بن حمود للتطوير بأطيب الأمنيات في هذه المناسبة العزيزة.',
      280,
    ),
    bodyEn: asString(
      raw.bodyEn,
      'Bin Hamood Development extends its warmest congratulations on this cherished occasion.',
      280,
    ),
    accent: asHex(raw.accent, '#0b8f8a'),
    accentSoft: asHex(raw.accentSoft, '#e6f6f5'),
    motif: asString(raw.motif, 'omani daylight celebration', 60),
    imagePrompt: asString(raw.imagePrompt, '', 700),
  };
}

async function designSpec(endpoint: AiEndpoint, brief: GreetingCardBrief): Promise<AiDesignSpec> {
  const avoid = (brief.avoidMotifs ?? []).slice(0, 8);
  const raw = await aiChatJson(
    endpoint,
    [
      'You are a senior bilingual ceremonial copywriter for Bin Hamood Development (BHD) in the Sultanate of Oman.',
      'Return JSON only. Rewrite admin notes into polished Modern Standard Arabic greeting copy — never paste notes verbatim.',
      'headlineAr: elegant Arabic title (≤12 words). bodyAr: 1–2 dignified Arabic sentences for a corporate national card.',
      'headlineEn/bodyEn: formal English mirrors. motif: short English visual theme DIFFERENT from avoidMotifs.',
      'imagePrompt: ENGLISH scene brief ONLY for a background photograph (people + Oman landscape).',
      'Must specify authentic Omani dress: men in white dishdasha with embroidered Omani kumma cap (NOT Saudi shemagh);',
      'women in black abaya with subtle gold embroidery. Landmarks: Nizwa/Mutrah fort, Sultan Qaboos Grand Mosque dome, Gulf of Oman.',
      'imagePrompt must say: no text, no letters, no calligraphy, no flags, no logos, no watermarks.',
    ].join(' '),
    'Write ceremonial copy and a text-free Oman scene prompt.',
    {
      occasion: brief.occasion,
      occasionDate: brief.occasionDate,
      adminNotes: brief.meaning,
      changeRequest: brief.changeRequest ?? null,
      avoidMotifs: avoid,
      brandAr: COMPANY_NAME_AR,
    },
    'greeting-card-design',
    60_000,
  );
  return parseSpec(raw, brief);
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

/** Background-only prompt — never asks the model to paint Arabic or flags. */
function buildScenePrompt(spec: AiDesignSpec, brief: GreetingCardBrief): string {
  const angle =
    ['low-angle heroic', 'side three-quarter', 'wide environmental portrait', 'soft morning light'][
      Math.abs([...spec.motif].reduce((n, c) => n + c.charCodeAt(0), 0)) % 4
    ];
  return [
    spec.imagePrompt ||
      `Photorealistic vertical photograph of young Omani adults celebrating ${brief.occasion} outdoors in Oman`,
    `Camera: ${angle}. Vertical 3:4 composition, cinematic, natural daylight.`,
    `AUTHENTIC OMANI PEOPLE ONLY: men wear white dishdasha with tassel and embroidered Omani kumma (round cap) — never Saudi red/white shemagh, never Emirati kandolian style.`,
    `Women wear black abaya and hijab with fine gold Omani embroidery.`,
    `BACKGROUND OMAN ONLY: stone fort on rocky hills (Nizwa or Mutrah), distant Sultan Qaboos Grand Mosque golden dome, turquoise sea, Hajar mountains, clear sky.`,
    `Leave soft empty sky in the top ~18% and darker open ground/space in the bottom ~28% for later text overlays.`,
    `STRICTLY FORBIDDEN in the image: any flag of any country, any text, letters, numbers, Arabic script, English words, calligraphy, logos, watermarks, posters, banners, UI chrome, fake emblems.`,
    `Theme mood: ${spec.motif}.`,
    brief.changeRequest ? `Art direction note (visual only, still no text/flags): ${brief.changeRequest}` : '',
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

async function generateRasterViaChat(chat: AiEndpoint, prompt: string): Promise<Buffer> {
  const models = chat.url.includes('ai-gateway.vercel.sh')
    ? ['google/gemini-2.5-flash-image-preview', 'google/gemini-2.0-flash-preview-image-generation']
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
              content: `Generate one photorealistic background photograph only. No text. No flags. No logos.\n\n${prompt.slice(0, 2800)}`,
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
        choices?: Array<{ message?: { content?: unknown; images?: unknown } }>;
      };
      const extracted = extractImageBuffer(json.choices?.[0]?.message);
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
        const buf = dataUrlToBuffer((row.image_url as { url?: string }).url);
        if (buf) return buf;
      }
      if (typeof row.b64_json === 'string') return Buffer.from(row.b64_json, 'base64');
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

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : [text.slice(0, maxChars)];
}

function resolveFontFiles(): string[] {
  const dirs = [
    path.join(process.cwd(), 'assets/fonts'),
    path.join(process.cwd(), 'apps/web/assets/fonts'),
    path.join(process.cwd(), 'public/fonts'),
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    for (const name of ['NotoNaskhArabic-Bold.ttf', 'NotoNaskhArabic-Regular.ttf']) {
      const full = path.join(dir, name);
      if (existsSync(full)) files.push(full);
    }
  }
  return [...new Set(files)];
}

function dateLabelAr(occasionDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occasionDate)) return '';
  return new Intl.DateTimeFormat('ar-OM-u-nu-latn', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Muscat',
  }).format(new Date(`${occasionDate}T12:00:00+04:00`));
}

/**
 * Bake real Arabic typography + Oman flag + BHD mark onto a text-free AI scene.
 */
async function composeGreetingCard(
  scene: Buffer,
  spec: AiDesignSpec,
  brief: GreetingCardBrief,
): Promise<{ mime: string; base64: string }> {
  const resized = await sharp(scene, { failOn: 'none', limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1024, height: 1536, fit: 'cover' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  const width = 1024;
  const height = 1536;
  const photo = `data:image/jpeg;base64,${resized.toString('base64')}`;
  const date = dateLabelAr(brief.occasionDate);
  const headLines = wrapLines(spec.headlineAr, 22, 2);
  const bodyLines = wrapLines(spec.bodyAr, 34, 4);
  const headFs = 44;
  const bodyFs = 26;
  const headStart = 430;
  const bodyStart = 1180;

  const headSvg = headLines
    .map(
      (line, i) =>
        `<text x="512" y="${headStart + i * 56}" text-anchor="middle" direction="rtl" font-family="Noto Naskh Arabic, NotoNaskhArabic, Tahoma, Arial" font-size="${headFs}" font-weight="700" fill="#10243a">${escapeXml(line)}</text>`,
    )
    .join('');
  const bodySvg = bodyLines
    .map(
      (line, i) =>
        `<text x="512" y="${bodyStart + i * 36}" text-anchor="middle" direction="rtl" font-family="Noto Naskh Arabic, NotoNaskhArabic, Tahoma, Arial" font-size="${bodyFs}" font-weight="500" fill="#ffffff">${escapeXml(line)}</text>`,
    )
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.92"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#06261f" stop-opacity="0"/>
      <stop offset="35%" stop-color="#06261f" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#041812" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${spec.accent}"/>
      <stop offset="100%" stop-color="#174b70"/>
    </linearGradient>
  </defs>
  <image href="${photo}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${width}" height="320" fill="url(#topFade)"/>
  <rect y="980" width="${width}" height="556" fill="url(#bottomFade)"/>
  <rect x="0" y="0" width="${width}" height="10" fill="url(#band)"/>
  <rect x="0" y="${height - 10}" width="${width}" height="10" fill="url(#band)"/>

  <!-- Brand chip -->
  <rect x="292" y="36" width="440" height="118" rx="18" fill="#ffffff" fill-opacity="0.94" stroke="${spec.accent}" stroke-opacity="0.35" stroke-width="2"/>
  <svg x="388" y="48" width="248" height="77" viewBox="0 0 548 171">${MARK_PATHS}</svg>
  <text x="512" y="140" text-anchor="middle" direction="rtl" font-family="Noto Naskh Arabic, NotoNaskhArabic, Tahoma, Arial" font-size="15" font-weight="700" fill="#174b70">${escapeXml(COMPANY_NAME_AR)}</text>

  ${omanFlagSvg(48, 48, 96, 58)}
  ${omanFlagSvg(880, 48, 96, 58)}

  <!-- Title panel -->
  <rect x="72" y="360" width="880" height="${120 + (headLines.length - 1) * 50}" rx="20" fill="#ffffff" fill-opacity="0.9"/>
  ${headSvg}

  ${
    date
      ? `<rect x="340" y="${headStart + headLines.length * 56 + 16}" width="344" height="44" rx="22" fill="#c49a3c"/>
  <text x="512" y="${headStart + headLines.length * 56 + 46}" text-anchor="middle" direction="rtl" font-family="Noto Naskh Arabic, NotoNaskhArabic, Tahoma, Arial" font-size="22" font-weight="700" fill="#ffffff">${escapeXml(date)}</text>`
      : ''
  }

  ${bodySvg}
  <text x="512" y="1480" text-anchor="middle" font-family="Georgia, serif" font-size="14" fill="#d7eee9">${escapeXml(PRODUCT_NAME)} · ${escapeXml(COMPANY_NAME_EN)}</text>
</svg>`;

  const fonts = resolveFontFiles();
  if (!fonts.length) {
    console.error('greeting fonts missing — Arabic overlay may fail');
  }
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontFiles: fonts,
      loadSystemFonts: true,
      defaultFontFamily: 'Noto Naskh Arabic',
    },
  });
  const png = resvg.render().asPng();
  let jpeg = await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  if (jpeg.length > 340_000) {
    jpeg = await sharp(png).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  }
  return { mime: 'image/jpeg', base64: jpeg.toString('base64') };
}

/**
 * Generate AI ceremonial copy + photorealistic Oman scene, then bake real Arabic + Oman flag + BHD logo.
 */
export async function generateGreetingDesign(
  brief: GreetingCardBrief,
  oidcToken: string | null = null,
): Promise<GreetingDesignVersion> {
  const chatEndpoint = resolveAiEndpoint(oidcToken);
  if (!chatEndpoint) throw new Error('ai_unconfigured');

  const spec = await designSpec(chatEndpoint, brief);
  const prompt = buildScenePrompt(spec, brief);
  const imageEndpoint = resolveAiImageEndpoint(oidcToken);

  let scene: Buffer | null = null;
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
      scene = await generateRaster(candidate, prompt);
      break;
    } catch (error) {
      console.error(
        'greeting scene failed',
        candidate.model,
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (!scene) {
    try {
      scene = await generateRasterViaChat(chatEndpoint, prompt);
    } catch (error) {
      console.error('greeting chat-scene failed', error instanceof Error ? error.message : error);
    }
  }

  if (!scene) throw new Error('ai_image_failed');

  const composed = await composeGreetingCard(scene, spec, brief);

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
    imageMime: composed.mime,
    imageBase64: composed.base64,
  };
}

export function greetingCardPublicPath(campaignId: string, designId: string): string {
  return `/api/public/greeting-card/${campaignId}/${designId}`;
}

export function greetingCardPublicUrl(campaignId: string, designId: string): string {
  return `${publicWebOrigin()}${greetingCardPublicPath(campaignId, designId)}`;
}

/** Kept for diagnostics / offline smoke tests. */