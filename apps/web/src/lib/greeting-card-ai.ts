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
  meaning: string;
  /** Prior design feedback from the admin. */
  changeRequest?: string | null | undefined;
  /** Avoid repeating the same palette/motif. */
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
    bodyAr: asString(raw.bodyAr, brief.meaning || 'نتمنى لكم يوماً سعيداً من عائلة بن حمود.', 280),
    bodyEn: asString(
      raw.bodyEn,
      brief.meaning || 'Warm wishes from the Bin Hamood family.',
      280,
    ),
    accent: asHex(raw.accent, '#0b8f8a'),
    accentSoft: asHex(raw.accentSoft, '#e6f6f5'),
    motif: asString(raw.motif, 'omani celebration', 60),
    imagePrompt: asString(
      raw.imagePrompt,
      `Photorealistic Oman celebration greeting card for ${brief.occasion}`,
      900,
    ),
  };
}

async function designSpec(endpoint: AiEndpoint, brief: GreetingCardBrief): Promise<AiDesignSpec> {
  const avoid = (brief.avoidMotifs ?? []).slice(0, 8);
  const raw = await aiChatJson(
    endpoint,
    [
      'You art-direct photorealistic digital greeting cards for BHD R / Bin Hamood Development in Oman.',
      'Return JSON only.',
      'Tone: warm, respectful, festive; never political or polarizing.',
      'Colors: hex #rrggbb; prefer teal #0b8f8a, navy #174b70, gold #c49a3c, sand — avoid purple neon.',
      'headlineAr: short Arabic festive title. bodyAr: 1–2 poetic Arabic sentences.',
      'headlineEn/bodyEn: short English mirrors.',
      'motif: short English visual theme tag that must differ from avoidMotifs.',
      'imagePrompt: detailed ENGLISH scene prompt for an image model of a finished vertical greeting CARD:',
      'photorealistic Omani people in traditional dress when relevant, iconic Oman landmarks (fort, mosque, flag),',
      'teal wave graphic frames, gold accents, Islamic geometric corner pattern,',
      'exact Arabic headline and body text rendered clearly on the card, date ribbon if a date is given,',
      'leave a clean pale band at the very top (~12% height) with no people/faces for a logo overlay,',
      'no English brand logos, no watermarks, no QR codes, no fake company marks.',
    ].join(' '),
    'Design copy and a rich imagePrompt for this occasion. Vary the look if avoidMotifs or changeRequest is set.',
    {
      occasion: brief.occasion,
      occasionDate: brief.occasionDate,
      meaning: brief.meaning,
      changeRequest: brief.changeRequest ?? null,
      avoidMotifs: avoid,
      brandAr: COMPANY_NAME_AR,
      brandEn: COMPANY_NAME_EN,
      product: PRODUCT_NAME,
    },
    'greeting-card-design',
    60_000,
  );
  return parseSpec(raw, brief);
}

type ImageEndpoint = { url: string; apiKey: string; model: string; kind: 'gateway' | 'openai' };

/** OpenAI-compatible `/images/generations` for gateway or direct OpenAI. */
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
    `Finished vertical digital greeting card, 3:4 composition, print quality.`,
    `Render this Arabic headline clearly: «${spec.headlineAr}».`,
    `Render this Arabic greeting clearly: «${spec.bodyAr}».`,
    dateLabel ? `Gold date ribbon with «${dateLabel}» and subtle Omani khanjar emblem.` : '',
    `Brand palette teal ${spec.accent} and navy #174b70 with soft gold highlights.`,
    `Theme: ${spec.motif}.`,
    brief.changeRequest ? `Admin revision: ${brief.changeRequest}` : '',
    `Top 12% of the image must be a clean soft gradient band (no faces) for logo placement.`,
    `No English logos, no watermark, no UI chrome.`,
  ]
    .filter(Boolean)
    .join(' ');
}

