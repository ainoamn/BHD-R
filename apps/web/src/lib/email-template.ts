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
  /** Absolute https URL of a hero image (e.g. greeting card); never a data: URL. */
  heroImageUrl?: string | undefined;
};

type ToneStyle = { icon: string; accent: string; soft: string; badge: string; wishes: string[] };

export function toneVisual(tone: EmailTone): { icon: string; accent: string; soft: string; badge: string } {
  const style = TONES[tone];
  return { icon: style.icon, accent: style.accent, soft: style.soft, badge: style.badge };
}

/**
 * Tone-matched cheerful lines (Arabic · English). Picked per message from the seed so retries
 * stay stable, while different notifications keep rotating through the pool.
 */
const TONES: Record<EmailTone, ToneStyle> = {
  maintenance: {
    icon: '🛠️',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الصيانة · Maintenance',
    wishes: [
      'نتمنى أن يعود كل شيء يعمل كالساعة… بل أدقّ قليلاً 🕰️ · May everything run smoother than a Swiss watch.',
      'صنبور اليوم، راحة الغد — ونحن أسرع من التسريب 💨 · Today’s fix, tomorrow’s quiet home.',
      'بيت هادئ لا يسمع فيه إلا صوت القهوة ☕ · A calm home deserves a calm coffee.',
      'فنيّونا بالعُدّة، ونحن بالأماني 🧰💚 · Tools in hand, good wishes in the other.',
      'عطل صغير لن يسرق يومك — وعدنا 💪 · A small glitch won’t steal your day.',
      'بعد الإصلاح: ابتسامة أوسع من الممر 😊 · After the fix: a hallway-wide smile.',
      'الصيانة فنّ… والهدوء هو اللوحة 🎨 · Maintenance is craft; calm is the artwork.',
      'ارجع لحياتك؛ نحن نتكفّل بالباقي 🛠️ · Back to your day — we’ve got the rest.',
    ],
  },
  contract: {
    icon: '📜',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'العقود · Contracts',
    wishes: [
      'عقد موفق وبداية تستحق كعكة صغيرة 🎂 · A solid contract deserves a small celebration.',
      'أوضح من صباح مسقط في يناير ☀️ · Clearer than a crisp Muscat morning.',
      'توقيع واحد… وراحة بال طويلة ✍️🌿 · One signature, long peace of mind.',
      'الورقة جاهزة؛ والخطوة الجريئة لك 🚀 · The paper is ready — the bold step is yours.',
      'اتفاق عادل يفتح أبواباً أجمل 🚪✨ · A fair deal opens brighter doors.',
      'بالتوفيق في فصل جديد من قصتك 📖 · Good luck with this new chapter.',
      'الوضوح اليوم يوفر الجدال غداً 💡 · Clarity today saves debates tomorrow.',
      'مرحى للثقة المتبادلة — أجمل بند في أي عقد 🤝 · Here’s to mutual trust — the best clause.',
    ],
  },
  invoice: {
    icon: '🧾',
    accent: '#174b70',
    soft: '#eef3f9',
    badge: 'الفواتير · Invoices',
    wishes: [
      'فواتير خفيفة كنسمة صلالة 🍃 · May your invoices stay as light as a Salalah breeze.',
      'الأرقام مرتبة، والبركة أرتب 🤲 · Numbers tidy; blessings tidier.',
      'سداد ميسّر ومحفظة مبتسمة 😄💳 · Easy settling, smiling wallet.',
      'كل ريال في مكانه… وكل همّ بعيداً 📊 · Every rial in place; every worry out of place.',
      'شفافية الحساب راحة للخاطر 💎 · Clear accounts, clearer minds.',
      'دفعة اليوم = راحة الأسبوع ☕ · Pay today, rest easier this week.',
      'نرتّب الأرقام؛ فترتّب أنت يومك 🗓️ · We sort the figures so you can sort your day.',
      'بارك الله في رزقك… وحساباتك أيضاً 🌟 · Blessings on your income — and your ledger.',
    ],
  },
  arrears: {
    icon: '⏰',
    accent: '#c2410c',
    soft: '#fff3eb',
    badge: 'تذكير ودّي · Gentle reminder',
    wishes: [
      'تذكير لطيف ودعاء بأن يتيسر الأمر 🌤️ · A soft nudge and a wish that things ease up.',
      'لا عتب… فقط قهوة افتراضية وتذكير صغير ☕🙂 · No blame — just virtual coffee and a note.',
      'رزق واسع يجعل هذه الرسائل نادرة 🌧️ · Wide provision that makes these notes rare.',
      'نذكّرك بلطف لأننا نريدك مرتاحاً 💛 · We remind gently because we want you at ease.',
      'خطوة صغيرة اليوم تُنهي الهمّ كله 🚶 · One small step today clears the whole worry.',
      'أنت أهم من الرقم… والرقم له حل 🤝 · You’re bigger than the number — and numbers have solutions.',
      'نثق أن الأمر سيتيسر قريباً إن شاء الله 🤲 · Trusting it will ease soon, God willing.',
      'رسالة ودّية لا أكثر… ويوم ألطف بإذن الله 🌸 · Just a kind message — and a kinder day ahead.',
    ],
  },
  reminder: {
    icon: '🔔',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'تنبيه · Reminder',
    wishes: [
      'تذكير صغير اليوم يوفّر صداعاً كبيراً غداً 💡 · A small reminder today saves a big headache tomorrow.',
      'نتذكر عنك؛ فاستمتع بما يسعدك 🌸 · We remember for you — enjoy what lifts you.',
      'منظّم ومطمئن… والتقويم في صفّك 📅 · Stay organized; the calendar is on your side.',
      'موعد محفوظ = يوم أخف 🎈 · A saved date is a lighter day.',
      'أنت مشغول بالأجمل؛ نحن نحرس التفاصيل 👀 · You chase the bright stuff; we guard the details.',
      'دقّة لطيفة… بلا ضغط زائد ⏱️ · Gentle precision, zero extra stress.',
      'التذكير خدمة، لا إزعاج — وعدنا 🙂 · Reminding is a service, not a nuisance.',
      'خطوة الآن… وطمأنينة لاحقاً 💚 · Act now; breathe easier later.',
    ],
  },
  reward: {
    icon: '🏆',
    accent: '#b45309',
    soft: '#fff7e6',
    badge: 'المكافآت · Rewards',
    wishes: [
      'ألف مبروك! استحققتها بجدارة 👏🎉 · Huge congratulations — you earned this.',
      'ارفع رأسك قليلاً… الإنجاز يليق بك 😎 · Chin up — this win suits you.',
      'الشارة تلمع، والتزامك ألمع ✨ · The badge shines; your consistency shines brighter.',
      'هذا ليس حظاً… هذا عمل 💼🌟 · Not luck — that’s work paying off.',
      'احتفل قليلاً؛ فأنت تستحق 🥳 · Celebrate a little — you deserve it.',
      'كل نجمة تُضاف لأنك ثبّت المعيار عالياً ⭐ · Every star lands because you set the bar high.',
      'نجاح اليوم وقود غدٍ أجمل 🚀 · Today’s win fuels a brighter tomorrow.',
      'نحن فخورون… وأنت أولى بالفخر 🧡 · We’re proud — and you should be prouder.',
    ],
  },
  upgrade: {
    icon: '🚀',
    accent: '#7c3aed',
    soft: '#f3edff',
    badge: 'الترقيات · Upgrades',
    wishes: [
      'اربط الحزام… مستواك الجديد انطلق 🚀 · Buckle up — your new level just launched.',
      'أدوات أكثر ووقت أطول للشاي 🍵 · More tools, more time for tea.',
      'أرقام تجعل الجداول تبتسم 📈 · Numbers that make spreadsheets smile.',
      'ترقية = ثقة أكبر في خطوتك التالية 💪 · An upgrade is confidence for the next move.',
      'السقف ارتفع… والرؤية أوضح 🔭 · The ceiling rose; the view got clearer.',
      'مرحى للنمو الهادئ والذكي 🌱 · Here’s to quiet, smart growth.',
      'باقة أوسع لأحلام أوسع ✨ · A wider plan for wider dreams.',
      'أنت تستحق أدوات تليق بطموحك 🛠️ · You deserve tools that match your ambition.',
    ],
  },
  booking: {
    icon: '🗝️',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الحجوزات · Bookings',
    wishes: [
      'إقامة أجمل من صور الإعلان 📸🌴 · A stay prettier than the listing photos.',
      'المفتاح جاهز والقهوة العمانية أجهز ☕🗝️ · Key ready; Omani coffee readier.',
      'حجز موفق وذكريات تستحق الحكاية 🌙 · A good booking and stories worth telling.',
      'مرحباً بك… البيت يبتسم لوصولك 🏠😊 · Welcome — the place smiles at your arrival.',
      'راحة البال هي أفضل وسائل الراحة 🛋️ · Peace of mind is the best amenity.',
      'نتمنى لك ليالي هادئة وأياماً خفيفة 🌠 · Quiet nights and easy days ahead.',
      'استمتع؛ والتفاصيل علينا 🧭 · Enjoy — details are on us.',
      'رحلة قصيرة أو إقامة طويلة… بالتوفيق دائماً 🧳 · Short trip or long stay — always good luck.',
    ],
  },
  listing: {
    icon: '🏡',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الإعلانات · Listings',
    wishes: [
      'طلبات كالحلوى في العيد 🍬 · May enquiries pour in like Eid sweets.',
      'إعلانك في الواجهة… والعالم يراك 🌍✨ · Your listing is front and center.',
      'مستأجر رائع في الطريق إن شاء الله 🚪💚 · A great tenant is on the way, God willing.',
      'عقارك يستحق من يقدّره كما تفعل أنت 💎 · Your property deserves someone who values it.',
      'الظهور الجيد بداية الحجز الجيد 📣 · Good visibility starts good bookings.',
      'ابتسم… صورتك الأولى تعمل الآن 📷 · Smile — your first photo is already working.',
      'سوق نشيط وقلب مرتاح 💚 · A lively market and a calm heart.',
      'كل مشاهدة خطوة أقرب للمستأجر المناسب 👣 · Every view is a step toward the right tenant.',
    ],
  },
  vacancy: {
    icon: '🏢',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'الشواغر · Vacancies',
    wishes: [
      'شاغرة اليوم… ومأهولة غداً بإذن الله 🌱 · Vacant today, filled tomorrow God willing.',
      'الفراغ فرصة بثوب الانتظار 😉 · Empty space is opportunity in waiting clothes.',
      'ليكن الشاغر أقصر من استراحة القهوة ☕ · May the vacancy be shorter than a coffee break.',
      'الوحدة تنتظر شخصاً يستحقها 🔑 · The unit is waiting for someone who deserves it.',
      'كل يوم شواغر هو يوم اقتراب 🌅 · Every vacant day is a day closer to filled.',
      'نحن نجهّز المسرح؛ والضيف قادم 🎭 · We’re setting the stage; the guest is coming.',
      'لا قلق… الحركة تعود دائماً 🔄 · No worry — momentum always returns.',
      'صبر جميل… ونتيجة أجمل قريباً 🌷 · Beautiful patience; a finer result soon.',
    ],
  },
  request: {
    icon: '📨',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'الطلبات · Requests',
    wishes: [
      'وصلنا طلبك… بجدية وابتسامة 🙂 · We got your request — serious and smiling.',
      'معاملة كبار الشخصيات لكل طلب 🎩 · VIP care for every request.',
      'يوماً أسهل من تعبئة النماذج 📝 · A day easier than filling forms.',
      'صوتك مسموع… ونعمل عليه الآن 👂 · Your voice is heard; we’re on it.',
      'طلب واضح = حل أوضح 🔍 · A clear ask makes a clearer fix.',
      'شكراً لثقتك؛ سنردّها عملاً 💚 · Thanks for the trust — we’ll repay it in action.',
      'لا تقلق من المتابعة؛ نحن هنا 🛎️ · Don’t worry about follow-up — we’re here.',
      'كل رسالة تقرّبنا من حل يريحك ✉️ · Every message brings a calmer solution closer.',
    ],
  },
  alert: {
    icon: '📣',
    accent: '#be123c',
    soft: '#fff0f3',
    badge: 'تنبيه مهم · Important',
    wishes: [
      'خبر مهم… ونحن معك خطوة بخطوة 🤝 · Important news — and we’re with you step by step.',
      'تنبيه سريع ودعاء بيوم هادئ 🌤️ · A quick alert and a wish for a calm day.',
      'لا داعي للقلق؛ التفاصيل بين يديك 🧭 · No need to fret — the details are in your hands.',
      'وضوح الآن يمنع الارتباك لاحقاً 💡 · Clarity now prevents confusion later.',
      'خذ نفساً… ثم أكمل بثقة 🌬️ · Take a breath, then continue with confidence.',
      'نحن هنا إن احتجت أي مساعدة 🛟 · We’re here if you need any help.',
      'المعلومة وصلت؛ والحل أقرب مما تظن 🔧 · The update landed; the fix is nearer than you think.',
      'Steady steps beat rushed worries 🧘 · خطوات ثابتة تهزم القلق المتسرّع.',
    ],
  },
  team: {
    icon: '🤝',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'الفريق · Team',
    wishes: [
      'أهلاً بالفريق! قهوة قبل أول مهمة ☕ · Welcome aboard — coffee before task one.',
      'ابتسامة وصلاحيات مرتبة بانتظارك 🤝 · A smile and tidy permissions await you.',
      'إنجازات أكثر… واجتماعات أقل إن أمكن 😄 · More wins, fewer meetings if possible.',
      'أنت جزء من شيء يبني الثقة يومياً 🏗️ · You’re part of something that builds trust daily.',
      'بداية موفقة كشروق مسقط ☀️ · A strong start like a Muscat sunrise.',
      'فريقك يسعد بانضمامك — حقاً 🧡 · Your crew is genuinely glad you’re here.',
      'كل صلاحية أداة… وكل يوم فرصة 🛠️ · Every permission is a tool; every day a chance.',
      'معاً نجعل العقار مكاناً أسهل للجميع 🏠 · Together we make property life easier for all.',
    ],
  },
  legal: {
    icon: '⚖️',
    accent: '#174b70',
    soft: '#e9f0f7',
    badge: 'الشؤون القانونية · Legal',
    wishes: [
      'نهاية بالحسنى ووئام دائم 🕊️ · A fair ending and lasting peace.',
      'أوراق مرتبة وحق واضح وأمل كبير ⚖️ · Tidied papers, clear rights, big hope.',
      'العدل يريح القلوب قبل المحاكم 💛 · Justice eases hearts before it fills courts.',
      'خطوة قانونية واثقة = غدٍ أهدأ 📋 · A confident legal step means a calmer tomorrow.',
      'نرجو حلاً يحفظ الكرامة للجميع 🤝 · Wishing a solution that keeps dignity for all.',
      'الوضوح أقوى دفاع 🛡️ · Clarity is the strongest defence.',
      'بالتوفيق… والحق أقرب مما يبدو ✨ · Good luck — fairness is closer than it looks.',
      'Steady files, steady nerves 📁 · ملفات ثابتة وأعصاب أهدأ.',
    ],
  },
  deposit: {
    icon: '💰',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'التأمين · Deposit',
    wishes: [
      'مالك في أمان… ويعود مع ابتسامة 😊 · Your funds are safe — and may return with a smile.',
      'حسابات صافية وقلوب أصفى 💙 · Clear accounts, clearer hearts.',
      'الشفافية تبني الثقة أسرع من أي وعد 🔍 · Transparency builds trust faster than promises.',
      'كل ريال موثّق = راحة بال أكبر 📒 · Every tracked rial is extra peace of mind.',
      'نحرص على حقك كما نحرص على النظام ⚖️ · We guard your right as carefully as the process.',
      'قريباً تُغلق الحلقة بسلام إن شاء الله 🔄 · Soon the loop closes peacefully, God willing.',
      'الأمان المالي جزء من الضيافة 🏨 · Financial safety is part of hospitality.',
      'اطمئن… التفاصيل تحت السيطرة 🛟 · Rest easy — the details are under control.',
    ],
  },
  general: {
    icon: '✨',
    accent: '#0b8f8a',
    soft: '#e6f6f5',
    badge: 'إشعار · Notice',
    wishes: [
      'يوماً جميلاً كشروق جبال الحجر 🌄 · A day as bright as a Hajar sunrise.',
      'دمت بخير… واشرب ماءً؛ مسقط حارة 💧 · Stay well — and drink water; Muscat is warm.',
      'رسالة صغيرة وأماني كبيرة بيوم رائع 🌟 · A small note with big wishes for a great day.',
      'ابتسم… فالخير أقرب مما تظن 😊 · Smile — goodness is nearer than you think.',
      'خطوة لطيفة اليوم تصنع فرقاً غداً 🌱 · A kind step today shapes a better tomorrow.',
      'نحن سعداء بخدمتك دائماً 🫶 · Always happy to serve you.',
      'طاقة إيجابية في طريقك الآن ✨ · Positive energy headed your way.',
      'Keep going — you’re doing better than you feel 💪 · واصل… أنت أفضل مما تشعر.',
    ],
  },
};

