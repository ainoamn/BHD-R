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

/** Starting template offered in the owner editor and used when the owner saved nothing. */
export function suggestedTermsBlocks(mode: BookingTermsMode): TermsBlock[] {
  if (mode === 'sale') {
    return [
      { kind: 'heading', ar: 'وديعة الحجز للشراء', en: 'Purchase reservation deposit' },
      ...pairBlocks(
        [
          'يُحتسب العربون من ثمن البيع عند إتمام البيع وفق اتفاقية البيع النهائية.',
          'يلتزم المشتري بإتمام إجراءات البيع ونقل الملكية خلال مدة الحجز.',
          'يخضع استرداد العربون عند العدول عن الشراء لسياسة المالك وللأنظمة المعمول بها في سلطنة عُمان.',
        ],
        [
          'The deposit is credited toward the price when the sale completes under the final sale agreement.',
          'The buyer will complete the sale and title transfer within the reservation period.',
          'Refund of the deposit if the buyer withdraws follows the owner’s policy and the laws of the Sultanate of Oman.',
        ],
      ),
    ];
  }
  if (mode === 'daily') {
    return [
      { kind: 'heading', ar: 'شروط الإقامة', en: 'Stay terms' },
      ...pairBlocks(
        [
          'يلتزم الضيف بمواعيد الوصول والمغادرة المحددة للعقار.',
          'يُمنع إقامة الحفلات أو تجاوز العدد المسموح من الضيوف دون موافقة المالك.',
          'يتحمل الضيف مسؤولية أي أضرار تلحق بالعقار أو محتوياته خلال فترة الإقامة.',
          'تخضع سياسة الإلغاء والاسترداد لما هو معلن في صفحة الإقامة.',
        ],
        [
          'The guest will respect the property’s check-in and check-out times.',
          'Parties or exceeding the allowed number of guests require the owner’s approval.',
          'The guest is responsible for any damage to the property or its contents during the stay.',
          'Cancellation and refunds follow the policy shown on the stay page.',
        ],
      ),
    ];
  }
  return [
    { kind: 'heading', ar: 'وديعة الحجز للإيجار', en: 'Rental reservation deposit' },
    ...pairBlocks(
      [
        'يُحتسب مبلغ الضمان ضمن مستحقات عقد الإيجار (التأمين أو الدفعة الأولى) عند توقيع العقد النهائي.',
        'يخضع استرداد مبلغ الضمان عند عدول المستأجر لسياسة المالك.',
      ],
      [
        'The deposit is credited toward the lease dues (security or first payment) when the final lease is signed.',
        'Refund of the deposit if the tenant withdraws follows the owner’s policy.',
      ],
    ),
    { kind: 'heading', ar: 'عقد الإيجار', en: 'Lease agreement' },
    ...pairBlocks(
      [
        'تُحدد مدة الإيجار والدفعات في عقد الإيجار النهائي، ويخضع العقد لقانون الإيجارات المعمول به في سلطنة عُمان وتسجيله لدى الجهات المختصة.',
        'يلتزم المستأجر بالمحافظة على الوحدة واستخدامها للغرض المخصص لها.',
      ],
      [
        'Lease term and payments are set in the final lease, which follows the rental law of the Sultanate of Oman and official registration.',
        'The tenant will take care of the unit and use it only for its intended purpose.',
      ],
    ),
  ];
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
