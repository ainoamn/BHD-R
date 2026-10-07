export type BookingTermsMode = 'rent' | 'sale' | 'daily';

export const BOOKING_TERMS_MODES: BookingTermsMode[] = ['sale', 'rent', 'daily'];

export const BOOKING_TERMS_MAX_LINES = 60;
export const BOOKING_TERMS_MAX_BODY = 12_000;
export const TERMS_MAX_BLOCKS = 80;
export const TERMS_MAX_CLAUSE = 1_200;
export const TERMS_MAX_HEADING = 200;

/** One editable item: a section heading or a clause, written in Arabic and English side by side. */
export type TermsBlock = {
  kind: 'heading' | 'clause';
  ar: string;
  en: string;
  /** Platform clauses appended by BHD R — shaded, never editable by the owner. */
  platform?: boolean;
};

/** Block with its automatic label: headings get letters (أ / A), clauses numbers restarting under each heading. */
export type NumberedTermsBlock = TermsBlock & { labelAr: string; labelEn: string };

/** What the owner saved for one booking type — per property or as the organization template (latest active version). */
export type OwnerBookingTerms = {
  version: number;
  bodyAr: string | null;
  bodyEn: string | null;
  blocks: TermsBlock[];
  updatedAt: string;
};

/** Company identity printed above and below the terms. */
export type TermsLetterhead = {
  nameAr: string;
  nameEn: string;
  logoDataUrl: string | null;
  addressAr: string;
  addressEn: string;
  phone: string;
  email: string;
  registrationNumber: string;
};

export const TERMS_LOGO_MAX_CHARS = 150_000;
export const TERMS_LOGO_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Where the effective terms come from: a property override, the organization template, or platform defaults. */
export type BookingTermsSource = 'property' | 'organization' | 'default';

/** Public payload for checkout; `ref` identifies the exact text the customer accepted. */
export type BookingTermsForCheckout = {
  ref: string;
  source: BookingTermsSource;
  version: number;
  blocks: TermsBlock[];
  letterhead?: TermsLetterhead | null;
};

export function bookingTermsRef(source: BookingTermsSource, version: number): string {
  return source === 'default' ? 'default' : `${source}:${version}`;
}

/** Accepts the current `termsRef` or the older numeric `termsVersion` (0 = defaults, n = property v n). */
export function normalizeTermsRef(
  ref: string | null | undefined,
  legacyVersion: number | null | undefined,
): string | undefined {
  if (ref) return ref;
  if (legacyVersion === null || legacyVersion === undefined) return undefined;
  return legacyVersion === 0 ? 'default' : `property:${legacyVersion}`;
}

export function bookingTermsModeLabel(mode: BookingTermsMode, ar: boolean): string {
  if (mode === 'sale') return ar ? 'البيع' : 'Sale';
  if (mode === 'daily') return ar ? 'الإيجار اليومي' : 'Daily rental';
  return ar ? 'الإيجار الشهري / السنوي' : 'Monthly / yearly rental';
}

const LEADING_NUMBERING =
  /^(?:[-•*·▪●◦]+|\(?[0-9\u0660-\u0669]{1,3}\s*[).:\-–](?![0-9\u0660-\u0669])|\(?[a-zA-Z]\s*[).](?=\s)|\(?[\u0621-\u064A]\s*[)\-–](?=\s))\s*/;
const NUMBERED_LINE =
  /^(?:[-•*·▪●◦]+|\(?[0-9\u0660-\u0669]{1,3}\s*[).:\-–](?![0-9\u0660-\u0669]))\s*\S/;

/** Strips numbering, bullets and letters the owner typed — the document numbers itself. */
export function stripTermsNumbering(text: string): string {
  return text.trim().replace(LEADING_NUMBERING, '').trim();
}