/** Short bilingual boosters mixed into every email for continuous variety. */
const SPARKS = [
  'استمر؛ أنت على الطريق الصحيح 💪 · Keep going — you’re on the right path.',
  'يومك يستحق أن يكون ألطف مما تتوقع 🌈 · Your day deserves to be kinder than expected.',
  'ثقة صغيرة تصنع فرقاً كبيراً ✨ · A little confidence makes a big difference.',
  'نحن معك… حتى في التفاصيل الصغيرة 🤝 · We’re with you — even in the tiny details.',
  'ابتسامة الآن = يوم أخف لاحقاً 😄 · A smile now means a lighter day later.',
  'كل إشعار فرصة لتنظيم جميل 🗂️ · Every notice is a chance for tidy progress.',
  'خذ لحظة فخر بما أنجزته اليوم 🏅 · Take a moment of pride in today’s progress.',
  'الهدوء قوة… والوضوح راحة 🧘 · Calm is strength; clarity is comfort.',
  'خطوة واحدة كافية للبداية 👣 · One step is enough to begin.',
  'أنت أهم من أي رقم أو موعد 💛 · You’re bigger than any figure or deadline.',
  'بالتوفيق دائماً من فريق BHD R 🌴 · Always wishing you well from BHD R.',
  'Nice work being here — seriously 🙌 · وجودك هنا بحد ذاته إنجاز لطيف.',
];