async function generateRaster(
  imageEndpoint: ImageEndpoint,
  prompt: string,
): Promise<Buffer> {
  const isGptImage = /gpt-image/i.test(imageEndpoint.model);
  const body: Record<string, unknown> = {
    model: imageEndpoint.model,
    prompt: prompt.slice(0, 3200),
    n: 1,
    size: isGptImage ? '1024x1536' : '1024x1024',
  };
  if (isGptImage) {
    body.quality = 'high';
    body.output_format = 'jpeg';
  } else {
    // dall-e-3 and similar
    body.response_format = 'b64_json';
    body.quality = 'hd';
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

/** Bake the official BHD mark onto the AI card and compress for storage/email. */
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

  // Cap ~450KB base64 (~340KB binary) so platform_settings stays manageable.
  let output = jpeg;
  if (output.length > 340_000) {
    output = await sharp(jpeg).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
  }
  return { mime: 'image/jpeg', base64: output.toString('base64') };
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

/** Text-only SVG fallback when image models are unavailable. */
export function composeGreetingSvg(spec: AiDesignSpec, options: { seed: string }): string {
  const seedNum = [...options.seed].reduce((n, c) => n + c.charCodeAt(0), 0);
  const tilt = ((seedNum % 17) - 8) * 0.4;
  const orbX = 520 + (seedNum % 40);
  const orbY = 80 + (seedNum % 30);
  const headAr = wrapLines(spec.headlineAr, 22, 2);
  const bodyAr = wrapLines(spec.bodyAr, 36, 4);

  const arLines = headAr
    .map(
      (line, i) =>
        `<text x="600" y="${250 + i * 42}" text-anchor="middle" fill="#10243a" font-family="Tahoma, Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(line)}</text>`,
    )
    .join('');
  const bodyArLines = bodyAr
    .map(
      (line, i) =>
        `<text x="600" y="${380 + i * 28}" text-anchor="middle" fill="#24384d" font-family="Tahoma, Arial, sans-serif" font-size="18">${escapeXml(line)}</text>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${spec.accentSoft}"/>
      <stop offset="55%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="${spec.accent}22"/>
    </linearGradient>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${spec.accent}"/>
      <stop offset="100%" stop-color="#174b70"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="675" rx="28" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="14" fill="url(#band)"/>
  <circle cx="${orbX}" cy="${orbY}" r="120" fill="${spec.accent}" opacity="0.12"/>
  <g transform="rotate(${tilt.toFixed(1)} 600 340)">
    <rect x="80" y="70" width="1040" height="535" rx="22" fill="#ffffff" opacity="0.78" stroke="${spec.accent}33" stroke-width="2"/>
  </g>
  <svg x="476" y="96" width="248" height="77" viewBox="0 0 548 171">${MARK_PATHS}</svg>
  <text x="600" y="200" text-anchor="middle" fill="#174b70" font-family="Tahoma, Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(COMPANY_NAME_AR)}</text>
  <text x="600" y="220" text-anchor="middle" fill="#8a99a8" font-family="Georgia, serif" font-size="12">${escapeXml(PRODUCT_NAME)} · ${escapeXml(COMPANY_NAME_EN)}</text>
  ${arLines}
  <rect x="520" y="345" width="160" height="4" rx="2" fill="${spec.accent}"/>
  ${bodyArLines}
  <text x="600" y="610" text-anchor="middle" fill="${spec.accent}" font-family="Tahoma, Arial, sans-serif" font-size="13" font-weight="700">${escapeXml(spec.motif)}</text>
  <rect x="0" y="661" width="1200" height="14" fill="url(#band)"/>
</svg>`;
}

/**
 * Generate a new design version: AI photorealistic card + BHD logo bake-in.
 * Previous versions stay in campaign history. Falls back to branded SVG if image API fails.
 */
export async function generateGreetingDesign(
  brief: GreetingCardBrief,
  oidcToken: string | null = null,
): Promise<GreetingDesignVersion> {
  const chatEndpoint = resolveAiEndpoint(oidcToken);
  let spec: AiDesignSpec;
  if (chatEndpoint) {
    try {
      spec = await designSpec(chatEndpoint, brief);
    } catch (error) {
      console.error('greeting design AI failed', error instanceof Error ? error.message : error);
      spec = parseSpec({}, brief);
      spec.motif = `festive ${brief.occasion} ${Date.now().toString(36)}`.slice(0, 60);
      spec.accent = ['#0b8f8a', '#174b70', '#c49a3c', '#b85c38'][
        Math.floor(Math.random() * 4)
      ]!;
      spec.accentSoft = '#eef7f6';
    }
  } else {
    spec = parseSpec({}, brief);
    spec.motif = `celebration ${Date.now().toString(36)}`;
    spec.accent = '#0b8f8a';
    spec.accentSoft = '#e6f6f5';
  }

  const id = randomUUID();
  let imageMime: string | null = null;
  let imageBase64: string | null = null;
  let svg = '';

  const imageEndpoint = resolveAiImageEndpoint(oidcToken);
  if (imageEndpoint) {
    const prompt = buildFullImagePrompt(spec, brief);
    const candidates =
      imageEndpoint.kind === 'gateway'
        ? [
            imageEndpoint,
            { ...imageEndpoint, model: 'openai/gpt-image-1' },
            { ...imageEndpoint, model: 'openai/dall-e-3' },
          ]
        : [
            imageEndpoint,
            { ...imageEndpoint, model: 'gpt-image-1' },
            { ...imageEndpoint, model: 'dall-e-3' },
          ];
    for (const candidate of candidates) {
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
  }

  if (!imageBase64) {
    svg = composeGreetingSvg(spec, { seed: id });
  }

  return {
    id,
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
    svg,
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
