export type BookingTermsMode = 'rent' | 'sale' | 'daily';

export const BOOKING_TERMS_MODES: BookingTermsMode[] = ['sale', 'rent', 'daily'];

export const BOOKING_TERMS_MAX_LINES = 60;
export const BOOKING_TERMS_MAX_BODY = 12_000;
export const TERMS_MAX_BLOCKS = 150;
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
    ar: 'طريقة الاتصال الرسمية',
    en: 'Official Communication Method',
    clauses: [
      [
        'يجب تسليم جميع المراسلات الرسمية الكتابة باليد أو عناوين البريد الإلكتروني المسجلة في هذه الاتفاقية.',
        'All official communication must be delivered in writing by hand or the registered email addresses in this agreement.',
      ],
    ],
  },
  {
    ar: 'وديعة الحجز غير قابلة للاسترداد',
    en: 'Non-Refundable Booking Deposit',
    clauses: [
      [
        'في حالة عدم قيام المستأجر باستئجار الوحدة ، سيتم مصادرة وديعة الحجز غير القابلة للاسترداد.',
        'In case the Tenant does not proceed with renting the Unit, the non-refundable booking deposit will be forfeited.',
      ],
      [
        'بمجرد توقيع هذه الاتفاقية ودفع المستأجر إيجار الشهر الأول من اتفاقية الإيجار ، سيتم تحويل وديعة الحجز غير القابلة للاسترداد تلقائيًا إلى وديعة تأمين.',
        'Once this agreement is signed and the Tenant has paid the rent for the first month of the tenancy agreement, the non-refundable booking deposit will automatically be converted to a security deposit.',
      ],
    ],
  },
  {
    ar: 'مبلغ التأمين',
    en: 'Security Deposit',
    clauses: [
      [
        'يتعين على المستأجر إيداع إيجار شهر واحد والاحتفاظ به كوديعة ضمان طوال فترة الإيجار.',
        'The Tenant is required to deposit and maintain one month’s rent as a security deposit throughout the tenancy period.',
      ],
      [
        'وديعة الضمان قابلة للاسترداد بشرط استكمال المستأجر لفترة الإيجار الكاملة وفقًا للاتفاقية وتسوية جميع مستحقاته.',
        'The security deposit is refundable subject to the Tenant completing their full tenancy period as per the agreement and clearing all their dues.',
      ],
      [
        'إذا تم إنهاء عقد الإيجار مبكرًا لأي سبب من الأسباب ، فسيتم مصادرة وديعة التأمين.',
        'If the tenancy agreement is terminated early for any reason, the security deposit will be forfeited.',
      ],
    ],
  },
  {
    ar: 'شروط الدفع',
    en: 'Payment Terms',
    clauses: [
      [
        'يجب على المستأجر دفع الإيجار المستحق في اليوم الأول من الشهر مقدمًا.',
        'The Tenant must pay the due rent on the 01st of the month in advance.',
      ],
      [
        'يجب على المستأجر تقديم شيكات مؤجلة الدفع لكامل مدة عقد الإيجار.',
        'The Tenant must provide post-dated cheques for the entire duration of the tenancy agreement.',
      ],
      [
        'يجب على المستأجر تقديم 3 شيكات إضافية مفتوحة الدفع تعادل 3 أشهر من الإيجار. سيتم إيداعها من قبل المالك في حالة وجود أي إيجار مستحق أو مستحقات أخرى.',
        'The Tenant must provide 3 additional open-dated cheques equivalent to 3 months of rent. These will be deposited by the Landlord in case of any outstanding rent or other dues.',
      ],
      [
        'إذا فضل المستأجر دفع الإيجار عن طريق التحويل المصرفي بدلاً من ذلك ، فيجب تسوية الدفع قبل ثلاثة أيام عمل على الأقل من تاريخ استحقاق الإيجار. علاوة على ذلك ، يجب على المستأجر إبلاغ المالك بمجرد اكتمال التحويل المصرفي بطريقة اتصال رسمية.',
        'If the Tenant prefers to pay the rent by a bank transfer instead, the payment should be cleared at least three working days prior to the rent due date. Moreover, the Tenant should inform the Landlord once the bank transfer is completed by an official communication method.',
      ],
      [
        'تاريخ إيداع الشيك هو الأول من الشهر. في حالة ارتداد الشيك الخاص بالمستأجر في اليوم الأول ، سيقوم المالك بإيداعه مرة أخرى في اليوم العاشر من الشهر ، إلا إذا قام المستأجر بتخليص الإيجار عن طريق التحويل المصرفي قبل اليوم العاشر.',
        'The cheque deposit date is the 01st of the month. In case the Tenant’s cheque bounces on the 01st, the Landlord will deposit it again on the 10th of the month, unless the Tenant has cleared the rent by bank transfer prior to the 10th.',
      ],
      [
        'إذا ارتد شيك المستأجر بسبب عدم كفاية الأموال ، سيتم فرض غرامة قدرها 5٪ من مبلغ الشيك من قبل المالك.',
        'If the Tenant’s cheques bounce due to insufficient funds, a penalty of 5% of the cheque amount will be charged by the Landlord.',
      ],
    ],
  },
  {
    ar: 'المدفوعات المتأخرة',
    en: 'Late Payments',
    clauses: [
      [
        'إذا لم يتم استلام الإيجار بحلول الخامس عشر من الشهر ، فسيتم فرض غرامة تأخير قدرها 15٪ على قيمة الشيك في الخامس عشر من الشهر.',
        'If the rent is not received by the 15th of the month, a 15% late fee penalty will be charged on the cheque value on the 15th of the month.',
      ],
      [
        'سيتم فرض غرامة إضافية بنسبة 1٪ على رسوم التأخير عن كل يوم تأخير إضافي في الإيجار بعد اليوم الخامس عشر من الشهر ، على سبيل المثال: غرامة 17٪ رسوم تأخير إذا لم يتم دفع الإيجار حتى 17 من الشهر.',
        'An additional 1% late fee penalty will be charged for every additional day of delay in rent after the 15th of the month, e.g. a 17% late fee penalty if the rent is not paid until the 17th of the month.',
      ],
      [
        'إذا لم يتم دفع غرامة الرسوم المتأخرة بحلول نهاية الشهر ، فسيتم ترحيلها وتتراكم مع رسوم الغرامات المستقبلية.',
        'If the late fee penalty is not paid by the end of the month, it will carry forward and accumulate with future penalty fees.',
      ],
    ],
  },
  {
    ar: 'فواتير المياه والكهرباء',
    en: 'Utility Bills',
    clauses: [
      [
        'يتعين على المستأجر دفع جميع فواتير المرافق الخاصة بوحدته بالكامل كل شهر.',
        'The Tenant is required to pay all utility bills of their Unit in full every month.',
      ],
      [
        'إذا تراكمت فواتير المستأجر المجمعة للمياه والكهرباء لأكثر من 25٪ من الإيجار الشهري ، يحق للمالك فصل الكهرباء والمياه عن الوحدة واتخاذ الإجراءات القانونية. قد يتم أيضًا خصم مبلغ الفاتورة المعلقة من وديعة التأمين. مع تحمل المستأجر كافة التبعات القانونية والخسائر التي قد يتكبدها نتيجة قطع الخدمة عنه.',
        'If the Tenant’s combined bills for water and electricity accumulate to over 25% of their monthly rent, the Landlord has the right to disconnect the electricity and water of the Unit and take legal action. The pending bill amount may also be deducted from the security deposit. With the tenant bearing all the legal consequences and losses that he may incur as a result of cutting the service for him.',
      ],
      [
        'في حالة قيام المالك بدفع فواتير الخدمات نيابة عن المستأجر ، سيتم فرض رسوم خدمة بنسبة 5٪ من الإيجار الشهري.',
        'In case the Landlord pays the utility bills on the Tenant’s behalf, a service charge of 5% of the monthly rent will be charged.',
      ],
    ],
  },
  {
    ar: 'شروط الاقامة',
    en: 'Conditions of Stay',
    clauses: [
      [
        'يجب على المستأجر الالتزام بجميع التعليمات الصادرة عن المالك ، والتي قد تتغير خلال عقد الإيجار.',
        'The Tenant shall abide by all the instructions issued by the Landlord, which may change throughout the tenancy agreement.',
      ],
      ['لا يجوز للمستأجر تأجير الوحدة من الباطن.', 'The Tenant is not allowed to sublet the Unit.'],
      [
        'سيتم شغل الوحدة من قبل المستأجر وعائلته المباشرة فقط ، وسيتم استخدامها فقط للأغراض السكنية.',
        'The Unit will be occupied only by the Tenant and their immediate family, and used only for residential purposes.',
      ],
      [
        'لن يقوم المستأجر بإجراء أي تغييرات على الوحدة المؤجرة دون موافقة المالك. في حالة إجراء أي تغييرات دون موافقة المالك ، يحق للمالك إلغاء عقد الإيجار.',
        'The Tenant will not make any changes to the leased Unit without approval from the Landlord. In case any changes are made without the Landlord’s approval, the Landlord has the right to cancel the tenancy agreement.',
      ],
      [
        'يجب على المستأجر إعادة الوحدة في نهاية عقد الإيجار إلى الحالة الأصلية التي استلمها بها في بداية عقد الإيجار. إن عدم القيام بذلك سوف يتطلب من المالك تحميل جميع التكاليف على المستأجر للقيام بهذا العمل.',
        'The Tenant must return the Unit at the end of their tenancy agreement in the original condition that they received it in at the start of the tenancy agreement. Failure to do so will require the Landlord to charge all the costs to the Tenant to do such work.',
      ],
      [
        'سيكون المستأجر مسؤولاً عن أي ضرر يحدث لوحدته أو العقار بأكمله والذي يحدث من قبل المستأجر أو ضيوف المستأجر أو المدعوين.',
        'The Tenant will be liable for any damage occurring to their Unit or the entire Property which is done by the Tenant or the Tenant’s guests or invitees.',
      ],
      [
        'لن يضع المستأجر أي عناصر خارج الوحدة المؤجرة ، بما في ذلك على سبيل المثال لا الحصر المناطق العامة ، مثل الممرات والمصاعد والسلالم والطوابق السفلية وأرضية السقف.',
        'The Tenant will not place any items outside of their leased Unit, including but not limited to the public areas, such as corridors, elevators, staircase, basements and roof floor.',
      ],
      [
        'يجب على المستأجر صيانة العقار بطريقة تتوافق مع جميع متطلبات الصحة والسلامة. يجب على المستأجر الحفاظ على وحدته خالية من جميع القوارض والحشرات والحشرات التي تجذبها الظروف غير الصحية التي يسببها المستأجر ، ويكون مسؤولاً عن جميع الأضرار التي تسببها هذه الظروف.',
        'The Tenant shall maintain the property in a manner which conforms to all health and safety requirements. The Tenant shall keep their Unit free from all rodents, insects, and vermin attracted by unsanitary conditions caused by Tenant, and shall be responsible for all damage caused by such conditions.',
      ],
      [
        'لا يجوز للمستأجر إلقاء القمامة أو إلقاء القمامة في أي جزء من العقار بأكمله ، أو إلقاء أي شيء من النوافذ أو الأبواب أو قنوات التهوية.',
        'The Tenant will not litter or throw garbage in any part of the entire Property, or throw anything out of the windows, doors or ventilating ducts.',
      ],
      [
        'يجب ألا يسمح المستأجر أو يسمح بأي مركبات تخص المستأجر أو يتحكم فيه أو موظفيه أو مورديه أو زبائنه أو مدعويهم أو تفريغها أو ركنها في العقار في مناطق لم يوافق عليها المالك. عدم الالتزام بهذا سوف يصنف على أنه مخالفة وقوف.',
        'The Tenant shall not permit or allow any vehicles that belong to or are controlled by the Tenant or their employees, suppliers, customers or invitees to be loaded, unloaded or parked in the Property in areas not approved by the Landlord. Not abiding by this will be classified as a Parking Violation.',
      ],
      [
        'لن يتسبب المستأجر في إحداث ضوضاء وإزعاج مفرطة لشاغلي العقار الآخرين ، خاصة خلال ساعات العمل المتأخرة. يقوم المالك بإخطار المستأجر بهذه الشكاوى.',
        'The Tenant will not cause excessive noise and disturbances to other occupants of the Property, especially during late hours. The Landlord will notify the Tenant of such complaints.',
      ],
    ],
  },
  {
    ar: 'مخالفات الشروط',
    en: 'Violations of Conditions',
    clauses: [
      [
        'في حالة عدم التزام المستأجر بأي شروط للإقامة ، يحق للمالك فرض غرامة قدرها 5٪ من الإيجار الشهري لكل مخالفة في اليوم.',
        'In case the Tenant does not abide by any conditions of stay, the Landlord has the right to impose a penalty of 5% of the monthly rent per violation, per day.',
      ],
      [
        'إذا لم يقم المستأجر بحل المخالفة على الفور ، سيتم فرض غرامة يومية قدرها 5٪ من الإيجار الشهري عن كل يوم تستمر فيه المخالفة.',
        'If the Tenant does not resolve the violation immediately, a daily penalty of 5% of the monthly rent will be imposed for each day the violation continues.',
      ],
      [
        'إذا تجاوز الانتهاك المحدد شهرًا واحدًا من تاريخ التحذير ، أو إذا تلقى المستأجر انتهاكات جسيمة خلال فترة الإيجار ، يحق للمالك إنهاء عقد الإيجار ويجب على المستأجر إخلاء الوحدة على الفور. سيؤدي عدم القيام بذلك إلى اتخاذ إجراءات قانونية.',
        'If a specific violation exceeds 1 month from the date of warning, or if the Tenant receives significant violations during their tenancy period, the Landlord has the right to terminate the lease agreement and the Tenant should vacate the unit immediately. Failure to do so will result in legal action being taken.',
      ],
      [
        'في حالة مخالفة المستأجر لوقوف السيارات ، بالإضافة إلى الغرامة اليومية البالغة 5٪ من الإيجار الشهري ، يحق للمالك ، دون سابق إنذار ، إزالة أو سحب السيارة المعنية وتحميل التكاليف على المستأجر.',
        'In case of a Parking Violation by the Tenant, along with the daily penalty of 5% of the monthly rent, the Landlord shall have the right, without notice, to remove or tow away the vehicle involved and charge the costs to the Tenant.',
      ],
    ],
  },
  {
    ar: 'بطاقات الوصول ووسائل الراحة في المبنى',
    en: 'Access Cards and Building Amenities',
    clauses: [
      [
        'يحق للمالك فصل بطاقات الوصول إلى المبنى الخاصة بالمستأجر وجميع وسائل الراحة الأخرى في أي وقت في حالة عدم التزام المستأجر بأي من متطلبات الإيجار الخاصة بهم.',
        'The Landlord has the right to disconnect the Tenant’s building access cards and all other amenities anytime in case the Tenant does not abide by any of their tenancy requirements.',
      ],
    ],
  },
  {
    ar: 'إجراءات قانونية',
    en: 'Legal Action',
    clauses: [
      [
        'سيكون المستأجر مسؤولاً عن جميع النفقات القانونية التي يتحملها المالك في حالة حدوث أي انتهاك لهذا الإيجار.',
        'The Tenant will be liable for all legal expenses borne by the Landlord in case of any violation of this tenancy.',
      ],
    ],
  },
  {
    ar: 'الصيانة والتصليح',
    en: 'Maintenance and Repairs',
    clauses: [
      [
        'يوافق المستأجر على الحفاظ على نظافة وحدته ويتحمل مسؤولية الأضرار وتنظيف النوافذ وجميع الإصلاحات الطفيفة. تشمل الإصلاحات البسيطة استبدال البطاريات والمصابيح الكهربائية والأنابيب.',
        'Tenant agrees to keep their Unit clean and takes responsibility for damages, window cleaning and all minor repairs. Minor repairs include replacing batteries, light bulbs and tubes.',
      ],
    ],
  },
  {
    ar: 'حق الدخول',
    en: 'Right of Entry',
    clauses: [
      [
        'في حالة الطوارئ ، سيحاول المالك الاتصال بالمستأجر. في حالة عدم تلقي أي رد ، يحق للمالك دخول الوحدة.',
        'In case of emergencies, the Landlord will attempt to contact the Tenant. If no response is received, the Landlord has the right to enter the Unit.',
      ],
    ],
  },
  {
    ar: 'تجديد الإيجار',
    en: 'Tenancy Renewal',
    clauses: [
      [
        'للمالك الحق في زيادة الإيجار الشهري إلى أجل غير مسمى خلال تجديد عقد الإيجار.',
        'The Landlord has the right to increase the monthly rent indefinitely during the tenancy renewal.',
      ],
      [
        'قبل تجديد عقد الإيجار ، سيقدم المستأجر جميع المستندات المطلوبة ووديعة الضمان والشيكات المؤجلة. بدون هذه الشروط ، لن يتمكن المستأجر من تجديد عقد الإيجار الخاص به.',
        'Before renewing the tenancy agreement, the Tenant will provide all required documentation, security deposit and post-dated cheques. Without these, the Tenant will be unable to renew their tenancy agreement.',
      ],
      [
        'في حالة التأخير في تجديد عقد الإيجار بسبب المستأجر ، سيكون المستأجر مسؤولاً عن رسوم تجديد البلدية وجميع غرامات البلدية.',
        'In case of a delay in renewal of the tenancy agreement due to the Tenant, the Tenant will be liable for the Municipality renewal fee and all Municipality fines.',
      ],
    ],
  },
  {
    ar: 'إخلاء الوحدة',
    en: 'Vacating the Unit',
    clauses: [
      [
        'يجب على المستأجر إكمال الفترة الكاملة لعقد الإيجار.',
        'The Tenant must complete the full period of the tenancy agreement.',
      ],
      [
        'إذا رغب المستأجر في إخلاء الوحدة في نهاية عقد الإيجار ، فيجب تقديم إشعار لمدة 90 يومًا إلى المالك من خلال وسيلة اتصال رسمية.',
        'If the Tenant wishes to vacate the Unit at the end of their tenancy agreement, a 90-day notice must be given to the Landlord by an official communication method.',
      ],
      [
        'إذا قدم المستأجر إشعارًا مدته أقل من 90 يومًا لإخلاء الوحدة في نهاية اتفاقية الإيجار ، فسيكون المستأجر مسؤولاً عن الإيجار لمدة 90 يومًا من تاريخ إخطاره الرسمي.',
        'If the tenant gives less than a 90-day notice to vacate the Unit at the end of their tenancy agreement, the Tenant will be liable for rent for 90 days from the date of their official notice.',
      ],
      [
        'يحق للمالك رفض تسليم الوحدة بعد نهاية فترة الإيجار إذا لم يقم المستأجر بتصفية جميع مستحقاته بالكامل ، بما في ذلك على سبيل المثال لا الحصر: الإيجار وفواتير الخدمات ورسوم الغرامات.',
        'The Landlord has the right to refuse the handover of the Unit after the end of the tenancy period if the Tenant has not cleared all their dues in full, including but not limited to: rent, utility bills and penalty fees.',
      ],
      [
        'يلتزم المستأجر بدفع فواتير الإيجار والمرافق حتى اكتمال التسليم من قبل المالك.',
        'The Tenant will be obligated to pay rent and utility bills until the handover is completed by the Landlord.',
      ],
    ],
  },
  {
    ar: 'تسليم الوحدة',
    en: 'Handover of Unit',
    clauses: [
      [
        'يجب على المستأجر إكمال نموذج التسليم وإعادة جميع المفاتيح وبطاقات الوصول إلى مكتب المالك قبل إنهاء عقد الإيجار. سيصدر المالك استمارة براءة ذمة بمجرد اكتمال ذلك. بدون نموذج التخليص ، سيظل المستأجر مسؤولاً عن جميع المستحقات ، بما في ذلك فواتير الإيجار والمرافق.',
        'The Tenant must complete the handover form and return all keys and access cards to the Landlord’s office before the tenancy agreement can be ended. The Landlord will issue a clearance form once this is completed. Without the clearance form, the Tenant will continue to be liable for all dues, including rent and utility bills.',
      ],
      [
        'يجب على المستأجر إعادة الوحدة بنفس الحالة التي تم استلامها بها في بداية عقد الإيجار. سيؤدي عدم القيام بذلك إلى فرض رسوم على المستأجر.',
        'The Tenant must return the Unit in the same condition that it was received at the start of the tenancy. Failure to do so will result in charges to the Tenant.',
      ],
      [
        'يجب على المستأجر تنظيف الوحدة بعمق قبل التسليم. سيؤدي عدم القيام بذلك إلى فرض رسوم تنظيف على المستأجر.',
        'The Tenant must have the Unit deep cleaned prior to handover. Failure to do so will result in a cleaning fee charged to the Tenant.',
      ],
      [
        'سيكون المستأجر مسؤولاً عن أي أضرار تلحق بوحدة الملكية العامة.',
        'The Tenant will be responsible for any damages to the Unit or overall Property.',
      ],
      [
        'إذا لم يسلم المستأجر الوحدة بعد انتهاء عقد الإيجار ، فسيكون مسؤولاً عن دفع غرامة قدرها 3٪ من الإيجار الشهري لكل يوم ، بالإضافة إلى قيمة الإيجار الفعلية لتلك الفترة.',
        'If the Tenant does not handover the Unit after the expiration of the tenancy agreement, they will be liable for a penalty fee of 3% of the monthly rent for every day, as well as the actual rent value for that period.',
      ],
    ],
  },
  {
    ar: 'الرسوم والضرائب',
    en: 'Fees and Taxes',
    clauses: [
      [
        'المستأجر مسؤول عن جميع الرسوم والضرائب التي تفرضها الحكومة ، بما في ذلك على سبيل المثال لا الحصر ضريبة القيمة المضافة.',
        'The Tenant is liable for all fees and taxes imposed by the government, including but not limited to VAT.',
      ],
    ],
  },
  {
    ar: 'شرط الفصل',
    en: 'Severability Clause',
    clauses: [
      [
        'في حالة عدم صلاحية أي حكم في هذه الاتفاقية ، لن يتم المساس بصلاحية الشروط والأحكام المتبقية بأي شكل من الأشكال.',
        'In case any provision in this agreement shall be invalid, the validity of the remaining terms and conditions shall not be impaired in any way.',
      ],
    ],
  },
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
