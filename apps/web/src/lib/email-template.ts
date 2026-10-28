/**
 * The one look every BHD R email shares: the company's logo and name, the recipient by name, the
 * details that matter, one clear button, and a warm, slightly cheeky wish to end on. Built from
 * tables and inline styles so it renders the same in Gmail, Outlook and phone mail apps.
 */

import {
  DEFAULT_EMAIL_GREETINGS_ANON,
  DEFAULT_EMAIL_GREETINGS_NAMED,
  DEFAULT_EMAIL_SPARKS,
  DEFAULT_EMAIL_WISHES,
} from '@/lib/email-wish-defaults';

export const COMPANY_NAME_AR = 'شركة بن حمود للتطوير';
export const COMPANY_NAME_EN = 'Bin Hamood Development';
export const PRODUCT_NAME = 'BHD R';
/** Marks HTML that already carries the branded frame, so the dispatcher never wraps it twice. */
export const BRANDED_MARK = 'data-bhd-mail="1"';

export type EmailTone =
  | 'maintenance'
  | 'contract'
  | 'invoice'
  | 'arrears'
  | 'reminder'
  | 'reward'
  | 'upgrade'
  | 'booking'
  | 'listing'
  | 'vacancy'
  | 'request'
  | 'alert'
  | 'team'
  | 'legal'
  | 'deposit'
  | 'general';

export type EmailDetail = { label: string; value: string };

export type BrandedEmailInput = {
  tone: EmailTone;
  recipientName?: string | null | undefined;
  title: string;
  intro?: string | undefined;
  lines?: readonly string[] | undefined;
  details?: readonly EmailDetail[] | undefined;
  cta?: { label: string; url: string } | undefined;
  /** Small print under the button, e.g. why they got this email. */
  footnote?: string | undefined;
  /** Absolute https URL of a hero image (e.g. greeting card); never a data: URL. */
  heroImageUrl?: string | undefined;
  /**
   * When true, append rotating wish/spark lines. Defaults from `emailToneUsesWarmClosing`.
   * Keep false for OTP, money, contracts, legal, cancellations.
   */
  warmClosing?: boolean | undefined;
};

/** Friendly wish banner + light footer — only for non-sensitive notifications. */
export function emailToneUsesWarmClosing(tone: EmailTone): boolean {
  switch (tone) {
    case 'team':
    case 'booking':
    case 'listing':
    case 'reward':
    case 'upgrade':
    case 'vacancy':
    case 'general':
      return true;
    default:
      return false;
  }
}

type ToneStyle = { icon: string; accent: string; soft: string; badge: string };

export function toneVisual(tone: EmailTone): {
  icon: string;
  accent: string;
  soft: string;
  badge: string;
} {
  const style = TONES[tone];
  return { icon: style.icon, accent: style.accent, soft: style.soft, badge: style.badge };
}

/**
 * Tone chrome for branded emails. Wish lines live in `email-wish-defaults`
 * (Arabic · English with icons) so the admin page and mail share one library.
 */
const TONES: Record<EmailTone, ToneStyle> = {
  maintenance: {
    icon: '🛠️',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الصيانة · Maintenance',
  },
  contract: {
    icon: '📜',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'العقود · Contracts',
  },
  invoice: {
    icon: '🧾',
    accent: '#174b70',
    soft: '#eef3f9',
    badge: 'الفواتير · Invoices',
  },
  arrears: {
    icon: '⏰',
    accent: '#c2410c',
    soft: '#fff3eb',
    badge: 'تذكير ودّي · Gentle reminder',
  },
  reminder: {
    icon: '🔔',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'تنبيه · Reminder',
  },
  reward: {
    icon: '🏆',
    accent: '#b45309',
    soft: '#fff7e6',
    badge: 'المكافآت · Rewards',
  },
  upgrade: {
    icon: '🚀',
    accent: '#7c3aed',
    soft: '#f3edff',
    badge: 'الترقيات · Upgrades',
  },
  booking: {
    icon: '🗝️',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الحجوزات · Bookings',
  },
  listing: {
    icon: '🏡',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الإعلانات · Listings',
  },
  vacancy: {
    icon: '🏢',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'الشواغر · Vacancies',
  },
  request: {
    icon: '📨',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الطلبات · Requests',
  },
  alert: {
    icon: '📣',
    accent: '#be123c',
    soft: '#fff0f3',
    badge: 'تنبيه مهم · Important',
  },
  team: {
    icon: '🤝',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'الفريق · Team',
  },
  legal: {
    icon: '⚖️',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'الشؤون القانونية · Legal',
  },
  deposit: {
    icon: '💰',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'التأمين · Deposit',
  },
  general: {
    icon: '✨',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'إشعار · Notice',
  },
};