/** One clause per line; numbering or bullets typed by the owner are stripped. */
export function parseTermsBody(body: string | null | undefined): string[] {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((line) => stripTermsNumbering(line.replace(/^#+\s*/, '')))
    .filter(Boolean)
    .slice(0, BOOKING_TERMS_MAX_LINES)
    .map((line) => line.slice(0, 600));
}

type ParsedLine = { kind: TermsBlock['kind']; text: string };

/**
 * Splits pasted text into headings and clauses: numbered/bulleted lines are clauses,
 * `# ` lines are headings, and a short unpunctuated line followed by a numbered line is a heading.
 */
export function parseTermsText(text: string): ParsedLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines
    .map((line, index): ParsedLine => {
      if (/^#+\s*/.test(line)) {
        return { kind: 'heading', text: line.replace(/^#+\s*/, '').trim() };
      }
      if (NUMBERED_LINE.test(line)) return { kind: 'clause', text: stripTermsNumbering(line) };
      const next = lines[index + 1];
      const headingLike =
        line.length <= 90 && !/[.!؟?؛;،,]$/.test(line) && Boolean(next && NUMBERED_LINE.test(next));
      return { kind: headingLike ? 'heading' : 'clause', text: line.replace(/:$/, '').trim() };
    })
    .filter((line) => line.text);
}

/** Validates untrusted blocks (API input, stored JSON) and normalizes their text. */
export function sanitizeTermsBlocks(input: unknown): TermsBlock[] {
  if (!Array.isArray(input)) return [];
  const blocks: TermsBlock[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const kind = row.kind === 'heading' ? 'heading' : row.kind === 'clause' ? 'clause' : null;
    if (!kind) continue;
    const max = kind === 'heading' ? TERMS_MAX_HEADING : TERMS_MAX_CLAUSE;
    const clean = (value: unknown) =>
      typeof value === 'string'
        ? stripTermsNumbering(value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n')).slice(
            0,
            max,
          )
        : '';
    const ar = clean(row.ar);
    const en = clean(row.en);
    if (!ar && !en) continue;
    blocks.push({ kind, ar, en });
    if (blocks.length >= TERMS_MAX_BLOCKS) break;
  }
  return blocks;
}

/** Plain-text bodies kept alongside blocks for search and older readers (`# ` marks headings). */
export function termsBodiesFromBlocks(blocks: TermsBlock[]): { bodyAr: string; bodyEn: string } {
  const body = (lang: 'ar' | 'en') =>
    blocks
      .map((block) => {
        const text = block[lang].replace(/\s*\n\s*/g, ' ').trim();
        if (!text) return '';
        return block.kind === 'heading' ? `# ${text}` : text;
      })
      .filter(Boolean)
      .join('\n');
  return { bodyAr: body('ar'), bodyEn: body('en') };
}

/** Blocks from a stored record: structured blocks when present, else the legacy line bodies paired by position. */
export function termsBlocksFromStored(stored: {
  blocks?: unknown;
  bodyAr?: string | null;
  bodyEn?: string | null;
}): TermsBlock[] {
  const structured = sanitizeTermsBlocks(stored.blocks);
  if (structured.length) return structured;
  const arLines = stored.bodyAr ? parseTermsText(stored.bodyAr) : [];
  const enLines = stored.bodyEn ? parseTermsText(stored.bodyEn) : [];
  const count = Math.min(Math.max(arLines.length, enLines.length), TERMS_MAX_BLOCKS);
  const blocks: TermsBlock[] = [];
  for (let index = 0; index < count; index += 1) {
    const ar = arLines[index];
    const en = enLines[index];
    blocks.push({
      kind: ar?.kind ?? en?.kind ?? 'clause',
      ar: (ar?.text ?? '').slice(0, TERMS_MAX_CLAUSE),
      en: (en?.text ?? '').slice(0, TERMS_MAX_CLAUSE),
    });
  }
  return blocks;
}

export function hasTermsText(blocks: readonly TermsBlock[] | null | undefined): boolean {
  return Boolean(blocks?.some((block) => block.ar.trim() || block.en.trim()));
}

export function checkoutTermsFromOwner(
  terms: OwnerBookingTerms | null,
  source: Exclude<BookingTermsSource, 'default'> = 'property',
): BookingTermsForCheckout {
  if (!terms) return { ref: 'default', source: 'default', version: 0, blocks: [] };
  return {
    ref: bookingTermsRef(source, terms.version),
    source,
    version: terms.version,
    blocks: terms.blocks,
  };
}

const ARABIC_LETTERS = [
  'أ',
  'ب',
  'ج',
  'د',
  'هـ',
  'و',
  'ز',
  'ح',
  'ط',
  'ي',
  'ك',
  'ل',
  'م',
  'ن',
  'س',
  'ع',
  'ف',
  'ص',
  'ق',
  'ر',
  'ش',
  'ت',
  'ث',
  'خ',
  'ذ',
  'ض',
  'ظ',
  'غ',
];

function englishLetter(index: number): string {
  let value = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function arabicLetter(index: number): string {
  const base = ARABIC_LETTERS[index % ARABIC_LETTERS.length] ?? 'أ';
  const round = Math.floor(index / ARABIC_LETTERS.length);
  return round ? `${base}${round + 1}` : base;
}

/** Automatic labels: headings A, B, C… (أ، ب، ج…) and clauses 1, 2, 3… restarting under each heading. */
export function numberTermsBlocks(blocks: readonly TermsBlock[]): NumberedTermsBlock[] {
  let headingIndex = -1;
  let clauseIndex = 0;
  return blocks.map((block) => {
    if (block.kind === 'heading') {
      headingIndex += 1;
      clauseIndex = 0;
      return {
        ...block,
        labelAr: arabicLetter(headingIndex),
        labelEn: englishLetter(headingIndex),
      };
    }
    clauseIndex += 1;
    return { ...block, labelAr: String(clauseIndex), labelEn: String(clauseIndex) };
  });
}

function pairBlocks(ar: string[], en: string[], extra: Partial<TermsBlock> = {}): TermsBlock[] {
  return ar.map((text, index) => ({ kind: 'clause', ar: text, en: en[index] ?? '', ...extra }));
}

type TermsSection = {
  ar: string;
  en: string;
  clauses: readonly (readonly [ar: string, en: string])[];
};

function sectionBlocks(sections: readonly TermsSection[]): TermsBlock[] {
  return sections.flatMap((section) => [
    { kind: 'heading' as const, ar: section.ar, en: section.en },
    ...section.clauses.map(([ar, en]) => ({ kind: 'clause' as const, ar, en })),
  ]);
}

const GENERAL_SECTION: TermsSection = {
  ar: 'أحكام عامة',
  en: 'General provisions',
  clauses: [
    [
      'تخضع هذه الشروط وأي عقد يُبرم بموجبها لقوانين سلطنة عُمان، وتختص المحاكم العُمانية دون غيرها بالفصل في أي نزاع ينشأ عنها.',
      'These terms and any agreement concluded under them are governed by the laws of the Sultanate of Oman, and the Omani courts have exclusive jurisdiction over any dispute arising from them.',
    ],
    [
      'لا يُعتد بأي تعديل على هذه الشروط إلا إذا كان مكتوباً وموقعاً من الطرفين.',
      'No amendment to these terms is valid unless made in writing and signed by both parties.',
    ],
    [
      'إذا قُضي ببطلان أي بند من هذه الشروط أو تعذّر تنفيذه، فلا يؤثر ذلك في صحة باقي البنود ونفاذها.',
      'If any clause of these terms is held invalid or unenforceable, the remaining clauses stay valid and in force.',
    ],
  ],
};

const RENT_TERMS: readonly TermsSection[] = [
  {
    ar: 'وديعة الحجز غير قابلة للاسترداد',
    en: 'Non-refundable reservation deposit',
    clauses: [
      [
        'في حالة عدم قيام المستأجر باستئجار الوحدة، سيتم مصادرة وديعة الحجز غير القابلة للاسترداد.',
        'If the tenant does not proceed to lease the unit, the non-refundable reservation deposit will be forfeited.',
      ],
      [
        'بمجرد توقيع هذه الاتفاقية ودفع المستأجر إيجار الشهر الأول من اتفاقية الإيجار، سيتم تحويل وديعة الحجز غير القابلة للاسترداد تلقائيًا إلى وديعة تأمين.',
        'Once this agreement is signed and the tenant pays the first month’s rent under the lease agreement, the non-refundable reservation deposit will automatically be converted into a security deposit.',
      ],
      [
        'تبقى الوحدة محجوزة باسم المستأجر طوال مدة الحجز، ولا يجوز للمؤجر خلالها عرضها أو تأجيرها للغير.',
        'The unit remains reserved in the tenant’s name throughout the reservation period, during which the landlord may not offer or lease it to others.',
      ],
      [
        'إذا تعذّر إبرام عقد الإيجار لسبب يرجع إلى المؤجر أو لعدم صلاحية الوحدة للتسليم، تُرد وديعة الحجز كاملة إلى المستأجر.',
        'If the lease cannot be concluded for a reason attributable to the landlord, or because the unit is not fit for handover, the reservation deposit will be refunded to the tenant in full.',
      ],
    ],
  },
  {
    ar: 'عقد الإيجار ومدته',
    en: 'Lease agreement and term',
    clauses: [
      [
        'يُبرم بين الطرفين عقد إيجار مكتوب يحدد مدة الإيجار (شهرية أو سنوية) وقيمة الإيجار ومواعيد سداده، ويُسجَّل لدى البلدية المختصة وفق الأنظمة المعمول بها.',
        'The parties will sign a written lease stating the lease term (monthly or yearly), the rent, and its payment dates, and the lease will be registered with the competent municipality in accordance with applicable regulations.',
      ],
      [
        'يُسدَّد الإيجار مقدماً في المواعيد المحددة في العقد، ويُعد التأخر في السداد إخلالاً بالتزامات المستأجر.',
        'Rent is payable in advance on the dates set in the lease, and late payment constitutes a breach of the tenant’s obligations.',
      ],
      [
        'لا يجوز تعديل القيمة الإيجارية خلال مدة العقد، ويخضع تجديده أو تعديل قيمته عند التجديد لاتفاق الطرفين وأحكام القانون.',
        'The rent may not be changed during the lease term; renewal and any change of rent on renewal are subject to the parties’ agreement and the law.',
      ],
    ],
  },
  {
    ar: 'وديعة التأمين',
    en: 'Security deposit',
    clauses: [
      [
        'تُحفظ وديعة التأمين لدى المؤجر ضماناً لوفاء المستأجر بالتزاماته، ولا يجوز احتسابها من إيجار أي شهر.',
        'The security deposit is held by the landlord to secure the tenant’s obligations and may not be applied toward any month’s rent.',
      ],
      [
        'تُرد وديعة التأمين عند انتهاء العقد وتسليم الوحدة بحالة جيدة وسداد جميع المستحقات، بعد خصم قيمة أي أضرار تتجاوز الاستهلاك العادي وأي مبالغ مستحقة على المستأجر.',
        'The security deposit is returned at the end of the lease once the unit is handed back in good condition and all dues are settled, less the cost of any damage beyond normal wear and tear and any amounts owed by the tenant.',
      ],
    ],
  },
  {
    ar: 'استعمال الوحدة والصيانة',
    en: 'Use of the unit and maintenance',
    clauses: [
      [
        'يلتزم المستأجر باستعمال الوحدة للسكن فقط، ولا يجوز له تأجيرها من الباطن أو التنازل عن العقد للغير دون موافقة كتابية من المؤجر.',
        'The tenant will use the unit for residential purposes only and may not sublet it or assign the lease to others without the landlord’s written consent.',
      ],
      [
        'لا يجوز للمستأجر إجراء أي تعديلات أو إضافات في الوحدة دون موافقة كتابية مسبقة من المؤجر.',
        'The tenant may not make any alterations or additions to the unit without the landlord’s prior written consent.',
      ],
      [
        'يتحمل المستأجر فواتير الكهرباء والمياه والخدمات المستهلكة خلال مدة الإيجار، ما لم يُتفق على خلاف ذلك.',
        'The tenant bears the electricity, water, and other utility bills consumed during the lease term, unless otherwise agreed.',
      ],
      [
        'يتحمل المستأجر الصيانة البسيطة الناتجة عن الاستعمال اليومي، ويتحمل المؤجر الصيانة الرئيسية والإصلاحات الإنشائية التي لا تنتج عن سوء استعمال المستأجر.',
        'The tenant bears minor maintenance arising from daily use, while the landlord bears major maintenance and structural repairs not caused by the tenant’s misuse.',
      ],
      [
        'يلتزم المستأجر بإبلاغ المؤجر فوراً بأي عطل أو ضرر في الوحدة، وبتمكينه من دخولها للمعاينة أو الصيانة بعد إخطار مسبق.',
        'The tenant will promptly notify the landlord of any fault or damage in the unit and allow the landlord access for inspection or maintenance upon prior notice.',
      ],
    ],
  },
  {
    ar: 'الإخلاء وإنهاء العقد',
    en: 'Vacating and termination',
    clauses: [
      [
        'على الطرف الراغب في إنهاء العقد أو عدم تجديده إخطار الطرف الآخر كتابياً قبل ثلاثة أشهر على الأقل من تاريخ انتهائه في العقود السنوية، وقبل شهر على الأقل في العقود الشهرية، ما لم ينص عقد الإيجار على خلاف ذلك.',
        'A party wishing to terminate or not renew the lease must notify the other party in writing at least three months before its expiry for yearly leases, and at least one month before for monthly leases, unless the lease provides otherwise.',
      ],
      [
        'يلتزم المستأجر عند انتهاء العقد بتسليم الوحدة ومفاتيحها بالحالة التي استلمها بها، مع سداد جميع الفواتير والمستحقات حتى تاريخ التسليم.',
        'At the end of the lease the tenant will hand back the unit and its keys in the condition received, having paid all bills and dues up to the handover date.',
      ],
      [
        'يحق للمؤجر إنهاء العقد وطلب الإخلاء عند تأخر المستأجر في سداد الإيجار أو إخلاله بأي من التزاماته، وفقاً للإجراءات المقررة قانوناً.',
        'The landlord may terminate the lease and seek eviction if the tenant fails to pay rent on time or breaches any of the tenant’s obligations, in accordance with the procedures prescribed by law.',
      ],
    ],
  },
  GENERAL_SECTION,
];

const SALE_TERMS: readonly TermsSection[] = [
  {
    ar: 'العربون وحجز العقار',
    en: 'Earnest money and reservation of the property',
    clauses: [
      [
        'يدفع المشتري عربوناً لحجز العقار باسمه، ويلتزم البائع خلال مدة الحجز بعدم بيع العقار أو رهنه أو عرضه للغير أو التصرف فيه بأي وجه.',
        'The buyer pays earnest money to reserve the property in the buyer’s name; during the reservation period the seller will not sell, mortgage, offer, or otherwise dispose of the property.',
      ],
      [
        'يُخصم العربون من ثمن البيع عند إتمام البيع ونقل الملكية.',
        'The earnest money is deducted from the sale price when the sale is completed and title is transferred.',
      ],
      [
        'إذا عدل المشتري عن الشراء أو تخلّف عن إتمامه خلال المدة المتفق عليها دون سبب مشروع، يحق للبائع الاحتفاظ بالعربون.',
        'If the buyer withdraws from the purchase or fails to complete it within the agreed period without a lawful reason, the seller may retain the earnest money.',
      ],
      [
        'إذا عدل البائع عن البيع أو تعذّر نقل الملكية لسبب يرجع إليه، يلتزم بردّ العربون كاملاً إلى المشتري، دون إخلال بحق المشتري في التعويض وفق القانون.',
        'If the seller withdraws from the sale or title cannot be transferred for a reason attributable to the seller, the seller will refund the earnest money to the buyer in full, without prejudice to the buyer’s right to compensation under the law.',
      ],
    ],
  },
  {
    ar: 'ثمن البيع وطريقة السداد',
    en: 'Sale price and payment',
    clauses: [
      [
        'يُحدد ثمن البيع النهائي في اتفاقية البيع، ويُسدَّد باقي الثمن بعد خصم العربون بشيك مصرفي مصدق أو تحويل بنكي عند نقل الملكية.',
        'The final sale price is set in the sale agreement, and the balance after deducting the earnest money is paid by certified bank cheque or bank transfer upon transfer of title.',
      ],
      [
        'لا يُعد الثمن مسدداً إلا بعد تحصيل قيمته فعلياً في حساب البائع.',
        'The price is not deemed paid until its value is actually received in the seller’s account.',
      ],
    ],
  },
  {
    ar: 'نقل الملكية والرسوم',
    en: 'Transfer of title and fees',
    clauses: [
      [
        'تُنقل ملكية العقار باسم المشتري لدى وزارة الإسكان والتخطيط العمراني، ويلتزم الطرفان بالحضور وتقديم المستندات المطلوبة في الموعد المتفق عليه.',
        'Title to the property is transferred to the buyer at the Ministry of Housing and Urban Planning, and both parties will attend and submit the required documents on the agreed date.',
      ],
      [
        'يتحمل المشتري رسوم تسجيل ونقل الملكية المقررة لدى وزارة الإسكان والتخطيط العمراني، ويتحمل البائع عمولة الوساطة العقارية، ما لم يُتفق كتابياً على خلاف ذلك.',
        'The buyer bears the registration and title transfer fees charged by the Ministry of Housing and Urban Planning, and the seller bears the real-estate brokerage commission, unless otherwise agreed in writing.',
      ],
      [
        'يلتزم البائع بسداد جميع الرسوم والفواتير والمستحقات المتعلقة بالعقار، بما فيها الكهرباء والمياه ورسوم البلدية، حتى تاريخ التسليم.',
        'The seller will pay all fees, bills, and dues relating to the property, including electricity, water, and municipal charges, up to the handover date.',
      ],
    ],
  },
  {
    ar: 'ضمانات البائع',
    en: 'Seller’s warranties',
    clauses: [
      [
        'يقر البائع بأنه المالك الوحيد للعقار، وأن العقار خالٍ من أي رهن أو حجز أو حق للغير أو نزاع قضائي.',
        'The seller declares that the seller is the sole owner of the property and that it is free of any mortgage, attachment, third-party right, or legal dispute.',
      ],
      [
        'يضمن البائع عدم التعرض للمشتري في انتفاعه بالعقار، ويضمن استحقاقه إذا ثبت للغير حق عليه سابق على البيع.',
        'The seller warrants the buyer against any interference with the use of the property and against eviction should a third party establish a right to it predating the sale.',
      ],
      [
        'إذا تبيّن عدم صحة أي من إقرارات البائع، يحق للمشتري إلغاء الحجز واسترداد العربون كاملاً مع المطالبة بالتعويض.',
        'If any of the seller’s declarations proves untrue, the buyer may cancel the reservation, recover the earnest money in full, and claim compensation.',
      ],
    ],
  },
  {
    ar: 'المعاينة والتسليم',
    en: 'Inspection and handover',
    clauses: [
      [
        'يحق للمشتري معاينة العقار قبل نقل الملكية، ويُعد إتمامه نقل الملكية إقراراً بمعاينته معاينة نافية للجهالة وقبوله بحالته عند التسليم.',
        'The buyer may inspect the property before transfer of title; completing the transfer constitutes the buyer’s acknowledgment of a full inspection and acceptance of the property in its condition at handover.',
      ],
      [
        'أي تمكين للمشتري من دخول العقار قبل نقل الملكية يكون لغرض المعاينة فقط، ولا يُعد تسليماً قانونياً، ولا يجوز خلاله السكن أو التأجير أو إجراء أي تعديلات.',
        'Any access granted to the buyer before transfer of title is for inspection only and is not a legal handover; the buyer may not occupy, lease, or alter the property during that time.',
      ],
      [
        'يُسلَّم العقار ومفاتيحه إلى المشتري بموجب محضر تسليم موقع من الطرفين بعد نقل الملكية وسداد كامل الثمن.',
        'The property and its keys are handed over to the buyer under a handover record signed by both parties after transfer of title and full payment of the price.',
      ],
    ],
  },
  {
    ar: 'الإخلال والتعويض',
    en: 'Breach and compensation',
    clauses: [
      [
        'إذا أخلّ أي من الطرفين بالتزاماته، يحق للطرف الآخر إنذاره كتابياً، فإذا لم يُصحَّح الإخلال خلال المدة المحددة في الإنذار جاز له إلغاء الحجز والمطالبة بالتعويض عن الأضرار الفعلية.',
        'If either party breaches its obligations, the other party may give written notice; if the breach is not remedied within the period stated in the notice, the reservation may be cancelled and compensation for actual damages claimed.',
      ],
      [
        'تُلزم هذه الشروط الطرفين وورثتهما وخلفهما العام والخاص.',
        'These terms bind both parties and their heirs, successors, and assigns.',
      ],
    ],
  },
  {
    ...GENERAL_SECTION,
    clauses: [
      ...GENERAL_SECTION.clauses,
      [
        'تُعد هذه الشروط جزءاً من اتفاقية البيع النهائية، وعند التعارض يُعمل بما ورد في الاتفاقية الموقعة من الطرفين.',
        'These terms form part of the final sale agreement; in case of conflict, the agreement signed by both parties prevails.',
      ],
    ],
  },
];

const DAILY_TERMS: readonly TermsSection[] = [
  {
    ar: 'الحجز والدفع',
    en: 'Booking and payment',
    clauses: [
      [
        'الحجز شخصي للضيف المسجل، ولا يجوز التنازل عنه للغير دون موافقة المالك.',
        'The booking is personal to the registered guest and may not be transferred to others without the owner’s consent.',
      ],
      [
        'يشمل السعر المعروض الإقامة للمدة وعدد الضيوف المحددين في الحجز، وتُحتسب أي خدمات إضافية وفق ما هو معلن.',
        'The displayed price covers the stay for the dates and number of guests in the booking; any extra services are charged as advertised.',
      ],
      [
        'إذا اشترط العقار مبلغ تأمين، يُرد إلى الضيف بعد المغادرة والتحقق من سلامة العقار ومحتوياته.',
        'Where the property requires a security deposit, it is returned to the guest after check-out once the property and its contents are confirmed undamaged.',
      ],
    ],
  },
  {
    ar: 'الوصول والمغادرة',
    en: 'Check-in and check-out',
    clauses: [
      [
        'يلتزم الضيف بمواعيد الوصول والمغادرة المحددة للعقار، ويجوز احتساب رسوم إضافية عند التأخر في المغادرة دون موافقة المالك.',
        'The guest will observe the property’s check-in and check-out times; late check-out without the owner’s approval may incur additional charges.',
      ],
      [
        'يلتزم الضيف بإبراز بطاقة شخصية سارية عند الوصول، ويحق للمالك رفض الدخول عند عدم تطابق البيانات مع الحجز.',
        'The guest will present a valid ID on arrival, and the owner may refuse entry if the details do not match the booking.',
      ],
      [
        'يستلم الضيف العقار ومحتوياته بحالة سليمة، وعليه إبلاغ المالك بأي ملاحظات خلال ساعتين من الوصول.',
        'The guest receives the property and its contents in good condition and must report any issues to the owner within two hours of arrival.',
      ],
    ],
  },
  {
    ar: 'قواعد الاستخدام',
    en: 'House rules',
    clauses: [
      [
        'لا يجوز تجاوز العدد الأقصى للضيوف المحدد في الحجز، ولا إقامة الحفلات أو المناسبات دون موافقة كتابية من المالك.',
        'The maximum number of guests in the booking may not be exceeded, and parties or events require the owner’s written approval.',
      ],
      [
        'يلتزم الضيف بالآداب العامة والأنظمة المعمول بها في سلطنة عُمان وبعدم إزعاج الجيران، ويُمنع التدخين داخل الأماكن المغلقة واصطحاب الحيوانات الأليفة ما لم يسمح المالك بذلك.',
        'The guest will respect public morals and the regulations of the Sultanate of Oman and will not disturb the neighbours; smoking indoors and pets are not allowed unless the owner permits them.',
      ],
      [
        'يُستخدم العقار للإقامة المؤقتة فقط، ويُمنع استخدامه لأي غرض غير مشروع.',
        'The property is to be used for temporary accommodation only and may not be used for any unlawful purpose.',
      ],
    ],
  },
  {
    ar: 'الأضرار والمسؤولية',
    en: 'Damage and liability',
    clauses: [
      [
        'يتحمل الضيف مسؤولية أي ضرر أو فقدان يلحق بالعقار أو محتوياته خلال الإقامة، ويحق للمالك المطالبة بقيمته.',
        'The guest is liable for any damage to or loss of the property or its contents during the stay, and the owner may claim its value.',
      ],
      [
        'يتحمل الضيف المسؤولية عن سلامة مرافقيه، ولا سيما الأطفال عند استخدام المسبح والمرافق، ولا يُسأل المالك عن الإصابات الناتجة عن الإهمال أو سوء الاستخدام.',
        'The guest is responsible for the safety of accompanying persons, especially children using the pool and facilities, and the owner is not liable for injuries caused by negligence or misuse.',
      ],
      [
        'لا يتحمل المالك مسؤولية فقدان أو تلف المقتنيات الشخصية للضيف.',
        'The owner is not responsible for the loss of or damage to the guest’s personal belongings.',
      ],
    ],
  },
  {
    ar: 'الإلغاء وإنهاء الإقامة',
    en: 'Cancellation and termination of the stay',
    clauses: [
      [
        'يخضع الإلغاء واسترداد المبالغ لسياسة الإلغاء المعلنة في صفحة الإقامة وقت الحجز.',
        'Cancellation and refunds follow the cancellation policy shown on the stay page at the time of booking.',
      ],
      [
        'يحق للمالك إنهاء الإقامة دون استرداد عند الإخلال الجسيم بهذه الشروط أو بالأنظمة العامة.',
        'The owner may end the stay without refund in case of a serious breach of these terms or of public regulations.',
      ],
      [
        'إذا تعذّر على المالك توفير العقار لسبب لا يرجع إلى الضيف، يُرد إلى الضيف كامل المبلغ المدفوع.',
        'If the owner cannot provide the property for a reason not attributable to the guest, the guest receives a full refund of the amount paid.',
      ],
    ],
  },
  { ...GENERAL_SECTION, clauses: GENERAL_SECTION.clauses.slice(0, 1) },
];

/** Starting template offered in the owner editor and used when the owner saved nothing. */
export function suggestedTermsBlocks(mode: BookingTermsMode): TermsBlock[] {
  if (mode === 'sale') return sectionBlocks(SALE_TERMS);
  if (mode === 'daily') return sectionBlocks(DAILY_TERMS);
  return sectionBlocks(RENT_TERMS);
}

/** Platform clauses appended after the owner's terms — they describe how BHD R booking works. */
export function platformTermsBlocks(input: {
  mode: BookingTermsMode;
  depositAr?: string | null;
  depositEn?: string | null;
}): TermsBlock[] {
  const { mode, depositAr, depositEn } = input;
  const heading: TermsBlock = {
    kind: 'heading',
    ar: 'أحكام الحجز عبر المنصة',
    en: 'Booking through the platform',
    platform: true,
  };
  if (mode === 'daily') {
    return [
      heading,
      ...pairBlocks(
        [
          'يُعتبر الحجز مؤكداً فقط بعد إتمام الدفع بنجاح عبر المنصة.',
          'أقر بصحة بياناتي وأتعهد بإرفاق صورة البطاقة الشخصية وصورة شخصية عند توقيع العقد، ويُعد توقيعي الإلكتروني موافقة ملزمة على هذه الشروط وفق قانون المعاملات الإلكترونية.',
        ],
        [
          'The booking is confirmed only after successful payment through the platform.',
          'I confirm my details are correct and will attach my ID card and a portrait photo when signing; my electronic signature is a binding acceptance of these terms under the Electronic Transactions Law.',
        ],
        { platform: true },
      ),
    ];
  }
  const sale = mode === 'sale';
  return [
    heading,
    ...pairBlocks(
      [
        `مبلغ الضمان (العربون) المحدد من المالك${depositAr ? ` هو ${depositAr}، و` : ' '}يُدفع إلكترونياً لحجز ${sale ? 'العقار للشراء' : 'الوحدة للإيجار'} باسمك، وتبقى محجوزة لك 30 يوماً بعد الدفع لإتمام ${sale ? 'إجراءات البيع' : 'عقد الإيجار النهائي'}.`,
        'أقر بصحة بياناتي وأتعهد بإرفاق صورة البطاقة الشخصية (الوجه والخلف) وصورة شخصية عند توقيع العقد، ويُعد توقيعي الإلكتروني بعد الدفع موافقة ملزمة على هذه الشروط وفق قانون المعاملات الإلكترونية.',
      ],
      [
        `The owner’s deposit${depositEn ? ` of ${depositEn}` : ''} is paid online to reserve this ${sale ? 'property for purchase' : 'unit for rent'} in your name; it stays reserved for 30 days after payment to complete ${sale ? 'the sale' : 'the final lease'}.`,
        'I confirm my details are correct and will attach my ID card (front and back) and a portrait photo when signing; my electronic signature after payment is a binding acceptance of these terms under the Electronic Transactions Law.',
      ],
      { platform: true },
    ),
  ];
}

/** Full numbered bilingual document shown to the customer and printed in the contract. */
export function bookingTermsDocument(input: {
  mode: BookingTermsMode;
  depositAr?: string | null;
  depositEn?: string | null;
  blocks?: readonly TermsBlock[] | null;
}): NumberedTermsBlock[] {
  const owner =
    input.blocks && hasTermsText(input.blocks)
      ? [...input.blocks]
      : suggestedTermsBlocks(input.mode);
  return numberTermsBlocks([...owner, ...platformTermsBlocks(input)]);
}

export function emptyLetterhead(nameAr = '', nameEn = ''): TermsLetterhead {
  return {
    nameAr,
    nameEn,
    logoDataUrl: null,
    addressAr: '',
    addressEn: '',
    phone: '',
    email: '',
    registrationNumber: '',
  };
}

export function sanitizeLetterhead(input: unknown, fallback: TermsLetterhead): TermsLetterhead {
  if (!input || typeof input !== 'object') return fallback;
  const row = input as Record<string, unknown>;
  const text = (value: unknown, max: number, otherwise: string) =>
    typeof value === 'string' ? value.trim().slice(0, max) : otherwise;
  const logo = typeof row.logoDataUrl === 'string' ? row.logoDataUrl : null;
  return {
    nameAr: text(row.nameAr, 160, fallback.nameAr) || fallback.nameAr,
    nameEn: text(row.nameEn, 160, fallback.nameEn) || fallback.nameEn,
    logoDataUrl:
      logo && logo.length <= TERMS_LOGO_MAX_CHARS && TERMS_LOGO_PATTERN.test(logo) ? logo : null,
    addressAr: text(row.addressAr, 400, ''),
    addressEn: text(row.addressEn, 400, ''),
    phone: text(row.phone, 40, ''),
    email: text(row.email, 160, ''),
    registrationNumber: text(row.registrationNumber, 60, ''),
  };
}
