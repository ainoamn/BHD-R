/**
 * Review rubrics of the two-sided stay reviews: what a guest rates about the property and its
 * management, and what a host rates about the guest. Each criterion is answered on a 1–5 scale
 * (or skipped when optional); scores are reported on 10.
 */

export type ReviewDirection = 'guest_to_host' | 'host_to_guest';
export type ReviewSide = 'property' | 'host' | 'guest';

export type ReviewCriterion = {
  key: string;
  ar: string;
  en: string;
  hintAr: string;
  hintEn: string;
  /** May be answered «لا ينطبق» (e.g. no kitchen in the unit). */
  optional?: boolean;
};

export type ReviewGroup = {
  key: string;
  ar: string;
  en: string;
  weight: number;
  /** Which public score the group feeds. */
  side: ReviewSide;
  criteria: ReviewCriterion[];
};

export const GUEST_RUBRIC: ReviewGroup[] = [
  {
    key: 'cleanliness',
    ar: 'النظافة',
    en: 'Cleanliness',
    weight: 0.35,
    side: 'property',
    criteria: [
      {
        key: 'clean_overall',
        ar: 'نظافة المكان عامةً',
        en: 'Overall cleanliness',
        hintAr: 'الانطباع العام عند الوصول',
        hintEn: 'First impression on arrival',
      },
      {
        key: 'clean_rooms',
        ar: 'نظافة الغرف',
        en: 'Rooms',
        hintAr: 'الأرضيات والأسطح والخزائن',
        hintEn: 'Floors, surfaces and wardrobes',
      },
      {
        key: 'clean_corridors',
        ar: 'نظافة الممرات والمداخل',
        en: 'Corridors and entrances',
        hintAr: 'المداخل والسلالم والمصاعد',
        hintEn: 'Entrances, stairs and lifts',
        optional: true,
      },
      {
        key: 'clean_bathrooms',
        ar: 'نظافة الحمامات والمرافق',
        en: 'Bathrooms and facilities',
        hintAr: 'الحمامات ودورات المياه والمغاسل',
        hintEn: 'Bathrooms, toilets and basins',
      },
      {
        key: 'clean_kitchen',
        ar: 'نظافة المطبخ وأدواته',
        en: 'Kitchen and utensils',
        hintAr: 'الأسطح والثلاجة والأواني',
        hintEn: 'Counters, fridge and dishes',
        optional: true,
      },
      {
        key: 'clean_beds',
        ar: 'نظافة الأسرّة والمفارش',
        en: 'Beds and linen',
        hintAr: 'الشراشف والوسائد والبطانيات',
        hintEn: 'Sheets, pillows and blankets',
      },
      {
        key: 'clean_furniture',
        ar: 'نظافة الكنب والأثاث',
        en: 'Sofas and furniture',
        hintAr: 'الكنب والسجاد والستائر',
        hintEn: 'Sofas, rugs and curtains',
      },
    ],
  },
  {
    key: 'property',
    ar: 'العقار',
    en: 'The property',
    weight: 0.3,
    side: 'property',
    criteria: [
      {
        key: 'accuracy',
        ar: 'مطابقة الوصف والصور',
        en: 'Matches the listing',
        hintAr: 'هل وجدت ما رأيته في الإعلان؟',
        hintEn: 'Was it what the listing showed?',
      },
      {
        key: 'condition',
        ar: 'حالة الأثاث والأجهزة',
        en: 'Furniture and appliances',
        hintAr: 'التكييف والإنترنت والأجهزة تعمل',
        hintEn: 'AC, internet and appliances work',
      },
      {
        key: 'comfort',
        ar: 'الراحة والهدوء',
        en: 'Comfort and quiet',
        hintAr: 'النوم والضوضاء والخصوصية',
        hintEn: 'Sleep, noise and privacy',
      },
      {
        key: 'location',
        ar: 'الموقع وسهولة الوصول',
        en: 'Location and access',
        hintAr: 'الوصول والمواقف والخدمات القريبة',
        hintEn: 'Getting there, parking, nearby services',
      },
      {
        key: 'value',
        ar: 'القيمة مقابل السعر',
        en: 'Value for money',
        hintAr: 'هل يستحق المبلغ المدفوع؟',
        hintEn: 'Was it worth the price?',
      },
    ],
  },
  {
    key: 'management',
    ar: 'المالك أو شركة إدارة العقار',
    en: 'Owner or management company',
    weight: 0.2,
    side: 'host',
    criteria: [
      {
        key: 'host_conduct',
        ar: 'حسن التعامل والاحترافية',
        en: 'Courtesy and professionalism',
        hintAr: 'الاحترام والالتزام بما اتُّفق عليه',
        hintEn: 'Respect, and keeping to what was agreed',
      },
      {
        key: 'communication',
        ar: 'سرعة الاستجابة والتواصل',
        en: 'Responsiveness',
        hintAr: 'الرد على الرسائل والاتصالات',
        hintEn: 'Replies to messages and calls',
      },
      {
        key: 'host_clarity',
        ar: 'وضوح الشروط والتعليمات',
        en: 'Clear terms and instructions',
        hintAr: 'لا رسوم ولا شروط مفاجئة',
        hintEn: 'No surprise fees or conditions',
      },
      {
        key: 'check_in',
        ar: 'سهولة الاستلام والتسليم',
        en: 'Check-in and check-out',
        hintAr: 'وضوح الإجراءات والمواعيد',
        hintEn: 'Clear steps and timing',
      },
      {
        key: 'problem_solving',
        ar: 'معالجة الملاحظات والأعطال',
        en: 'Handling issues',
        hintAr: 'إن واجهت مشكلة: هل حُلّت بسرعة؟',
        hintEn: 'If something went wrong, was it fixed fast?',
        optional: true,
      },
    ],
  },
  {
    key: 'staff_team',
    ar: 'الموظفون العاملون في المكان',
    en: 'On-site staff',
    weight: 0.15,
    side: 'host',
    criteria: [
      {
        key: 'staff',
        ar: 'تعامل الموظفين ولباقتهم',
        en: 'Staff attitude',
        hintAr: 'الاحترام والابتسامة واللباقة',
        hintEn: 'Respect, warmth and courtesy',
        optional: true,
      },
      {
        key: 'staff_help',
        ar: 'المساعدة وتلبية الطلبات',
        en: 'Help with requests',
        hintAr: 'سرعة الاستجابة لما طلبته',
        hintEn: 'How quickly they helped',
        optional: true,
      },
      {
        key: 'staff_knowledge',
        ar: 'المعرفة والإرشاد',
        en: 'Knowledge and guidance',
        hintAr: 'الإجابة عن أسئلتك وإرشادك في المكان',
        hintEn: 'Answering questions, showing you around',
        optional: true,
      },
      {
        key: 'staff_presence',
        ar: 'التواجد عند الحاجة',
        en: 'Available when needed',
        hintAr: 'سهولة الوصول إليهم',
        hintEn: 'Easy to reach',
        optional: true,
      },
    ],
  },
];