const DETAIL_ICONS: Array<[RegExp, string]> = [
  [/مبلغ|قيمة|تكلفة|المتأخر|الإجمالي|السعر|القسط/, '💵'],
  [/تاريخ|موعد|يستحق|حتى|البداية|النهاية/, '📅'],
  [/عقار|مبنى|وحدة|الموقع/, '🏠'],
  [/رقم|مرجع|فاتورة/, '#️⃣'],
  [/حالة|المرحلة/, '📌'],
  [/مستأجر|المالك|العميل|الضيف|الاسم|الموظف/, '👤'],
];

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function seedIndex(seed: string, length: number): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return length ? hash % length : 0;
}

function detailIcon(label: string): string {
  return DETAIL_ICONS.find(([pattern]) => pattern.test(label))?.[1] ?? '🔹';
}

/** Split a bilingual “Arabic · English” (or reversed) line into language halves. */
export function splitBilingualLine(line: string): { ar: string; en: string } {
  const parts = line.split(' · ');
  if (parts.length < 2) return { ar: line, en: line };
  const left = parts[0]!.trim();
  const right = parts.slice(1).join(' · ').trim();
  const leftAr = /[\u0600-\u06FF]/.test(left);
  const rightAr = /[\u0600-\u06FF]/.test(right);
  if (leftAr && !rightAr) return { ar: left, en: right };
  if (rightAr && !leftAr) return { ar: right, en: left };
  return { ar: left, en: right };
}

/** Optional admin overrides (platform_settings) — hydrated on the server before send/preview. */
export type EmailWishPoolOverride = {
  wishes?: Partial<Record<EmailTone, string[]>>;
  sparks?: string[];
  greetingsNamed?: string[];
  greetingsAnon?: string[];
};

let wishPoolOverride: EmailWishPoolOverride | null = null;

export function setEmailWishPoolOverride(next: EmailWishPoolOverride | null): void {
  wishPoolOverride = next;
}

export function getEmailWishPoolOverride(): EmailWishPoolOverride | null {
  return wishPoolOverride;
}

export function defaultWishLines(tone: EmailTone): readonly string[] {
  return DEFAULT_EMAIL_WISHES[tone];
}

export function defaultSparkLines(): readonly string[] {
  return DEFAULT_EMAIL_SPARKS;
}

export function defaultGreetingNamedTemplates(): readonly string[] {
  return DEFAULT_EMAIL_GREETINGS_NAMED;
}

export function defaultGreetingAnonLines(): readonly string[] {
  return DEFAULT_EMAIL_GREETINGS_ANON;
}

function wishLines(tone: EmailTone): readonly string[] {
  const custom = wishPoolOverride?.wishes?.[tone];
  return custom?.length ? custom : DEFAULT_EMAIL_WISHES[tone];
}

function sparkLines(): readonly string[] {
  const custom = wishPoolOverride?.sparks;
  return custom?.length ? custom : DEFAULT_EMAIL_SPARKS;
}

function greetingNamedTemplates(): readonly string[] {
  const custom = wishPoolOverride?.greetingsNamed;
  return custom?.length ? custom : DEFAULT_EMAIL_GREETINGS_NAMED;
}

function greetingAnonLines(): readonly string[] {
  const custom = wishPoolOverride?.greetingsAnon;
  return custom?.length ? custom : DEFAULT_EMAIL_GREETINGS_ANON;
}

/** Tone wish + rotating spark; stable for the same seed (retries), varied across messages. */
export function emailWish(tone: EmailTone, seed: string): string {
  const wishes = wishLines(tone);
  const wish = wishes[seedIndex(seed, wishes.length)]!;
  const sparks = sparkLines();
  const spark = sparks[seedIndex(`${seed}:spark`, sparks.length)]!;
  return `${wish}\n${spark}`;
}

