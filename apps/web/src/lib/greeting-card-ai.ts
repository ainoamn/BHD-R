import 'server-only';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { aiChatJson, resolveAiEndpoint, type AiEndpoint } from '@/lib/ai-chat';
import { COMPANY_NAME_AR, COMPANY_NAME_EN, PRODUCT_NAME } from '@/lib/email-template';
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

const MARK_PATHS = `
  <path fill="#08a39f" d="M0 0h100c31 0 48 17 48 43 0 18-9 31-25 39 20 6 31 22 31 42 0 28-21 47-53 47H30v-28h70c16 0 26-8 26-20 0-13-11-22-29-22H0V74h97c15 0 24-8 24-21 0-15-10-25-25-25H28L0 0Z"/>
  <path fill="#08a39f" d="M385 0h74c52 0 89 35 89 85 0 51-37 86-89 86h-74l28-28h46c36 0 61-23 61-58 0-34-25-57-61-57h-46L385 0Z"/>
  <path fill="#174b70" d="M190 109l30-27h90V0h30v171h-30v-62h-90v62h-30v-62Z"/>`;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function omanFlagSvg(x: number, y: number, w: number, h: number): string {
  const hoist = w * 0.28;
  const stripe = h / 3;
  return `<g transform="translate(${x} ${y})">
    <rect width="${w}" height="${h}" rx="4" fill="#C8102E"/>
    <rect x="${hoist}" y="0" width="${w - hoist}" height="${stripe}" fill="#FFFFFF"/>
    <rect x="${hoist}" y="${stripe}" width="${w - hoist}" height="${stripe}" fill="#C8102E"/>
    <rect x="${hoist}" y="${stripe * 2}" width="${w - hoist}" height="${stripe}" fill="#00843D"/>
    <g fill="#FFFFFF" transform="translate(${hoist * 0.2} ${h * 0.24}) scale(${(hoist * 0.011).toFixed(3)})">
      <path d="M40 8c6 18 8 36 8 54 0 14-2 26-6 36l12 4c5-12 8-28 8-40 0-20-3-40-10-58L40 8z"/>
      <path d="M28 90h36l-6 14H34z"/>
      <path d="M10 70c18-8 36-10 54-6l2 12c-16-3-32-2-48 6z"/>
      <path d="M10 86c18 8 36 10 54 6l2-12c-16 3-32 2-48-6z"/>
    </g>
    <rect width="${w}" height="${h}" rx="4" fill="none" stroke="#0b3d2e" stroke-width="2"/>
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
    headlineAr: asString(raw.headlineAr, `تهنئة بمناسبة ${brief.occasion}`, 72),
    headlineEn: asString(raw.headlineEn, `Happy ${brief.occasion}`, 72),
    bodyAr: asString(
      raw.bodyAr,
      'بأسمى آيات التهاني والتبريكات، تتقدم شركة بن حمود للتطوير بأطيب الأمنيات لجميع أبناء عُمان في هذه المناسبة العزيزة.',
      220,
    ),
    bodyEn: asString(
      raw.bodyEn,
      'Bin Hamood Development extends its warmest congratulations to the people of Oman on this cherished occasion.',
      220,
    ),
    accent: asHex(raw.accent, '#0b8f8a'),
    accentSoft: asHex(raw.accentSoft, '#e6f6f5'),
    motif: asString(raw.motif, 'omani youth portrait', 60),
    imagePrompt: asString(raw.imagePrompt, '', 500),
  };
}

async function designSpec(endpoint: AiEndpoint, brief: GreetingCardBrief): Promise<AiDesignSpec> {
  const avoid = (brief.avoidMotifs ?? []).slice(0, 8);
  const raw = await aiChatJson(
    endpoint,
    [
      'Senior ceremonial copywriter for Bin Hamood Development in Oman. JSON only.',
      'Rewrite notes into polished Modern Standard Arabic — never paste verbatim.',
      'headlineAr ≤10 words. bodyAr: ONE short dignified Arabic sentence (max 35 words).',
      'headlineEn/bodyEn formal English mirrors. motif: short English tag ≠ avoidMotifs.',
      'imagePrompt: ENGLISH only, a simple outdoor GROUP PORTRAIT in Oman.',
      'Men: white dishdasha + embroidered Omani kumma round cap (NOT Saudi shemagh, NOT turban wraps).',
      'Women: black abaya + hijab. Soft daylight, blurred fort/mosque far behind faces.',
      'imagePrompt MUST include: no text, no letters, no calligraphy, no flags, no poles, no logos, no banners.',
    ].join(' '),
    'Write copy and a clean portrait scene prompt.',
    {
      occasion: brief.occasion,
      occasionDate: brief.occasionDate,
      adminNotes: brief.meaning,
      changeRequest: brief.changeRequest ?? null,
      avoidMotifs: avoid,
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

function buildScenePrompt(spec: AiDesignSpec, brief: GreetingCardBrief): string {
  return [
    spec.imagePrompt ||
      `Outdoor group portrait of smiling Omani youth for ${brief.occasion}, soft daylight`,
    `Photorealistic vertical portrait photo, faces in the center third, shallow depth of field.`,
    `AUTHENTIC OMAN: men in white dishdasha with embroidered Omani kumma (round cap) only — never Saudi red/white shemagh, never black-and-white keffiyeh, never loose turban.`,
    `Women in black abaya and hijab with subtle gold trim.`,
    `Background softly blurred Oman landscape (stone fort or mosque dome out of focus) — NO flagpoles, NO flags of any country.`,
    `Empty clean sky above heads. No posters, no banners.`,
    `ABSOLUTELY NO text, letters, numbers, Arabic script, English words, calligraphy, logos, watermarks, UI, fake emblems.`,
    `Mood: ${spec.motif}.`,
    brief.changeRequest ? `Visual note only: ${brief.changeRequest}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

async function generateRaster(imageEndpoint: ImageEndpoint, prompt: string): Promise<Buffer> {
  const isGptImage = /gpt-image/i.test(imageEndpoint.model);
  const isDale = /dall-e/i.test(imageEndpoint.model);
  const body: Record<string, unknown> = {
    model: imageEndpoint.model,
    prompt: prompt.slice(0, 2800),
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
              content: `Generate one photorealistic portrait photograph only. No text. No flags. No logos.\n\n${prompt.slice(0, 2600)}`,
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
      console.error(
        'greeting chat-image error',
        model,
        error instanceof Error ? error.message : error,
      );
    }
  }
  throw new Error('ai_failed');
}