/** One-tap observations a guest can add; they guide the AI summary and the review analysis. */
export const GUEST_REVIEW_TAGS: Array<{
  key: string;
  tone: 'good' | 'bad';
  ar: string;
  en: string;
}> = [
  { key: 'spotless', tone: 'good', ar: 'نظافة لافتة', en: 'Spotless' },
  { key: 'as_pictured', tone: 'good', ar: 'مطابق للصور', en: 'As pictured' },
  { key: 'great_location', tone: 'good', ar: 'موقع ممتاز', en: 'Great location' },
  { key: 'quiet', tone: 'good', ar: 'هادئ ومريح', en: 'Quiet and comfortable' },
  { key: 'fast_replies', tone: 'good', ar: 'ردود سريعة', en: 'Fast replies' },
  { key: 'helpful_staff', tone: 'good', ar: 'موظفون متعاونون', en: 'Helpful staff' },
  { key: 'smooth_check_in', tone: 'good', ar: 'استلام سلس', en: 'Smooth check-in' },
  { key: 'good_value', tone: 'good', ar: 'يستحق السعر', en: 'Good value' },
  { key: 'noise', tone: 'bad', ar: 'ضوضاء', en: 'Noise' },
  { key: 'ac_issue', tone: 'bad', ar: 'مشكلة في التكييف', en: 'AC problem' },
  { key: 'weak_wifi', tone: 'bad', ar: 'إنترنت ضعيف', en: 'Weak Wi-Fi' },
  { key: 'late_check_in', tone: 'bad', ar: 'تأخر في الاستلام', en: 'Late check-in' },
  { key: 'bathroom_dirty', tone: 'bad', ar: 'نظافة الحمامات', en: 'Bathroom cleanliness' },
  { key: 'slow_replies', tone: 'bad', ar: 'تأخر في الرد', en: 'Slow replies' },
  { key: 'surprise_fees', tone: 'bad', ar: 'رسوم غير متوقعة', en: 'Unexpected fees' },
  { key: 'not_as_listed', tone: 'bad', ar: 'لا يطابق الإعلان', en: 'Not as listed' },
];