const GREETINGS_NAMED = [
  (name: string) => `أهلاً ${name} 👋 · Hello ${name}`,
  (name: string) => `مرحباً ${name} 🌟 · Welcome ${name}`,
  (name: string) => `يا هلا ${name} 😊 · Hi ${name}`,
  (name: string) => `سرّنا تواصلك ${name} 🤝 · Glad to reach you, ${name}`,
];

const GREETINGS_ANON = [
  'أهلاً بك 👋 · Hello there',
  'مرحباً بك 🌟 · Welcome',
  'يا هلا وسهلاً 😊 · Hi and welcome',
  'سعداء بتواصلك 🤝 · Glad to be in touch',
];

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

/** Tone wish + rotating spark; stable for the same seed (retries), varied across messages. */
export function emailWish(tone: EmailTone, seed: string): string {
  const wishes = TONES[tone].wishes;
  const wish = wishes[seedIndex(seed, wishes.length)]!;
  const spark = SPARKS[seedIndex(`${seed}:spark`, SPARKS.length)]!;
  return `${wish}\n${spark}`;
}

/** Same pool as emailWish, split so WhatsApp can send AR and EN cleanly. */
export function emailWishParts(
  tone: EmailTone,
  seed: string,
): { wishAr: string; wishEn: string; sparkAr: string; sparkEn: string } {
  const wishes = TONES[tone].wishes;
  const wish = splitBilingualLine(wishes[seedIndex(seed, wishes.length)]!);
  const spark = splitBilingualLine(SPARKS[seedIndex(`${seed}:spark`, SPARKS.length)]!);
  return { wishAr: wish.ar, wishEn: wish.en, sparkAr: spark.ar, sparkEn: spark.en };
}