/** Same pool as emailWish, split so WhatsApp can send AR and EN cleanly. */
export function emailWishParts(
  tone: EmailTone,
  seed: string,
): { wishAr: string; wishEn: string; sparkAr: string; sparkEn: string } {
  const wishes = wishLines(tone);
  const wish = splitBilingualLine(wishes[seedIndex(seed, wishes.length)]!);
  const sparks = sparkLines();
  const spark = splitBilingualLine(sparks[seedIndex(`${seed}:spark`, sparks.length)]!);
  return { wishAr: wish.ar, wishEn: wish.en, sparkAr: spark.ar, sparkEn: spark.en };
}

export function emailGreeting(name: string | null | undefined, seed = 'greet'): string {
  const clean = name?.trim();
  if (clean) {
    const templates = greetingNamedTemplates();
    const greet = templates[seedIndex(`${seed}:hi`, templates.length)]!;
    return greet.includes('{name}') ? greet.replaceAll('{name}', clean) : `${greet} ${clean}`;
  }
  const anon = greetingAnonLines();
  return anon[seedIndex(`${seed}:hi`, anon.length)]!;
}

/** Greeting halves for channel-specific copy (WhatsApp AR / EN bubbles). */
export function emailGreetingParts(
  name: string | null | undefined,
  seed = 'greet',
): { ar: string; en: string } {
  return splitBilingualLine(emailGreeting(name, seed));
}

/** How many rotating lines a tone carries (studio / docs). */
export function emailWishPoolSize(tone: EmailTone): number {
  return wishLines(tone).length * sparkLines().length;
}

export const EMAIL_TONES = Object.keys(TONES) as EmailTone[];

