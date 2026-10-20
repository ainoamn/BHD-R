/**
 * The one look every BHD R email shares: the company's logo and name, the recipient by name, the
 * details that matter, one clear button, and a warm, slightly cheeky wish to end on. Built from
 * tables and inline styles so it renders the same in Gmail, Outlook and phone mail apps.
 */

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
};

type ToneStyle = { icon: string; accent: string; soft: string; badge: string; wishes: string[] };

const TONES: Record<EmailTone, ToneStyle> = {
  maintenance: {
    icon: '🛠️',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الصيانة',
    wishes: [
      'نتمنى أن يعود كل شيء في بيتك يعمل كالساعة السويسرية… بل أدقّ قليلاً 🕰️',
      'نرجو أن تكون آخر مرة يزعجك فيها صنبور أو مكيّف هذا العام، وإن عاد فنحن أسرع منه 💨',
      'دمت في بيت هادئ لا يسمع فيه إلا صوت القهوة وهي تُصبّ ☕',
      'فنيّونا يحملون العُدّة، ونحن نحمل لك أطيب الأمنيات 🧰💚',
    ],
  },
  contract: {
    icon: '📜',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'العقود',
    wishes: [
      'عقدٌ موفق وبداية تستحق احتفالاً صغيراً… الكيك على حسابك هذه المرة 🎂',
      'نتمنى أن يكون هذا العقد أوضح من صباح مسقط في يناير ☀️',
      'توقيع واحد، وسنوات من راحة البال إن شاء الله ✍️🌿',
    ],
  },
  invoice: {
    icon: '🧾',
    accent: '#174b70',
    soft: '#eef3f9',
    badge: 'الفواتير',
    wishes: [
      'نتمنى أن تكون فواتيرك القادمة خفيفة كنسمة صلالة في الخريف 🍃',
      'الأرقام عندنا مرتبة، والدعاء لك بالبركة في الرزق أكثر ترتيباً 🤲',
      'سدادٌ ميسّر ومحفظة مبتسمة دائماً 😄💳',
    ],
  },
  arrears: {
    icon: '⏰',
    accent: '#c2410c',
    soft: '#fff3eb',
    badge: 'تذكير ودّي',
    wishes: [
      'نعرف أن الأيام تمضي أسرع من الإشعارات… تذكير لطيف منا ودعاء بأن يتيسر أمرك 🌤️',
      'لا عتب ولا ملامة، فقط فنجان قهوة افتراضي وتذكير صغير ☕🙂',
      'نتمنى لك رزقاً واسعاً يجعل هذه الرسائل نادرة كالمطر في الصيف 🌧️',
    ],
  },
  reminder: {
    icon: '🔔',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'تنبيه',
    wishes: [
      'تذكير صغير اليوم يوفّر عليك صداعاً كبيراً غداً 💡',
      'نحن نتذكر المواعيد عنك، فتفرّغ أنت لما يسعدك 🌸',
      'دمت منظماً ومطمئناً… والتقويم في صفّك دائماً 📅',
    ],
  },
  reward: {
    icon: '🏆',
    accent: '#b45309',
    soft: '#fff7e6',
    badge: 'المكافآت',
    wishes: [
      'ألف مبروك! استحققتها بجدارة، والمنصة كلها تصفق لك الآن 👏🎉',
      'نوصيك برفع رأسك قليلاً اليوم… فالإنجاز يليق بك 😎',
      'هذه الشارة تلمع، لكنها لا تلمع مثل التزامك ✨',
    ],
  },
  upgrade: {
    icon: '🚀',
    accent: '#7c3aed',
    soft: '#f3edff',
    badge: 'الترقيات',
    wishes: [
      'اربط الحزام، فحسابك انطلق للتو نحو مستوى جديد 🚀',
      'ترقية موفقة! أدوات أكثر، ووقت أطول لكوب الشاي 🍵',
      'نتمنى أن تحقق مع باقتك الجديدة أرقاماً تجعل جدول Excel يبتسم 📈',
    ],
  },
  booking: {
    icon: '🗝️',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الحجوزات',
    wishes: [
      'نتمنى لك إقامة أجمل من صور الإعلان نفسه 📸🌴',
      'المفتاح جاهز، والقهوة العمانية أجهز ☕🗝️',
      'حجز موفق وذكريات تستحق الحكاية 🌙',
    ],
  },
  listing: {
    icon: '🏡',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الإعلانات',
    wishes: [
      'نتمنى أن ينهال الطلب على عقارك كما ينهال الناس على الحلوى في العيد 🍬',
      'إعلانك الآن في الواجهة… ابتسم، فالعالم يراه 🌍✨',
      'مستأجر رائع في الطريق إليك إن شاء الله 🚪💚',
    ],
  },
  vacancy: {
    icon: '🏢',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'الشواغر',
    wishes: [
      'وحدة شاغرة اليوم، ومأهولة بأجمل المستأجرين غداً بإذن الله 🌱',
      'المساحة الفارغة مجرد فرصة ترتدي ثوب الانتظار 😉',
      'نتمنى أن يكون الشاغر القادم أقصر من استراحة القهوة ☕',
    ],
  },
  request: {
    icon: '📨',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الطلبات',
    wishes: [
      'وصلنا طلبك، ونتعامل معه بجدية… وببعض الابتسامة أيضاً 🙂',
      'كل طلب عندنا يحظى بمعاملة كبار الشخصيات 🎩',
      'نتمنى لك يوماً أسهل من تعبئة هذا النموذج 📝',
    ],
  },
  alert: {
    icon: '📣',
    accent: '#be123c',
    soft: '#fff0f3',
    badge: 'تنبيه مهم',
    wishes: [
      'خبر مهم، لكن لا داعي للقلق… نحن معك خطوة بخطوة 🤝',
      'تنبيه سريع ودعاء أسرع بأن يكون يومك هادئاً 🌤️',
    ],
  },
  team: {
    icon: '🤝',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'الفريق · Team',
    wishes: [
      'أهلاً بك في الفريق! نتمنى لك بداية موفقة… وقهوة ساخنة قبل أول مهمة ☕ · Welcome aboard — may your first day be smoother than a Muscat sunrise ☀️',
      'فريقك ينتظرك بابتسامة وصلاحيات مرتبة. Welcome to the crew — we’re glad you’re here 🤝',
      'بداية مليئة بالإنجازات… وقليل من الاجتماعات إن أمكن 😄 · Here’s to fewer meetings and more wins!',
    ],
  },
  legal: {
    icon: '⚖️',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'الشؤون القانونية',
    wishes: [
      'نتمنى أن تنتهي كل القضايا بالحسنى وأن يسود الوئام 🕊️',
      'الأوراق مرتبة، والحق واضح، والأمل كبير ⚖️',
    ],
  },
  deposit: {
    icon: '💰',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'التأمين',
    wishes: [
      'مالك في أمان، ونتمنى أن يعود إليك كاملاً ومعه ابتسامة 😊',
      'الحسابات صافية، والقلوب أصفى 💙',
    ],
  },
  general: {
    icon: '✨',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'إشعار',
    wishes: [
      'نتمنى لك يوماً جميلاً كطلعة شمس على جبال الحجر 🌄',
      'دمت بخير وسعادة… ولا تنس شرب الماء، فمسقط حارة 💧',
      'رسالة صغيرة ومعها أطيب الأمنيات بيوم رائع 🌟',
    ],
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

export function emailWish(tone: EmailTone, seed: string): string {
  const wishes = TONES[tone].wishes;
  return wishes[seedIndex(seed, wishes.length)]!;
}

export function emailGreeting(name: string | null | undefined): string {
  const clean = name?.trim();
  return clean ? `أهلاً ${clean} 👋` : 'أهلاً بك 👋';
}

/** Plain-text and HTML bodies for one branded email. `seed` keeps the wish stable on retries. */
export function renderBrandedEmail(
  input: BrandedEmailInput,
  options: { origin: string; seed: string },
): { text: string; html: string } {
  const tone = TONES[input.tone];
  const origin = options.origin.replace(/\/$/, '');
  const greeting = emailGreeting(input.recipientName);
  const wish = emailWish(input.tone, options.seed);
  const lines = (input.lines ?? []).filter((line) => line.trim());
  const details = (input.details ?? []).filter((item) => item.value.trim());

  const text = [
    greeting,
    '',
    `${tone.icon} ${input.title}`,
    ...(input.intro ? ['', input.intro] : []),
    ...(lines.length ? ['', ...lines] : []),
    ...(details.length ? ['', ...details.map((item) => `• ${item.label}: ${item.value}`)] : []),
    ...(input.cta ? ['', `${input.cta.label}: ${input.cta.url}`] : []),
    '',
    wish,
    '',
    `مع أطيب التحيات،`,
    `فريق ${PRODUCT_NAME} — ${COMPANY_NAME_AR}`,
    origin,
    ...(input.footnote ? ['', input.footnote] : []),
  ].join('\n');

  const detailRows = details
    .map(
      (item, index) => `<tr>
        <td style="padding:10px 14px;background:${index % 2 ? '#ffffff' : '#f7fafb'};color:#5b6b7a;font-size:13px;white-space:nowrap;border-bottom:1px solid #edf1f4">${detailIcon(item.label)}&nbsp; ${escape(item.label)}</td>
        <td style="padding:10px 14px;background:${index % 2 ? '#ffffff' : '#f7fafb'};color:#10243a;font-size:14px;font-weight:600;border-bottom:1px solid #edf1f4">${escape(item.value)}</td>
      </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(input.title)}</title></head>
<body style="margin:0;padding:0;background:#eef5f5">
<div ${BRANDED_MARK} dir="rtl" style="background:#eef5f5;padding:24px 10px;font-family:Tahoma,'Segoe UI',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(input.intro ?? input.title)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;border-collapse:separate">
    <tr><td style="background:linear-gradient(135deg,#08a39f,#174b70);background-color:#0b8f8a;border-radius:20px 20px 0 0;padding:4px"></td></tr>
    <tr><td style="background:#ffffff;padding:22px 26px 6px;text-align:center">
      <a href="${escape(origin)}" style="text-decoration:none"><img src="${escape(origin)}/brand/bhd-email-logo.png" width="150" height="47" alt="BHD" style="display:inline-block;border:0;width:150px;height:auto"></a>
      <div style="margin-top:8px;color:#174b70;font-size:14px;font-weight:700;letter-spacing:.2px">${COMPANY_NAME_AR}</div>
      <div style="color:#8a99a8;font-size:11px;letter-spacing:1.5px">${PRODUCT_NAME} · ${COMPANY_NAME_EN}</div>
    </td></tr>
    <tr><td style="background:#ffffff;padding:18px 26px 0;text-align:center">
      <div style="display:inline-block;width:76px;height:76px;line-height:76px;border-radius:50%;background:${tone.soft};font-size:38px">${tone.icon}</div>
      <div style="margin-top:10px"><span style="display:inline-block;background:${tone.soft};color:${tone.accent};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:700">${escape(tone.badge)}</span></div>
      <h1 style="margin:12px 0 4px;color:#10243a;font-size:21px;line-height:1.5">${escape(input.title)}</h1>
    </td></tr>
    <tr><td style="background:#ffffff;padding:8px 30px 4px;color:#24384d;font-size:15px;line-height:1.9;text-align:right">
      <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#10243a">${escape(greeting)}</p>
      ${input.intro ? `<p style="margin:0 0 10px">${escape(input.intro)}</p>` : ''}
      ${lines.map((line) => `<p style="margin:0 0 10px">${escape(line)}</p>`).join('')}
    </td></tr>
    ${
      detailRows
        ? `<tr><td style="background:#ffffff;padding:6px 26px 4px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e3eaef;border-radius:14px;overflow:hidden;border-collapse:separate">${detailRows}</table>
    </td></tr>`
        : ''
    }
    ${
      input.cta
        ? `<tr><td style="background:#ffffff;padding:18px 26px 6px;text-align:center">
      <a href="${escape(input.cta.url)}" style="display:inline-block;background:${tone.accent};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:12px">${escape(input.cta.label)} ←</a>
    </td></tr>`
        : ''
    }
    <tr><td style="background:#ffffff;padding:18px 26px 22px">
      <div style="background:${tone.soft};border-radius:14px;padding:14px 16px;color:#24384d;font-size:14px;line-height:1.8;text-align:center">🌟 ${escape(wish)}</div>
    </td></tr>
    <tr><td style="background:#f7fafb;border-top:1px solid #e3eaef;border-radius:0 0 20px 20px;padding:16px 26px;text-align:center;color:#6b7c8d;font-size:12px;line-height:1.8">
      <div style="font-size:18px;letter-spacing:6px">🏠 🔑 🌴</div>
      <div>مع أطيب التحيات من فريق <b style="color:#174b70">${PRODUCT_NAME}</b> — ${COMPANY_NAME_AR}</div>
      ${input.footnote ? `<div style="margin-top:6px">${escape(input.footnote)}</div>` : ''}
      <div style="margin-top:6px">هذه رسالة آلية من منصتنا؛ لا تقلق، فهي لا تعضّ 🐾 · <a href="${escape(origin)}" style="color:#0b8f8a">${escape(origin.replace(/^https?:\/\//, ''))}</a></div>
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