export function emailGreeting(name: string | null | undefined, seed = 'greet'): string {
  const clean = name?.trim();
  if (clean) {
    const greet = GREETINGS_NAMED[seedIndex(`${seed}:hi`, GREETINGS_NAMED.length)]!;
    return greet(clean);
  }
  return GREETINGS_ANON[seedIndex(`${seed}:hi`, GREETINGS_ANON.length)]!;
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
  return TONES[tone].wishes.length * SPARKS.length;
}

/** Plain-text and HTML bodies for one branded email. `seed` keeps the wish stable on retries. */
export function renderBrandedEmail(
  input: BrandedEmailInput,
  options: { origin: string; seed: string },
): { text: string; html: string } {
  const tone = TONES[input.tone];
  const origin = options.origin.replace(/\/$/, '');
  const greeting = emailGreeting(input.recipientName, options.seed);
  const wish = emailWish(input.tone, options.seed);
  const wishHtml = escape(wish).replaceAll('\n', '<br>');
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
    `مع أطيب التحيات من فريق ${PRODUCT_NAME} — ${COMPANY_NAME_AR}`,
    `Warm regards from the ${PRODUCT_NAME} team — ${COMPANY_NAME_EN}`,
    origin,
    ...(input.footnote
      ? ['', ...input.footnote.split(/\s*·\s*/).map((part) => part.trim()).filter(Boolean)]
      : []),
    '',
    'هذه رسالة آلية من منصتنا؛ لا تقلق، فهي لا تعضّ 🐾',
    'This is an automated message from our platform; don’t worry — it doesn’t bite 🐾',
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
    <tr><td class="bhd-pad" style="background:#ffffff;padding:16px 16px 18px">
      <div style="background:${tone.soft};border-radius:14px;padding:14px 14px;color:#24384d;font-size:13px;line-height:1.8;text-align:center;word-break:break-word;overflow-wrap:anywhere">🌟 ${wishHtml}</div>
    </td></tr>
    <tr><td class="bhd-pad" style="background:#f7fafb;border-top:1px solid #e3eaef;border-radius:0 0 18px 18px;padding:14px 16px;text-align:center;color:#6b7c8d;font-size:12px;line-height:1.75;word-break:break-word;overflow-wrap:anywhere">
      <div style="font-size:18px;letter-spacing:6px">🏠 🔑 🌴</div>
      <div>مع أطيب التحيات من فريق <b style="color:#174b70">${PRODUCT_NAME}</b> — ${COMPANY_NAME_AR}</div>
      <div style="margin-top:2px;color:#8a99a8">Warm regards from the <b style="color:#174b70">${PRODUCT_NAME}</b> team — ${COMPANY_NAME_EN}</div>
      ${
        input.footnote
          ? input.footnote
              .split(/\s*·\s*/)
              .map((part) => part.trim())
              .filter(Boolean)
              .map(
                (part) =>
                  `<div style="margin-top:6px;word-break:break-word">${escape(part)}</div>`,
              )
              .join('')
          : ''
      }
      <div style="margin-top:8px">هذه رسالة آلية من منصتنا؛ لا تقلق، فهي لا تعضّ 🐾</div>
      <div style="color:#8a99a8">This is an automated message from our platform; don’t worry — it doesn’t bite 🐾</div>
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