function extractImageBuffer(
  message: { content?: unknown; images?: unknown } | undefined,
): Buffer | null {
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

function fontCandidates(): string[] {
  const names = ['NotoNaskhArabic-Bold.ttf', 'NotoNaskhArabic-Regular.ttf'];
  const dirs = [
    path.join(MODULE_DIR, '../../assets/fonts'),
    path.join(MODULE_DIR, '../../../assets/fonts'),
    path.join(process.cwd(), 'assets/fonts'),
    path.join(process.cwd(), 'apps/web/assets/fonts'),
    path.join(process.cwd(), 'public/fonts'),
  ];
  const found: string[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (existsSync(full)) found.push(full);
    }
  }
  return [...new Set(found)];
}

/** Load TTF once and embed as CSS @font-face so Vercel does not depend on system fonts. */
function loadEmbeddedFonts(): { css: string; files: string[] } {
  const files = fontCandidates();
  if (!files.length) {
    console.error('greeting fonts missing from bundle', {
      cwd: process.cwd(),
      moduleDir: MODULE_DIR,
    });
    return { css: '', files: [] };
  }
  const faces = files.map((file) => {
    const bold = /Bold/i.test(path.basename(file));
    const b64 = readFileSync(file).toString('base64');
    return `@font-face{font-family:'NotoNaskhCard';font-weight:${bold ? 700 : 400};font-style:normal;src:url('data:font/ttf;base64,${b64}') format('truetype');}`;
  });
  return { css: faces.join(''), files };
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
 * Build a BHD-owned card: opaque chrome + Oman flag + real Arabic.
 * AI photo is cropped to the middle band and placed in a window only —
 * so model-drawn flags / gibberish / fake logos never appear.
 */
async function composeGreetingCard(
  scene: Buffer,
  spec: AiDesignSpec,
  brief: GreetingCardBrief,
): Promise<{ mime: string; base64: string }> {
  const meta = await sharp(scene, { failOn: 'none', limitInputPixels: 40_000_000 })
    .rotate()
    .metadata();
  const srcW = meta.width ?? 1024;
  const srcH = meta.height ?? 1536;
  // Drop top/bottom where models paint flags, fake logos and gibberish.
  const cropTop = Math.round(srcH * 0.22);
  const cropH = Math.round(srcH * 0.52);
  const photoBuf = await sharp(scene, { failOn: 'none', limitInputPixels: 40_000_000 })
    .rotate()
    .extract({
      left: 0,
      top: cropTop,
      width: srcW,
      height: Math.min(cropH, srcH - cropTop),
    })
    .resize({ width: 920, height: 620, fit: 'cover' })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  const photo = `data:image/jpeg;base64,${photoBuf.toString('base64')}`;

  const width = 1024;
  const height = 1536;
  const date = dateLabelAr(brief.occasionDate);
  const headLines = wrapLines(spec.headlineAr, 20, 2);
  const bodyLines = wrapLines(spec.bodyAr, 32, 3);
  const { css: fontCss, files: fontFiles } = loadEmbeddedFonts();
  if (!fontFiles.length) throw new Error('ai_image_failed');

  const titleBlockH = 130 + (headLines.length - 1) * 44;
  const headSvg = headLines
    .map(
      (line, i) =>
        `<text x="512" y="${920 + i * 52}" text-anchor="middle" direction="rtl" font-family="NotoNaskhCard" font-size="40" font-weight="700" fill="#10243a">${escapeXml(line)}</text>`,
    )
    .join('');
  const bodySvg = bodyLines
    .map(
      (line, i) =>
        `<text x="512" y="${1280 + i * 34}" text-anchor="middle" direction="rtl" font-family="NotoNaskhCard" font-size="24" font-weight="400" fill="#ffffff">${escapeXml(line)}</text>`,
    )
    .join('');

  const cardSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style type="text/css"><![CDATA[${fontCss}]]></style>
    <linearGradient id="page" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${spec.accentSoft}"/>
      <stop offset="45%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#e8f4f2"/>
    </linearGradient>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${spec.accent}"/>
      <stop offset="100%" stop-color="#174b70"/>
    </linearGradient>
    <linearGradient id="footer" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b6f6a"/>
      <stop offset="100%" stop-color="#174b70"/>
    </linearGradient>
    <clipPath id="photoClip"><rect x="52" y="210" width="920" height="620" rx="22"/></clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#page)"/>
  <rect x="0" y="0" width="${width}" height="18" fill="url(#band)"/>
  <rect x="0" y="${height - 18}" width="${width}" height="18" fill="url(#band)"/>
  <path d="M40 40h90v18H58v72H40V40z" fill="${spec.accent}" opacity="0.35"/>
  <path d="M894 40h90v90h-18V58h-72V40z" fill="${spec.accent}" opacity="0.35"/>
  <path d="M40 1406h18v72h72v18H40v-90z" fill="${spec.accent}" opacity="0.35"/>
  <path d="M894 1496h90v-90h-18v72h-72v18z" fill="${spec.accent}" opacity="0.35"/>
  ${omanFlagSvg(56, 48, 110, 66)}
  ${omanFlagSvg(858, 48, 110, 66)}
  <rect x="300" y="40" width="424" height="120" rx="18" fill="#ffffff" stroke="${spec.accent}" stroke-width="2"/>
  <svg x="388" y="52" width="248" height="77" viewBox="0 0 548 171">${MARK_PATHS}</svg>
  <text x="512" y="144" text-anchor="middle" direction="rtl" font-family="NotoNaskhCard" font-size="16" font-weight="700" fill="#174b70">${escapeXml(COMPANY_NAME_AR)}</text>
  <rect x="48" y="206" width="928" height="628" rx="24" fill="#d7e8e5"/>
  <image href="${photo}" x="52" y="210" width="920" height="620" clip-path="url(#photoClip)" preserveAspectRatio="xMidYMid slice"/>
  <rect x="48" y="206" width="928" height="628" rx="24" fill="none" stroke="${spec.accent}" stroke-width="3"/>
  <rect x="64" y="860" width="896" height="${titleBlockH}" rx="20" fill="#ffffff" stroke="#d5e4e1" stroke-width="2"/>
  ${headSvg}
  ${
    date
      ? `<rect x="352" y="${860 + titleBlockH - 58}" width="320" height="46" rx="23" fill="#c49a3c"/>
  <text x="512" y="${860 + titleBlockH - 26}" text-anchor="middle" direction="rtl" font-family="NotoNaskhCard" font-size="22" font-weight="700" fill="#ffffff">${escapeXml(date)}</text>`
      : ''
  }
  <rect x="0" y="1180" width="${width}" height="356" fill="url(#footer)"/>
  ${bodySvg}
  <text x="512" y="1450" text-anchor="middle" font-family="Georgia, serif" font-size="15" fill="#d7eee9">${escapeXml(PRODUCT_NAME)} · ${escapeXml(COMPANY_NAME_EN)}</text>
</svg>`;

  const resvg = new Resvg(cardSvg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: 'NotoNaskhCard',
    },
  });
  const png = resvg.render().asPng();
  let jpeg = await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  if (jpeg.length > 340_000) {
    jpeg = await sharp(png).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  }
  return { mime: 'image/jpeg', base64: jpeg.toString('base64') };
}

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