export const REVIEW_TAGS_MAX = 8;

/** Known tags of the direction (guest reviews only), labelled, in the order given. */
export function reviewTags(direction: ReviewDirection, keys: readonly string[] | undefined) {
  if (direction !== 'guest_to_host' || !keys?.length) return [];
  const wanted = new Set(keys);
  return GUEST_REVIEW_TAGS.filter((tag) => wanted.has(tag.key)).slice(0, REVIEW_TAGS_MAX);
}

export const HOST_RUBRIC: ReviewGroup[] = [
  {
    key: 'care',
    ar: 'العناية بالمكان',
    en: 'Care of the place',
    weight: 0.4,
    side: 'guest',
    criteria: [
      {
        key: 'clean_departure',
        ar: 'نظافة المكان عند المغادرة',
        en: 'Cleanliness on departure',
        hintAr: 'حالة الغرف والمطبخ والحمامات',
        hintEn: 'Rooms, kitchen and bathrooms',
      },
      {
        key: 'property_care',
        ar: 'المحافظة على الأثاث والممتلكات',
        en: 'Care of furniture and belongings',
        hintAr: 'لا تلفيات ولا مفقودات',
        hintEn: 'No damage, nothing missing',
      },
      {
        key: 'house_rules',
        ar: 'الالتزام بقواعد السكن',
        en: 'House rules',
        hintAr: 'التدخين والزوار والحيوانات',
        hintEn: 'Smoking, visitors, pets',
      },
    ],
  },
  {
    key: 'conduct',
    ar: 'السلوك والتعامل',
    en: 'Conduct',
    weight: 0.3,
    side: 'guest',
    criteria: [
      {
        key: 'quiet',
        ar: 'الهدوء وعدم الإزعاج',
        en: 'Quiet, no disturbance',
        hintAr: 'الجيران والمبنى',
        hintEn: 'Neighbours and the building',
      },
      {
        key: 'respect',
        ar: 'حسن التعامل والاحترام',
        en: 'Respect and manners',
        hintAr: 'مع المالك والفريق',
        hintEn: 'With the host and staff',
      },
      {
        key: 'communication',
        ar: 'التواصل والتجاوب',
        en: 'Communication',
        hintAr: 'الرد والوضوح',
        hintEn: 'Replies and clarity',
      },
    ],
  },
  {
    key: 'commitments',
    ar: 'الالتزامات',
    en: 'Commitments',
    weight: 0.3,
    side: 'guest',
    criteria: [
      {
        key: 'payment',
        ar: 'الالتزام بالدفع',
        en: 'Payment',
        hintAr: 'الدفع كاملاً وفي موعده',
        hintEn: 'Paid in full and on time',
      },
      {
        key: 'punctuality',
        ar: 'الالتزام بمواعيد الدخول والمغادرة',
        en: 'Check-in/out times',
        hintAr: 'الوصول والمغادرة في الوقت المتفق',
        hintEn: 'Arrived and left on time',
      },
    ],
  },
];