/** Plain-text and HTML bodies for one branded email. `seed` keeps the wish stable on retries. */
export function renderBrandedEmail(
  input: BrandedEmailInput,
  options: { origin: string; seed: string },
): { text: string; html: string } {
  const tone = TONES[input.tone];
  const origin = options.origin.replace(/\/$/, '');
  const greeting = emailGreeting(input.recipientName, options.seed);
  const warm = input.warmClosing ?? emailToneUsesWarmClosing(input.tone);
  const wish = warm ? emailWish(input.tone, options.seed) : '';
  const wishHtml = wish ? escape(wish).replaceAll('\n', '<br>') : '';
  const lines = (input.lines ?? []).filter((line) => line.trim());
  const details = (input.details ?? []).filter((item) => item.value.trim());
  const autoNoteAr = 'هذه رسالة آلية من منصة BHD R.';
  const autoNoteEn = 'This is an automated message from the BHD R platform.';

  const text = [
    greeting,
    '',
    `${tone.icon} ${input.title}`,
    ...(input.intro ? ['', input.intro] : []),
    ...(lines.length ? ['', ...lines] : []),
    ...(details.length ? ['', ...details.map((item) => `• ${item.label}: ${item.value}`)] : []),
    ...(input.cta ? ['', `${input.cta.label}: ${input.cta.url}`] : []),
    ...(wish ? ['', wish] : []),
    '',
    `مع أطيب التحيات من فريق ${PRODUCT_NAME} — ${COMPANY_NAME_AR}`,
    `Warm regards from the ${PRODUCT_NAME} team — ${COMPANY_NAME_EN}`,
    origin,
    ...(input.footnote
      ? [
          '',
          ...input.footnote
            .split(/\s*·\s*/)
            .map((part) => part.trim())
            .filter(Boolean),
        ]
      : []),
    '',
    autoNoteAr,
    autoNoteEn,
  ].join('\n');

  // Stacked label→value rows (no nowrap / no side-by-side) so Gmail/Outlook/phone never clip text.
  const detailRows = details
    .map((item, index) => {
      const bg = index % 2 ? '#ffffff' : '#f7fafb';
      const bottom = index === details.length - 1 ? '0' : '1px solid #edf1f4';
      return `<tr>
        <td style="padding:12px 14px;background:${bg};border-bottom:${bottom};word-break:break-word;overflow-wrap:anywhere">
          <div style="color:#5b6b7a;font-size:12px;line-height:1.45;margin:0 0 4px">${detailIcon(item.label)}&nbsp; ${escape(item.label)}</div>
          <div style="color:#10243a;font-size:15px;font-weight:700;line-height:1.55;margin:0">${escape(item.value)}</div>
        </td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="x-apple-disable-message-reformatting">
<title>${escape(input.title)}</title>
<style>
  html,body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table,td{border-collapse:collapse}
  img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;max-width:100%;height:auto}
  a{word-break:break-word}
  .bhd-wrap{width:100%!important;max-width:600px!important}
  .bhd-pad{padding-left:16px!important;padding-right:16px!important}
  .bhd-title{font-size:20px!important;line-height:1.45!important;word-break:break-word}
  .bhd-body{font-size:15px!important;line-height:1.75!important;word-break:break-word;overflow-wrap:anywhere}
  .bhd-cta a{display:block!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;text-align:center!important}
  @media only screen and (max-width:620px){
    .bhd-shell{padding:12px 6px!important}
    .bhd-pad{padding-left:14px!important;padding-right:14px!important}
    .bhd-title{font-size:18px!important}
    .bhd-icon{width:64px!important;height:64px!important;line-height:64px!important;font-size:32px!important}
  }
</style>
<!--[if mso]><style>table,td{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#eef5f5;width:100%">
<div ${BRANDED_MARK} class="bhd-shell" dir="rtl" style="background:#eef5f5;padding:20px 8px;font-family:Tahoma,'Segoe UI',Arial,sans-serif;width:100%;box-sizing:border-box">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escape(input.intro ?? input.title)}</div>
  <table role="presentation" class="bhd-wrap" width="100%" cellspacing="0" cellpadding="0" align="center" style="width:100%;max-width:600px;margin:0 auto;border-collapse:separate">
    <tr><td style="background:linear-gradient(135deg,#08a39f,#174b70);background-color:#0b8f8a;border-radius:18px 18px 0 0;padding:4px"></td></tr>
    <tr><td class="bhd-pad" style="background:#ffffff;padding:18px 16px 6px;text-align:center">
      <a href="${escape(origin)}" style="text-decoration:none"><img src="${escape(origin)}/brand/bhd-email-logo.png" width="140" height="44" alt="BHD" style="display:inline-block;border:0;width:140px;max-width:70%;height:auto"></a>
      <div style="margin-top:8px;color:#174b70;font-size:13px;font-weight:700;letter-spacing:.2px;word-break:break-word">${COMPANY_NAME_AR}</div>
      <div style="color:#8a99a8;font-size:11px;letter-spacing:1px;word-break:break-word">${PRODUCT_NAME} · ${COMPANY_NAME_EN}</div>
    </td></tr>
    <tr><td class="bhd-pad" style="background:#ffffff;padding:14px 16px 0;text-align:center">
      ${
        input.heroImageUrl && /^https:\/\//i.test(input.heroImageUrl)
          ? `<a href="${escape(input.heroImageUrl)}" style="display:block;text-decoration:none">
        <img src="${escape(input.heroImageUrl)}" alt="${escape(input.title)}" width="568" style="display:block;width:100%;max-width:568px;height:auto;margin:0 auto 12px;border:0;border-radius:16px">
      </a>`
          : `<div class="bhd-icon" style="display:inline-block;width:72px;height:72px;line-height:72px;border-radius:50%;background:${tone.soft};font-size:36px">${tone.icon}</div>
      <div style="margin-top:10px"><span style="display:inline-block;background:${tone.soft};color:${tone.accent};border-radius:999px;padding:4px 12px;font-size:11px;font-weight:700;line-height:1.4;max-width:100%;box-sizing:border-box;word-break:break-word">${escape(tone.badge)}</span></div>`
      }
      <h1 class="bhd-title" style="margin:12px 0 4px;color:#10243a;font-size:20px;line-height:1.45;font-weight:700;word-break:break-word;overflow-wrap:anywhere">${escape(input.title)}</h1>
    </td></tr>
    <tr><td class="bhd-pad bhd-body" style="background:#ffffff;padding:8px 16px 4px;color:#24384d;font-size:15px;line-height:1.75;text-align:right;word-break:break-word;overflow-wrap:anywhere">
      <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#10243a;word-break:break-word">${escape(greeting)}</p>
      ${input.intro ? `<p style="margin:0 0 10px;word-break:break-word;overflow-wrap:anywhere">${escape(input.intro)}</p>` : ''}
      ${lines.map((line) => `<p style="margin:0 0 10px;word-break:break-word;overflow-wrap:anywhere">${escape(line)}</p>`).join('')}
    </td></tr>
    ${
      detailRows
        ? `<tr><td class="bhd-pad" style="background:#ffffff;padding:6px 16px 4px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #e3eaef;border-radius:14px;overflow:hidden;border-collapse:separate">${detailRows}</table>
    </td></tr>`
        : ''
    }
    ${
      input.cta
        ? `<tr><td class="bhd-pad bhd-cta" style="background:#ffffff;padding:16px 16px 6px;text-align:center">
      <a href="${escape(input.cta.url)}" style="display:block;width:100%;box-sizing:border-box;background:${tone.accent};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;line-height:1.4;padding:14px 16px;border-radius:12px;word-break:break-word">${escape(input.cta.label)} ←</a>
    </td></tr>`
        : ''
    }
    ${
      wishHtml
        ? `<tr><td class="bhd-pad" style="background:#ffffff;padding:16px 16px 8px">
      <div style="background:${tone.soft};border-radius:14px;padding:14px 14px;color:#24384d;font-size:13px;line-height:1.8;text-align:center;word-break:break-word;overflow-wrap:anywhere">${wishHtml}</div>
    </td></tr>`
        : ''
    }
    <tr><td class="bhd-pad" style="background:#f7fafb;border-top:1px solid #e3eaef;border-radius:0 0 18px 18px;padding:14px 16px;text-align:center;color:#6b7c8d;font-size:12px;line-height:1.75;word-break:break-word;overflow-wrap:anywhere">
      ${warm ? `<div style="font-size:16px;letter-spacing:4px;margin-bottom:4px">🏠</div>` : ''}
      <div>مع أطيب التحيات من فريق <b style="color:#174b70">${PRODUCT_NAME}</b> — ${COMPANY_NAME_AR}</div>
      <div style="margin-top:2px;color:#8a99a8">Warm regards from the <b style="color:#174b70">${PRODUCT_NAME}</b> team — ${COMPANY_NAME_EN}</div>
      ${
        input.footnote
          ? input.footnote
              .split(/\s*·\s*/)
              .map((part) => part.trim())
              .filter(Boolean)
              .map(
                (part) => `<div style="margin-top:6px;word-break:break-word">${escape(part)}</div>`,
              )
              .join('')
          : ''
      }
      <div style="margin-top:8px">${autoNoteAr}</div>
      <div style="color:#8a99a8">${autoNoteEn}</div>
      <div style="margin-top:6px"><a href="${escape(origin)}" style="color:#0b8f8a;word-break:break-all">${escape(origin.replace(/^https?:\/\//, ''))}</a></div>
    </td></tr>
  </table>
</div>
</body>
</html>`;

  return { text, html };
}

/**
 * Puts an email written before the shared look into the branded frame: its own HTML (or its text,
 * paragraph by paragraph) becomes the body, under the logo and above the wish.
 */
export function wrapLegacyEmail(
  message: { subject: string; text: string; html?: string | undefined },
  options: { origin: string; seed: string },
): string {
  if (message.html?.includes(BRANDED_MARK)) return message.html;
  const shell = renderBrandedEmail(
    { tone: 'general', title: message.subject, recipientName: null },
    options,
  ).html;
  const body = message.html
    ? message.html
    : message.text
        .split(/\n{2,}/)
        .map((block) => `<p style="margin:0 0 10px">${escape(block).replaceAll('\n', '<br>')}</p>`)
        .join('');
  const greeting = `<p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#10243a">${escape(emailGreeting(null))}</p>`;
  return shell.replace(greeting, () => `<div style="text-align:right">${body}</div>`);
}
