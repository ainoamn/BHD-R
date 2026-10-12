/** Handover (check-in / check-out) vocabulary shared by the host form and the server. */

export type HandoverKind = 'check_in' | 'check_out';

type Choice = { key: string; ar: string; en: string };

export const HANDOVER_NOTES: Record<HandoverKind, readonly Choice[]> = {
  check_in: [
    { key: 'keys_handed', ar: 'تم تسليم المفاتيح', en: 'Keys handed over' },
    { key: 'unit_clean', ar: 'الوحدة نظيفة وجاهزة', en: 'Unit clean and ready' },
    { key: 'unit_good', ar: 'الوحدة بحالة جيدة عند الاستلام', en: 'Unit in good condition' },
    {
      key: 'facilities_explained',
      ar: 'تم شرح المرافق وطريقة الاستخدام',
      en: 'Facilities explained',
    },
    { key: 'guests_match', ar: 'عدد الضيوف مطابق للحجز', en: 'Guest count matches the booking' },
    { key: 'id_verified', ar: 'تم التحقق من هوية المستلم', en: 'Recipient identity verified' },
    {
      key: 'access_card',
      ar: 'تم تسليم بطاقة الدخول / ريموت الموقف',
      en: 'Access card / parking remote handed over',
    },
    { key: 'deposit_received', ar: 'تم استلام مبلغ التأمين', en: 'Security deposit received' },
    { key: 'meters_recorded', ar: 'تم تسجيل قراءة العدادات', en: 'Meter readings recorded' },
    {
      key: 'late_arrival',
      ar: 'وصول متأخر بالتنسيق مع الضيف',
      en: 'Late arrival, coordinated with the guest',
    },
  ],
  check_out: [
    { key: 'keys_returned', ar: 'تمت إعادة المفاتيح', en: 'Keys returned' },
    { key: 'unit_good', ar: 'الوحدة بحالة جيدة', en: 'Unit in good condition' },
    { key: 'no_damage', ar: 'لا توجد أضرار', en: 'No damage found' },
    { key: 'minor_damage', ar: 'توجد أضرار بسيطة (موثّقة)', en: 'Minor damage noted' },
    { key: 'missing_items', ar: 'توجد مستلزمات ناقصة', en: 'Missing items noted' },
    {
      key: 'access_returned',
      ar: 'تمت إعادة بطاقة الدخول / الريموت',
      en: 'Access card / remote returned',
    },
    { key: 'deposit_refunded', ar: 'تمت إعادة مبلغ التأمين', en: 'Security deposit refunded' },
    { key: 'extra_cleaning', ar: 'تحتاج الوحدة تنظيفاً إضافياً', en: 'Extra cleaning needed' },
  ],
};

export const HANDOVER_DOCUMENT_KINDS: readonly Choice[] = [
  { key: 'civil_id', ar: 'البطاقة الشخصية', en: 'Civil ID card' },
  { key: 'resident_card', ar: 'بطاقة مقيم', en: 'Resident card' },
  { key: 'passport', ar: 'جواز السفر', en: 'Passport' },
  { key: 'gcc_id', ar: 'هوية خليجية', en: 'GCC ID' },
  { key: 'driving_licence', ar: 'رخصة القيادة', en: 'Driving licence' },
  { key: 'other', ar: 'وثيقة أخرى', en: 'Other document' },
];

export const HANDOVER_DOCUMENT_KEYS = HANDOVER_DOCUMENT_KINDS.map((item) => item.key) as [
  string,
  ...string[],
];

/** Digits with an optional leading + and spaces/dashes: 7–15 digits. */
export const HANDOVER_PHONE = /^\+?[0-9][0-9 -]{5,22}[0-9]$/;

export function validHandoverPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return HANDOVER_PHONE.test(value.trim()) && digits.length >= 7 && digits.length <= 15;
}

/** Largest stored document image (data URL characters, ~0.9 MB of JPEG). */
export const HANDOVER_DOCUMENT_MAX = 1_200_000;

/**
 * Condition photos of the unit at check-in / check-out. Six of the largest plus the ID image
 * stay under the 4.5 MB request limit of the hosting platform.
 */
export const HANDOVER_PHOTOS_MAX = 6;
export const HANDOVER_PHOTO_MAX = 450_000;
export const HANDOVER_PHOTO_SOURCES = ['camera', 'device'] as const;
export type HandoverPhotoSource = (typeof HANDOVER_PHOTO_SOURCES)[number];
export const HANDOVER_IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

/** A stored condition photo without its bytes: where it came from, when, and its fingerprint. */
export type HandoverPhoto = {
  index: number;
  source: HandoverPhotoSource;
  takenAt: string | null;
  sha256: string;
};

export function isHandoverPhotoSource(value: unknown): value is HandoverPhotoSource {
  return value === 'camera' || value === 'device';
}

export function handoverNote(kind: HandoverKind, key: string): Choice | null {
  return HANDOVER_NOTES[kind].find((item) => item.key === key) ?? null;
}

export function handoverDocumentKind(key: string | null | undefined): Choice | null {
  return HANDOVER_DOCUMENT_KINDS.find((item) => item.key === key) ?? null;
}

/** One line per chosen note in both languages, then the host's own note. */
export function composeHandoverNotes(
  kind: HandoverKind,
  keys: readonly string[],
  custom: string | null | undefined,
): string | null {
  const lines = keys
    .map((key) => handoverNote(kind, key))
    .filter((item): item is Choice => Boolean(item))
    .map((item) => `• ${item.ar} — ${item.en}`);
  const own = custom?.trim();
  if (own) lines.push(own);
  return lines.length ? lines.join('\n') : null;
}
