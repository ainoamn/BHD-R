import 'server-only';
import { randomUUID } from 'node:crypto';
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
    bodyAr: asString(raw.bodyAr, brief.meaning || 'نتمنى لكم يوماً سعيداً من عائلة بن حمود.', 320),
    bodyEn: asString(
      raw.bodyEn,
      brief.meaning || 'Warm wishes from the Bin Hamood family.',
      320,
    ),
    accent: asHex(raw.accent, '#0b8f8a'),
    accentSoft: asHex(raw.accentSoft, '#e6f6f5'),
    motif: asString(raw.motif, 'omani celebration', 60),
    imagePrompt: asString(raw.imagePrompt, `Elegant Oman celebration card for ${brief.occasion}`, 400),
  };
}

async function designSpec(endpoint: AiEndpoint, brief: GreetingCardBrief): Promise<AiDesignSpec> {
  const avoid = (brief.avoidMotifs ?? []).slice(0, 8);
  const raw = await aiChatJson(
    endpoint,
    [
      'You design bilingual (Arabic + English) greeting cards for BHD R / Bin Hamood Development,',
      'a property platform in Oman. Return JSON only.',
      'Tone: warm, respectful, festive, never political or religiously polarizing.',
      'Colors: hex #rrggbb; prefer teal/navy/gold/sand — avoid purple neon themes.',
      'headlineAr/headlineEn: short festive titles. bodyAr/bodyEn: 1–2 warm sentences.',
      'motif: short English tag for the visual theme. imagePrompt: English scene description for an illustration',
      '(no text in the image, no logos — logos are added separately).',
    ].join(' '),
    'Design a greeting card for this occasion. Vary the look if avoidMotifs is set.',
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

/** Compose a branded SVG card; seed varies decorative placement each generation. */
export function composeGreetingSvg(
  spec: AiDesignSpec,
  options: { origin: string; seed: string },
): string {
  const seedNum = [...options.seed].reduce((n, c) => n + c.charCodeAt(0), 0);
  const tilt = ((seedNum % 17) - 8) * 0.4;
  const orbX = 520 + (seedNum % 40);
  const orbY = 80 + (seedNum % 30);
  const logo = `${options.origin.replace(/\/$/, '')}/brand/bhd-email-logo.png`;
  const headAr = wrapLines(spec.headlineAr, 22, 2);
  const headEn = wrapLines(spec.headlineEn, 28, 2);
  const bodyAr = wrapLines(spec.bodyAr, 36, 3);
  const bodyEn = wrapLines(spec.bodyEn, 42, 3);

  const arLines = headAr
    .map(
      (line, i) =>
        `<text x="600" y="${210 + i * 42}" text-anchor="middle" fill="#10243a" font-family="Tahoma, Arial, sans-serif" font-size="34" font-weight="700">${escapeXml(line)}</text>`,
    )
    .join('');
  const enLines = headEn
    .map(
      (line, i) =>
        `<text x="600" y="${300 + i * 28}" text-anchor="middle" fill="#174b70" font-family="Georgia, serif" font-size="22">${escapeXml(line)}</text>`,
    )
    .join('');
  const bodyArLines = bodyAr
    .map(
      (line, i) =>
        `<text x="600" y="${400 + i * 26}" text-anchor="middle" fill="#24384d" font-family="Tahoma, Arial, sans-serif" font-size="18">${escapeXml(line)}</text>`,
    )
    .join('');
  const bodyEnLines = bodyEn
    .map(
      (line, i) =>
        `<text x="600" y="${490 + i * 22}" text-anchor="middle" fill="#5b6b7a" font-family="Georgia, serif" font-size="15">${escapeXml(line)}</text>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="675" viewBox="0 0 1200 675" role="img">
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
  <circle cx="140" cy="560" r="90" fill="#174b70" opacity="0.08"/>
  <g transform="rotate(${tilt.toFixed(1)} 600 340)">
    <rect x="80" y="70" width="1040" height="535" rx="22" fill="#ffffff" opacity="0.78" stroke="${spec.accent}33" stroke-width="2"/>
  </g>
  <image href="${escapeXml(logo)}" x="480" y="96" width="240" height="76" preserveAspectRatio="xMidYMid meet"/>
  <text x="600" y="188" text-anchor="middle" fill="#174b70" font-family="Tahoma, Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(COMPANY_NAME_AR)}</text>
  <text x="600" y="208" text-anchor="middle" fill="#8a99a8" font-family="Georgia, serif" font-size="12">${escapeXml(PRODUCT_NAME)} · ${escapeXml(COMPANY_NAME_EN)}</text>
  ${arLines}
  ${enLines}
  <rect x="520" y="365" width="160" height="4" rx="2" fill="${spec.accent}"/>
  ${bodyArLines}
  ${bodyEnLines}
  <text x="600" y="610" text-anchor="middle" fill="${spec.accent}" font-family="Tahoma, Arial, sans-serif" font-size="13" font-weight="700">${escapeXml(spec.motif)}</text>
  <rect x="0" y="661" width="1200" height="14" fill="url(#band)"/>
</svg>`;
}

/**
 * Generate a new design version (AI copy + branded SVG). Each call intentionally
 * varies motif/placement; previous versions stay in the campaign history.
 */
export async function generateGreetingDesign(
  brief: GreetingCardBrief,
  oidcToken: string | null = null,
): Promise<GreetingDesignVersion> {
  const endpoint = resolveAiEndpoint(oidcToken);
  let spec: AiDesignSpec;
  if (endpoint) {
    try {
      spec = await designSpec(endpoint, brief);
    } catch (error) {
      console.error('greeting design AI failed', error instanceof Error ? error.message : error);
      spec = parseSpec({}, brief);
      // Soft fallback still produces a usable card when the model is down.
      spec.motif = `festive ${brief.occasion}`.slice(0, 60);
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
  const origin = publicWebOrigin();
  const svg = composeGreetingSvg(spec, { origin, seed: id });
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
  };
}

export function greetingCardPublicPath(campaignId: string, designId: string): string {
  return `/api/public/greeting-card/${campaignId}/${designId}`;
}

export function greetingCardPublicUrl(campaignId: string, designId: string): string {
  return `${publicWebOrigin()}${greetingCardPublicPath(campaignId, designId)}`;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