export function rubricFor(direction: ReviewDirection): ReviewGroup[] {
  return direction === 'guest_to_host' ? GUEST_RUBRIC : HOST_RUBRIC;
}

export const REVIEW_SCALE: Array<{ value: number; ar: string; en: string }> = [
  { value: 1, ar: 'سيئ جداً', en: 'Very poor' },
  { value: 2, ar: 'ضعيف', en: 'Poor' },
  { value: 3, ar: 'مقبول', en: 'Fair' },
  { value: 4, ar: 'جيد جداً', en: 'Very good' },
  { value: 5, ar: 'ممتاز', en: 'Excellent' },
];

export const REVIEW_COMMENT_MAX = 2000;
/** A low score needs a reason, so the other side and future readers know what went wrong. */
export const REVIEW_COMMENT_MIN_WHEN_LOW = 15;
export const REVIEW_LOW_SCORE = 6;
export const REVIEW_PHOTOS_MAX = 4;
export const REVIEW_PHOTO_MAX = 450_000;
export const REVIEW_PHOTO_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
/** Each side's review stays hidden from the other until both are in, or this many days pass. */
export const REVIEW_BLIND_DAYS = 14;

export type ReviewAnswers = Record<string, number>;

export type ReviewScores = {
  /** Weighted criteria score on 10. */
  criteria: number;
  /** Property side (guest reviews): cleanliness + property groups. */
  property: number | null;
  /** Management side (guest reviews). */
  host: number | null;
  groups: Array<{ key: string; score: number | null }>;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Answers that fit the rubric: required criteria present, every value an integer 1–5. */
export function validAnswers(direction: ReviewDirection, answers: ReviewAnswers): boolean {
  const known = new Map(
    rubricFor(direction).flatMap((group) => group.criteria.map((item) => [item.key, item])),
  );
  for (const [key, value] of Object.entries(answers)) {
    if (!known.has(key) || !Number.isInteger(value) || value < 1 || value > 5) return false;
  }
  for (const [key, item] of known) {
    if (!item.optional && answers[key] === undefined) return false;
  }
  return true;
}

function weightedScore(groups: ReviewGroup[], answers: ReviewAnswers): number | null {
  let total = 0;
  let weights = 0;
  for (const group of groups) {
    const score = average(
      group.criteria.flatMap((item) => (answers[item.key] ? [answers[item.key]! * 2] : [])),
    );
    if (score === null) continue;
    total += score * group.weight;
    weights += group.weight;
  }
  return weights ? total / weights : null;
}

export function scoreAnswers(direction: ReviewDirection, answers: ReviewAnswers): ReviewScores {
  const rubric = rubricFor(direction);
  const groups = rubric.map((group) => {
    const score = average(
      group.criteria.flatMap((item) => (answers[item.key] ? [answers[item.key]! * 2] : [])),
    );
    return { key: group.key, score: score === null ? null : round1(score) };
  });
  const criteria = weightedScore(rubric, answers) ?? 0;
  const side = (name: ReviewSide) => {
    const score = weightedScore(
      rubric.filter((group) => group.side === name),
      answers,
    );
    return score === null ? null : round1(score);
  };
  return {
    criteria: round1(criteria),
    property: direction === 'guest_to_host' ? side('property') : null,
    host: direction === 'guest_to_host' ? side('host') : null,
    groups,
  };
}

/**
 * Final score on 10: the criteria carry the review, the AI's reading of the written comment
 * moves it by at most its 20% share (no comment, no AI → criteria only).
 */
export function blendScore(criteria: number, aiText: number | null): number {
  if (aiText === null || !Number.isFinite(aiText)) return round1(criteria);
  const clamped = Math.min(10, Math.max(0, aiText));
  return round1(criteria * 0.8 + clamped * 0.2);
}

export function needsComment(direction: ReviewDirection, answers: ReviewAnswers): boolean {
  return scoreAnswers(direction, answers).criteria < REVIEW_LOW_SCORE;
}

export function reviewScoreLabel(ten: number, ar: boolean): string {
  if (ten >= 9) return ar ? 'استثنائي' : 'Exceptional';
  if (ten >= 8) return ar ? 'ممتاز' : 'Excellent';
  if (ten >= 7) return ar ? 'جيد جداً' : 'Very good';
  if (ten >= 6) return ar ? 'جيد' : 'Good';
  if (ten >= 5) return ar ? 'مقبول' : 'Fair';
  return ar ? 'ضعيف' : 'Poor';
}

export function reviewScoreTone(ten: number): 'great' | 'good' | 'fair' | 'poor' {
  if (ten >= 8) return 'great';
  if (ten >= 6.5) return 'good';
  if (ten >= 5) return 'fair';
  return 'poor';
}

/** «عبدالحميد ر.»: first name and the initial of the family name. */
export function publicPersonName(name: string | null | undefined): string | null {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      /^[A-Z][A-Z'-]+$/.test(word) ? word.charAt(0) + word.slice(1).toLowerCase() : word,
    );
  if (!words.length) return null;
  if (words.length === 1) return words[0]!;
  const last = words[words.length - 1]!;
  return `${words[0]} ${last.charAt(0)}.`;
}

export type ReviewText = { ar: string; en: string };

export type PublicReview = {
  id: string;
  direction: ReviewDirection;
  createdAt: string;
  stayMonth: string;
  authorName: string | null;
  /** Guest profile key of the author (guest reviews) or of the subject (host reviews). */
  guestKey: string | null;
  guestName: string | null;
  hostKey: string;
  hostName: ReviewText | null;
  propertyId: string;
  propertyName: ReviewText | null;
  score: number;
  propertyScore: number | null;
  hostScore: number | null;
  groups: Array<{ key: string; score: number | null }>;
  recommend: boolean | null;
  comment: string | null;
  /** The comment broke the platform rules (insults, personal data) and is not shown. */
  commentHidden: boolean;
  summary: ReviewText | null;
  highlights: ReviewText[];
  concerns: ReviewText[];
  photoIds: string[];
  aiEngine: string;
};

/** `unit`: one rentable unit of a property (a daily stay); it has no cached AI profile. */
export type ReputationSubject = 'property' | 'unit' | 'host' | 'guest';

export type Reputation = {
  subject: ReputationSubject;
  key: string;
  name: ReviewText | null;
  score: number | null;
  count: number;
  recommendRate: number | null;
  groups: Array<{ key: string; score: number | null }>;
  criteria: Array<{ key: string; score: number | null; count: number }>;
  profile: {
    summary: ReviewText | null;
    strengths: ReviewText[];
    watchouts: ReviewText[];
    engine: string;
    updatedAt: string;
  } | null;
  reviews: PublicReview[];
};

/** A guest's standing, shown to hosts on booking requests. */
export type GuestStanding = { key: string; score: number | null; count: number };

export function groupLabel(direction: ReviewDirection, key: string, ar: boolean): string {
  const group = rubricFor(direction).find((item) => item.key === key);
  return group ? (ar ? group.ar : group.en) : key;
}

export function criterionLabel(direction: ReviewDirection, key: string, ar: boolean): string {
  for (const group of rubricFor(direction)) {
    const item = group.criteria.find((criterion) => criterion.key === key);
    if (item) return ar ? item.ar : item.en;
  }
  return key;
}
