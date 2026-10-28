/**
 * Cheerful bilingual WhatsApp copy — same tone icons, wishes, and sparks as branded email,
 * shaped for chat bubbles (short lines, bold titles, emoji anchors) so it reads well on phones.
 */
import {
  COMPANY_NAME_AR,
  COMPANY_NAME_EN,
  PRODUCT_NAME,
  emailGreetingParts,
  emailWishParts,
  toneVisual,
  type EmailTone,
} from '@/lib/email-template';

export type WhatsAppDetail = {
  labelAr: string;
  labelEn: string;
  value: string;
};

export type WhatsAppDraft = {
  tone: EmailTone;
  recipientName?: string | null | undefined;
  titleAr: string;
  titleEn: string;
  introAr?: string | undefined;
  introEn?: string | undefined;
  linesAr?: readonly string[] | undefined;
  linesEn?: readonly string[] | undefined;
  details?: readonly WhatsAppDetail[] | undefined;
  linkLabelAr?: string | undefined;
  linkLabelEn?: string | undefined;
  link?: string | undefined;
};

export type WhatsAppRendered = {
  textAr: string;
  textEn: string;
  /** AR then EN in one shareable bubble (studio + deep links). */
  combined: string;
};

function bold(value: string): string {
  const clean = value.trim();
  return clean ? `*${clean}*` : '';
}

function bullets(details: readonly WhatsAppDetail[] | undefined, lang: 'ar' | 'en'): string[] {
  if (!details?.length) return [];
  return details
    .filter((item) => item.value.trim())
    .map((item) => {
      const label = lang === 'ar' ? item.labelAr : item.labelEn;
      return `• ${label}: ${item.value.trim()}`;
    });
}

function buildSide(draft: WhatsAppDraft, lang: 'ar' | 'en', options: { seed: string }): string {
  const visual = toneVisual(draft.tone);
  const greet = emailGreetingParts(draft.recipientName, options.seed);
  const wish = emailWishParts(draft.tone, options.seed);
  const title = lang === 'ar' ? draft.titleAr : draft.titleEn;
  const intro = lang === 'ar' ? draft.introAr : draft.introEn;
  const lines = lang === 'ar' ? draft.linesAr : draft.linesEn;
  const linkLabel = lang === 'ar' ? draft.linkLabelAr : draft.linkLabelEn;
  const brand =
    lang === 'ar' ? `${PRODUCT_NAME} · ${COMPANY_NAME_AR}` : `${PRODUCT_NAME} · ${COMPANY_NAME_EN}`;
  const badge = visual.badge.includes('·')
    ? lang === 'ar'
      ? visual.badge.split('·')[0]!.trim()
      : visual.badge.split('·')[1]!.trim()
    : visual.badge;

  const body: string[] = [
    `${visual.icon} ${bold(brand)}`,
    `${badge}`,
    '',
    lang === 'ar' ? greet.ar : greet.en,
    '',
    `${visual.icon} ${bold(title)}`,
  ];

  if (intro?.trim()) {
    body.push('', intro.trim());
  }
  for (const line of lines ?? []) {
    if (line.trim()) body.push(line.trim());
  }

  const detailLines = bullets(draft.details, lang);
  if (detailLines.length) {
    body.push('', ...detailLines);
  }

  if (draft.link?.trim()) {
    body.push('');
    body.push(`👉 ${linkLabel?.trim() || (lang === 'ar' ? 'افتح الرابط' : 'Open link')}:`);
    body.push(draft.link.trim());
  }

  body.push(
    '',
    `🌟 ${lang === 'ar' ? wish.wishAr : wish.wishEn}`,
    `✨ ${lang === 'ar' ? wish.sparkAr : wish.sparkEn}`,
    '',
    lang === 'ar'
      ? `مع أطيب التحيات من فريق ${PRODUCT_NAME} — ${COMPANY_NAME_AR} 🏠🔑🌴`
      : `Warm regards from the ${PRODUCT_NAME} team — ${COMPANY_NAME_EN} 🏠🔑🌴`,
    lang === 'ar'
      ? 'هذه رسالة آلية من منصتنا؛ لا تقلق، فهي لا تعضّ 🐾'
      : 'This is an automated message from our platform; don’t worry — it doesn’t bite 🐾',
  );

  return body
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Render AR + EN WhatsApp messages with rotating cheerful closings (stable per seed). */
export function renderWhatsAppMessage(
  draft: WhatsAppDraft,
  options: { seed: string },
): WhatsAppRendered {
  const textAr = buildSide(draft, 'ar', options);
  const textEn = buildSide(draft, 'en', options);
  const combined = `${textAr}\n\n————————\n\n${textEn}`;
  return { textAr, textEn, combined };
}
