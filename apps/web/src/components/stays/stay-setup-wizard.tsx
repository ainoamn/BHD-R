'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@bhd-r/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError, browserGet, browserMutation, browserNextMutation } from '@/lib/api';
import { translateText } from '@/lib/property-listing-copy';
import type { StayPublicDetail, StaySetupContext } from '@bhd-r/contracts';
import {
  buildStayPoliciesJson,
  linesToPolicyLines,
  parseStayPoliciesJson,
  type StayPolicySectionKey,
} from '@bhd-r/contracts';
import type { StaySetupPropertySummary } from '@/lib/stay-setup-neon';
import { PropertyOpsRowKey } from '@/components/property-ops-row-key';
import { StayPublicShowcase } from '@/components/stays/stay-public-showcase';

type StepId = 'units' | 'rules' | 'pricing' | 'publish';

const STEPS: StepId[] = ['units', 'rules', 'pricing', 'publish'];

const DEFAULT_POLICIES_AR = [
  'الإدارة غير مسؤولة عن فقدان المتعلقات الشخصية.',
  'يجب الحذر عند استخدام المسبح والإشراف على الأطفال.',
  'المحافظة على محتويات العقار والتخلص من النفايات في الأماكن المخصصة قبل المغادرة.',
  'يُخصم مبلغ التأمين عند أي ضرر يلحق بالعقار بسبب المستأجر.',
  'قد يُخصم مبلغ التأمين إذا تُرك المكان غير نظيف.',
  'يُمنع الأكل والشرب داخل المسبح واستخدام الصابون أو الشامبو في المسبح.',
  'يُمنع التدخين داخل الوحدات.',
  'الالتزام بوقت الخروج؛ التأخير قد يؤدي إلى خصم من التأمين.',
  'الالتزام بوقت الدخول.',
  'الالتزام بعدد الأشخاص المذكورين في الحجز؛ الأعداد الإضافية برسوم إضافية.',
  'يُمنع استخدام مكبرات الصوت.',
];

const DEFAULT_POLICIES_EN = [
  'Management is not responsible for lost personal belongings.',
  'Use the pool carefully and supervise children at all times.',
  'Take care of property contents and dispose of trash in designated areas before leaving.',
  'The security deposit will be deducted for damage caused by the guest.',
  'The security deposit may be deducted if the place is left unclean.',
  'No food, drink, soap, or shampoo in the swimming pool.',
  'Smoking inside the units is prohibited.',
  'Respect check-out time; delays may result in a deposit deduction.',
  'Respect check-in time.',
  'Stick to the booked guest count; extra guests incur additional fees.',
  'Loudspeakers are prohibited.',
];

const DEFAULT_CANCELLATION_AR = [
  'لا يُسمح بالإلغاء بعد تأكيد الحجز.',
  'يُسمح بتغيير التاريخ قبل 12 يوماً على الأقل من موعد الوصول.',
  'يُسمح بتغيير نوع الحجز (مع/بدون مبيت) حسب توفر الوحدة والفرق في السعر.',
];

const DEFAULT_CANCELLATION_EN = [
  'Cancellation is not allowed after booking confirmation.',
  'Date changes are allowed at least 12 days before arrival.',
  'Booking type changes (with/without overnight) are allowed subject to availability and price difference.',
];

const DEFAULT_EVENTS_AR = [
  'التجمعات العائلية الصغيرة.',
  'حفلات الزفاف (حسب التنسيق المسبق).',
  'حفلات أعياد الميلاد.',
  'لا تُسمح الحفلات الصاخبة أو الفعاليات التجارية دون موافقة مسبقة.',
];

const DEFAULT_EVENTS_EN = [
  'Small family gatherings.',
  'Weddings (by prior arrangement).',
  'Birthday parties.',
  'Loud parties or commercial events are not allowed without prior approval.',
];

const DEFAULT_PAYMENT_AR = [
  'يُدفع مبلغ التأمين عند الوصول.',
  'يُسترد التأمين بعد المغادرة وفحص العقار.',
  'يُدفع باقي المبلغ حسب طريقة الدفع المتفق عليها عند الحجز.',
  'قد تُطبّق رسوم إضافية على الأعداد الزائدة أو التأخير في المغادرة.',
];

const DEFAULT_PAYMENT_EN = [
  'Security deposit is paid on arrival.',
  'Deposit is refunded after checkout and property inspection.',
  'Remaining balance is paid via the agreed payment method at booking.',
  'Extra fees may apply for additional guests or late checkout.',
];

type TranslateKey =
  | 'unit-en'
  | 'unit-ar'
  | `policies-${StayPolicySectionKey}-en`
  | `policies-${StayPolicySectionKey}-ar`;

const POLICY_DEFAULTS: Record<
  StayPolicySectionKey,
  { ar: string[]; en: string[] }
> = {
  general: { ar: DEFAULT_POLICIES_AR, en: DEFAULT_POLICIES_EN },
  cancellation: { ar: DEFAULT_CANCELLATION_AR, en: DEFAULT_CANCELLATION_EN },
  events: { ar: DEFAULT_EVENTS_AR, en: DEFAULT_EVENTS_EN },
  payment: { ar: DEFAULT_PAYMENT_AR, en: DEFAULT_PAYMENT_EN },
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function minorFromMajor(amount: string, minorUnit = 3): string {
  const parsed = Number.parseFloat(amount.replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) return '';
  return String(Math.round(parsed * 10 ** minorUnit));
}

function majorFromMinor(minor: string, minorUnit = 3): string {
  const parsed = Number.parseInt(minor, 10);
  if (!Number.isFinite(parsed)) return '';
  const major = parsed / 10 ** minorUnit;
  if (Number.isInteger(major)) return String(major);
  return String(Number(major.toFixed(minorUnit)));
}

function linesToPolicies(text: string): string[] {
  return linesToPolicyLines(text);
}

type UnitPricingRow = {
  nightlyRate: string;
  dayUseRate: string;
  overnightOnlyRate: string;
  depositAmount: string;
};

function emptyUnitPricing(): UnitPricingRow {
  return {
    nightlyRate: '',
    dayUseRate: '',
    overnightOnlyRate: '',
    depositAmount: '',
  };
}

function hydrateUnitPricingFromContext(
  data: StaySetupContext,
  minorUnit: number,
): Record<string, UnitPricingRow> {
  const next: Record<string, UnitPricingRow> = {};
  const applyDraft = (
    unitId: string,
    draft: {
      baseNightlyMinor?: string | null | undefined;
      dayUseMinor?: string | null | undefined;
      overnightOnlyMinor?: string | null | undefined;
      depositMinor?: string | null | undefined;
    },
  ) => {
    next[unitId] = {
      nightlyRate: draft.baseNightlyMinor
        ? majorFromMinor(draft.baseNightlyMinor, minorUnit)
        : '',
      dayUseRate: draft.dayUseMinor ? majorFromMinor(draft.dayUseMinor, minorUnit) : '',
      overnightOnlyRate: draft.overnightOnlyMinor
        ? majorFromMinor(draft.overnightOnlyMinor, minorUnit)
        : '',
      depositAmount: draft.depositMinor ? majorFromMinor(draft.depositMinor, minorUnit) : '',
    };
  };
  for (const draft of data.unitPricingDrafts ?? []) {
    applyDraft(draft.unitId, draft);
  }
  const fallback = data.profileDraft;
  if (fallback) {
    for (const unit of data.units) {
      if (next[unit.id]) continue;
      applyDraft(unit.id, fallback);
    }
  }
  const donor = Object.values(next).find((row) => row.nightlyRate.trim());
  if (donor) {
    for (const unit of data.units) {
      const row = next[unit.id];
      if (row?.nightlyRate.trim()) continue;
      next[unit.id] = { ...donor };
    }
  }
  return next;
}

function policySectionText(
  sections: ReturnType<typeof parseStayPoliciesJson>,
  key: StayPolicySectionKey,
  locale: 'ar' | 'en',
): string {
  const section = sections[key];
  const text = locale === 'ar' ? section?.ar?.trim() : section?.en?.trim();
  if (text) return text;
  const fallback = locale === 'ar' ? section?.en?.trim() : section?.ar?.trim();
  if (fallback) return fallback;
  return POLICY_DEFAULTS[key][locale].join('\n');
}

function normalizeTime(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  return value.trim().slice(0, 5);
}

function stayStatusLabel(
  status: string | null | undefined,
  locale: 'ar' | 'en',
): { label: string; tone: 'positive' | 'warning' | 'info' | 'danger' } | null {
  if (!status) return null;
  const map: Record<string, { ar: string; en: string; tone: 'positive' | 'warning' | 'info' | 'danger' }> =
    {
      published: { ar: 'منشور', en: 'Published', tone: 'positive' },
      ready: { ar: 'جاهز', en: 'Ready', tone: 'info' },
      draft: { ar: 'مسودة', en: 'Draft', tone: 'warning' },
      unpublished: { ar: 'غير منشور', en: 'Unpublished', tone: 'danger' },
    };
  const entry = map[status];
  if (!entry) return { label: status, tone: 'info' };
  return { label: locale === 'ar' ? entry.ar : entry.en, tone: entry.tone };
}

const copy = {
  ar: {
    wizardTitle: 'إعداد الإقامة اليومية',
    wizardIntro: 'فعّل وحداتك للإقامة القصيرة دون المساس بإيجارك السنوي أو البيع.',
    comingOnline: 'الخدمة غير مفعّلة — تواصل مع الإدارة لتفعيل STAYS_PLATFORM_ENABLED',
    propertyRequired: 'افتح المعالج من صفحة العقار (إعداد الإقامة اليومية).',
    loadError: 'تعذر تحميل بيانات العقار.',
    saveError: 'تعذر الحفظ. حاول مجدداً.',
    publishError: 'تعذر النشر. تأكد من الأسعار والقواعد.',
    published: 'تم النشر — ستظهر الإقامة في /stays بعد دقائق.',
    back: 'رجوع',
    saveContinue: 'حفظ ومتابعة',
    publish: 'نشر الإقامة',
    publishing: 'جاري النشر…',
    steps: {
      units: 'اختيار الوحدات',
      rules: 'السعة والسياسات',
      pricing: 'الأسعار',
      publish: 'المراجعة والنشر',
    } satisfies Record<StepId, string>,
    selectUnits: 'اختر الوحدات المتاحة للإقامة اليومية',
    selectUnpublished: 'اختر غير المنشور فقط',
    selectAllUnits: 'اختر الكل',
    unitTypeName: 'اسم نوع الوحدة (للعرض)',
    sectionTimes: 'أوقات الدخول والخروج',
    sectionGuests: 'سعة الضيوف',
    sectionNights: 'مدة الإقامة',
    sectionPolicies: 'السياسات',
    sectionGeneralPolicies: 'السياسات العامة لمكان الإقامة',
    sectionCancellationPolicies: 'سياسات الإلغاء والتغيير',
    sectionEventsPolicies: 'المناسبات والحفلات المسموح بها',
    sectionPaymentPolicies: 'خيارات الدفع',
    checkInFrom: 'وقت الدخول',
    dayUseCheckOut: 'وقت الخروج (بدون مبيت)',
    overnightCheckOut: 'وقت الخروج (عند المبيت)',
    dayUseMaxGuests: 'عدد الضيوف المسموح (بدون مبيت)',
    overnightMaxGuests: 'عدد الضيوف المسموح (مع المبيت)',
    minNights: 'الحد الأدنى لليالي',
    maxNights: 'الحد الأقصى لليالي',
    instantBook: 'حجز فوري',
    policiesHint: 'سطر واحد لكل سياسة. اكتب بالعربية أو الإنجليزية ثم استخدم الترجمة التلقائية.',
    policiesAr: 'السياسات (عربي)',
    policiesEn: 'السياسات (إنجليزي)',
    useDefaultPolicies: 'استعادة السياسات الافتراضية',
    translateToEn: 'ترجمة إلى الإنجليزية',
    translateToAr: 'ترجمة إلى العربية',
    translating: 'جاري الترجمة…',
    nightlyRate: 'إقامة مع مبيت',
    dayUseRate: 'إقامة بدون مبيت',
    overnightOnlyRate: 'مبيت فقط',
    deposit: 'مبلغ التأمين',
    depositHint: 'يُدفع عند الوصول ويُسترد بعد المغادرة وفحص العقار.',
    pricingHint:
      'حدّد أسعار كل وحدة على حدة. إن تُرك حقل فارغاً يُستخدم سعر الإقامة مع مبيت للحقول الاختيارية.',
    pricingPerUnitHint: 'كل صف يمثل وحدة — يمكنك تسعير الشقق والمعارض بأسعار مختلفة.',
    usesPropertyDescription: 'يُستخدم وصف العقار الحالي تلقائياً — لا حاجة لإعادة كتابته.',
    previewTitle: 'معاينة كما ستظهر للجمهور',
    previewHint: 'راجع الصفحة العامة أدناه قبل النشر. عد للخطوات السابقة إن احتجت تعديلاً.',
    review: 'راجع الإعداد قبل النشر',
    backToStays: 'العودة للوحة الإقامات',
    noUnits: 'لا توجد وحدات في هذا العقار.',
    location: 'الموقع',
    kind: 'النوع',
    unitsCount: 'الوحدات',
    status: 'الحالة',
    photo: 'الصورة',
    unitCode: 'رمز الوحدة',
    unitName: 'الوحدة',
    bedrooms: 'غرف',
    bathrooms: 'حمّامات',
    stayStatus: 'حالة الإقامة',
    selectAction: 'الاختيار',
  },
  en: {
    wizardTitle: 'Daily stay setup',
    wizardIntro: 'Enable short stays without changing long-term rent or sale channels.',
    comingOnline: 'Stays is not enabled — ask ops to set STAYS_PLATFORM_ENABLED',
    propertyRequired: 'Open this wizard from the property page (Set up daily stay).',
    loadError: 'Could not load property data.',
    saveError: 'Save failed. Try again.',
    publishError: 'Publish failed. Check rates and rules.',
    published: 'Published — listing will appear on /stays shortly.',
    back: 'Back',
    saveContinue: 'Save & continue',
    publish: 'Publish stay',
    publishing: 'Publishing…',
    steps: {
      units: 'Select units',
      rules: 'Capacity & policies',
      pricing: 'Rates',
      publish: 'Review & publish',
    } satisfies Record<StepId, string>,
    selectUnits: 'Choose units available for daily stays',
    selectUnpublished: 'Select unpublished only',
    selectAllUnits: 'Select all',
    unitTypeName: 'Unit type label (display)',
    sectionTimes: 'Check-in / check-out times',
    sectionGuests: 'Guest capacity',
    sectionNights: 'Stay length',
    sectionPolicies: 'Policies',
    sectionGeneralPolicies: 'General stay policies',
    sectionCancellationPolicies: 'Cancellation & change policies',
    sectionEventsPolicies: 'Allowed events & parties',
    sectionPaymentPolicies: 'Payment options',
    checkInFrom: 'Check-in time',
    dayUseCheckOut: 'Check-out (day use / no overnight)',
    overnightCheckOut: 'Check-out (overnight stay)',
    dayUseMaxGuests: 'Guests allowed (day use)',
    overnightMaxGuests: 'Guests allowed (overnight)',
    minNights: 'Minimum nights',
    maxNights: 'Maximum nights',
    instantBook: 'Instant book',
    policiesHint: 'One policy per line. Write in Arabic or English, then use automatic translation.',
    policiesAr: 'Policies (Arabic)',
    policiesEn: 'Policies (English)',
    useDefaultPolicies: 'Restore default policies',
    translateToEn: 'Translate to English',
    translateToAr: 'Translate to Arabic',
    translating: 'Translating…',
    nightlyRate: 'Stay with overnight',
    dayUseRate: 'Day use (no overnight)',
    overnightOnlyRate: 'Overnight only',
    deposit: 'Security deposit',
    depositHint: 'Paid on arrival and refunded after checkout inspection.',
    pricingHint: 'Set prices per unit. Empty optional fields fall back to stay-with-overnight.',
    pricingPerUnitHint: 'Each row is one unit — apartments and showrooms can have different prices.',
    usesPropertyDescription: 'The existing property description is reused automatically.',
    previewTitle: 'Preview as guests will see it',
    previewHint: 'Review the public page below before publishing. Go back to edit anything.',
    review: 'Review before publishing',
    backToStays: 'Back to stays dashboard',
    noUnits: 'No units on this property.',
    location: 'Location',
    kind: 'Kind',
    unitsCount: 'Units',
    status: 'Status',
    photo: 'Photo',
    unitCode: 'Unit code',
    unitName: 'Unit',
    bedrooms: 'Bedrooms',
    bathrooms: 'Bathrooms',
    stayStatus: 'Stay status',
    selectAction: 'Select',
  },
} as const;

export function StaySetupWizard({
  locale,
  portal,
  propertyId,
  writeAvailable = false,
  apiAvailable = false,
  apiHint = null,
  initialContext = null,
  propertySummary = null,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  propertyId?: string | null;
  writeAvailable?: boolean;
  apiAvailable?: boolean;
  apiHint?: string | null;
  initialContext?: StaySetupContext | null;
  propertySummary?: StaySetupPropertySummary | null;
}) {
  const t = copy[locale];
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [context, setContext] = useState<StaySetupContext | null>(initialContext);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    !initialContext && apiHint ? apiHint : null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
  const [unitTypeId, setUnitTypeId] = useState<string | null>(null);
  const [unitTypeNameAr, setUnitTypeNameAr] = useState('');
  const [unitTypeNameEn, setUnitTypeNameEn] = useState('');
  const [dayUseMaxGuests, setDayUseMaxGuests] = useState('4');
  const [overnightMaxGuests, setOvernightMaxGuests] = useState('4');
  const [minNights, setMinNights] = useState('1');
  const [maxNights, setMaxNights] = useState('30');
  const [checkInFrom, setCheckInFrom] = useState('15:00');
  const [dayUseCheckOutUntil, setDayUseCheckOutUntil] = useState('23:00');
  const [overnightCheckOutUntil, setOvernightCheckOutUntil] = useState('11:00');
  const [instantBook, setInstantBook] = useState(true);
  const [policiesAr, setPoliciesAr] = useState(DEFAULT_POLICIES_AR.join('\n'));
  const [policiesEn, setPoliciesEn] = useState(DEFAULT_POLICIES_EN.join('\n'));
  const [cancellationPoliciesAr, setCancellationPoliciesAr] = useState(
    DEFAULT_CANCELLATION_AR.join('\n'),
  );
  const [cancellationPoliciesEn, setCancellationPoliciesEn] = useState(
    DEFAULT_CANCELLATION_EN.join('\n'),
  );
  const [eventsPoliciesAr, setEventsPoliciesAr] = useState(DEFAULT_EVENTS_AR.join('\n'));
  const [eventsPoliciesEn, setEventsPoliciesEn] = useState(DEFAULT_EVENTS_EN.join('\n'));
  const [paymentPoliciesAr, setPaymentPoliciesAr] = useState(DEFAULT_PAYMENT_AR.join('\n'));
  const [paymentPoliciesEn, setPaymentPoliciesEn] = useState(DEFAULT_PAYMENT_EN.join('\n'));
  const [unitPricing, setUnitPricing] = useState<Record<string, UnitPricingRow>>({});
  const [slug, setSlug] = useState('');
  const [profileIds, setProfileIds] = useState<string[]>([]);
  const [translating, setTranslating] = useState<TranslateKey | null>(null);

  const current = STEPS[step]!;
  const canWrite = Boolean(propertyId) && (writeAvailable || apiAvailable);

  function resolveProfileIds(): string[] {
    if (profileIds.length) return profileIds;
    if (!context) return [];
    return context.units
      .filter((unit) => selectedUnitIds.includes(unit.id) && unit.profileId)
      .map((unit) => unit.profileId as string);
  }

  const applyContext = useCallback(
    (data: StaySetupContext) => {
      setContext(data);
      setUnitTypeNameAr(data.propertyNameAr);
      setUnitTypeNameEn(data.propertyNameEn);
      if (data.unitTypes[0]) {
        setUnitTypeId(data.unitTypes[0].id);
        setUnitTypeNameAr(data.unitTypes[0].nameAr);
        setUnitTypeNameEn(data.unitTypes[0].nameEn);
      }
      if (data.listings[0]) {
        setSlug(data.listings[0].slug);
      } else if (data.units[0]) {
        setSlug(slugify(`${data.propertyNameEn}-${data.units[0].code}`));
      }
      const unpublished = data.units.filter((unit) => unit.publishStatus !== 'published');
      const withProfiles = data.units.filter((unit) => unit.profileId);
      const preferred = unpublished.length ? unpublished : withProfiles;
      if (preferred.length) {
        setSelectedUnitIds(preferred.map((unit) => unit.id));
        setProfileIds(
          preferred.map((unit) => unit.profileId).filter((id): id is string => Boolean(id)),
        );
      } else if (data.units.length === 1) {
        setSelectedUnitIds([data.units[0]!.id]);
      }

      const draft = data.profileDraft;
      if (!draft) return;
      const overnightGuests = draft.overnightMaxGuests ?? draft.maxGuests;
      if (overnightGuests) setOvernightMaxGuests(String(overnightGuests));
      if (draft.dayUseMaxGuests) setDayUseMaxGuests(String(draft.dayUseMaxGuests));
      else if (overnightGuests) setDayUseMaxGuests(String(overnightGuests));
      if (draft.minNights) setMinNights(String(draft.minNights));
      if (draft.maxNights) setMaxNights(String(draft.maxNights));
      if (typeof draft.instantBook === 'boolean') setInstantBook(draft.instantBook);
      if (draft.checkInFrom) setCheckInFrom(normalizeTime(draft.checkInFrom, '15:00'));
      if (draft.dayUseCheckOutUntil)
        setDayUseCheckOutUntil(normalizeTime(draft.dayUseCheckOutUntil, '23:00'));
      if (draft.overnightCheckOutUntil)
        setOvernightCheckOutUntil(normalizeTime(draft.overnightCheckOutUntil, '11:00'));
      const structured = parseStayPoliciesJson(draft.policiesJson, {
        policiesAr: draft.policiesAr ?? null,
        policiesEn: draft.policiesEn ?? null,
      });
      setPoliciesAr(policySectionText(structured, 'general', 'ar'));
      setPoliciesEn(policySectionText(structured, 'general', 'en'));
      setCancellationPoliciesAr(policySectionText(structured, 'cancellation', 'ar'));
      setCancellationPoliciesEn(policySectionText(structured, 'cancellation', 'en'));
      setEventsPoliciesAr(policySectionText(structured, 'events', 'ar'));
      setEventsPoliciesEn(policySectionText(structured, 'events', 'en'));
      setPaymentPoliciesAr(policySectionText(structured, 'payment', 'ar'));
      setPaymentPoliciesEn(policySectionText(structured, 'payment', 'en'));
      const pricingMinorUnit =
        data.defaultCurrency === 'OMR' ||
        data.defaultCurrency === 'BHD' ||
        data.defaultCurrency === 'KWD'
          ? 3
          : 2;
      setUnitPricing(hydrateUnitPricingFromContext(data, pricingMinorUnit));
    },
    [],
  );

  const loadContext = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError(null);
    try {
      if (writeAvailable) {
        const response = await fetch(
          `/api/owner/stays/setup/context?propertyId=${encodeURIComponent(propertyId)}`,
          { credentials: 'same-origin', headers: { accept: 'application/json' } },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: { messageAr?: string; message?: string };
          } | null;
          throw new Error(payload?.error?.messageAr ?? payload?.error?.message ?? t.loadError);
        }
        const data = (await response.json()) as {
          context: StaySetupContext;
          summary?: StaySetupPropertySummary;
        };
        applyContext(data.context);
        return;
      }
      if (!apiAvailable) return;
      const data = await browserGet<StaySetupContext>(
        `/v1/stays/setup/context?propertyId=${encodeURIComponent(propertyId)}`,
      );
      applyContext(data);
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : t.loadError;
      setError(detail);
    } finally {
      setLoading(false);
    }
  }, [apiAvailable, applyContext, propertyId, t.loadError, writeAvailable]);

  useEffect(() => {
    if (initialContext) {
      applyContext(initialContext);
      return;
    }
    void loadContext();
    // Hydrate once from SSR context or client Nest fetch — do not re-run on form edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, apiAvailable]);

  const currency = context?.defaultCurrency ?? 'OMR';
  const minorUnit = currency === 'OMR' || currency === 'BHD' || currency === 'KWD' ? 3 : 2;
  const listingTitleAr = unitTypeNameAr || context?.propertyNameAr || '';
  const listingTitleEn = unitTypeNameEn || context?.propertyNameEn || '';

  const selectedUnits = useMemo(
    () => context?.units.filter((unit) => selectedUnitIds.includes(unit.id)) ?? [],
    [context, selectedUnitIds],
  );

  const primaryUnit =
    selectedUnits[0] ?? context?.units.find((unit) => selectedUnitIds.includes(unit.id)) ?? context?.units[0];
  const primaryPricing = primaryUnit
    ? (unitPricing[primaryUnit.id] ?? emptyUnitPricing())
    : emptyUnitPricing();

  function patchUnitPricing(unitId: string, patch: Partial<UnitPricingRow>) {
    setUnitPricing((current) => ({
      ...current,
      [unitId]: { ...(current[unitId] ?? emptyUnitPricing()), ...patch },
    }));
  }

  const reviewLines = useMemo(() => {
    if (!context) return [];
    const pricingSummary = selectedUnits
      .map((unit) => {
        const row = unitPricing[unit.id] ?? emptyUnitPricing();
        return `${unit.code}: ${row.nightlyRate || '—'} ${currency}`;
      })
      .join(' · ');
    return [
      `${locale === 'ar' ? 'العقار' : 'Property'}: ${locale === 'ar' ? context.propertyNameAr : context.propertyNameEn}`,
      `${locale === 'ar' ? 'الوحدات' : 'Units'}: ${selectedUnits.map((unit) => unit.code).join(', ') || '—'}`,
      `${t.checkInFrom}: ${checkInFrom}`,
      `${t.dayUseCheckOut}: ${dayUseCheckOutUntil}`,
      `${t.overnightCheckOut}: ${overnightCheckOutUntil}`,
      `${t.dayUseMaxGuests}: ${dayUseMaxGuests}`,
      `${t.overnightMaxGuests}: ${overnightMaxGuests}`,
      `${t.nightlyRate}: ${pricingSummary || '—'}`,
      `slug: ${slug || '—'}`,
    ];
  }, [
    checkInFrom,
    context,
    currency,
    dayUseCheckOutUntil,
    dayUseMaxGuests,
    locale,
    overnightCheckOutUntil,
    overnightMaxGuests,
    selectedUnits,
    slug,
    t.checkInFrom,
    t.dayUseCheckOut,
    t.dayUseMaxGuests,
    t.nightlyRate,
    t.overnightCheckOut,
    t.overnightMaxGuests,
    unitPricing,
  ]);

  const previewDetail = useMemo((): StayPublicDetail | null => {
    if (!context) return null;
    const locationParts = propertySummary?.location?.split(' · ') ?? [];
    const nightlyMinor = minorFromMajor(primaryPricing.nightlyRate, minorUnit) || null;
    const dayUseMinor = primaryPricing.dayUseRate.trim()
      ? minorFromMajor(primaryPricing.dayUseRate, minorUnit) || null
      : null;
    const overnightOnlyMinor = primaryPricing.overnightOnlyRate.trim()
      ? minorFromMajor(primaryPricing.overnightOnlyRate, minorUnit) || null
      : null;
    const depositMinor = primaryPricing.depositAmount.trim()
      ? minorFromMajor(primaryPricing.depositAmount, minorUnit) || null
      : null;
    const primary = primaryUnit;
    const cover =
      primary?.coverImageUrl ??
      propertySummary?.coverImageUrl ??
      null;
    return {
      slug: slug.trim() || 'preview',
      titleAr: listingTitleAr || context.propertyNameAr,
      titleEn: listingTitleEn || context.propertyNameEn,
      descriptionAr:
        context.propertyDescriptionAr ?? propertySummary?.descriptionAr ?? null,
      descriptionEn:
        context.propertyDescriptionEn ?? propertySummary?.descriptionEn ?? null,
      destination: locationParts.at(-1) ?? null,
      wilayat: locationParts.at(-2) ?? null,
      city: locationParts.at(-3) ?? locationParts[0] ?? null,
      nightlyMinor,
      dayUseMinor,
      overnightOnlyMinor,
      currency: currency as StayPublicDetail['currency'],
      maxGuests: Number.parseInt(overnightMaxGuests, 10) || null,
      dayUseMaxGuests: Number.parseInt(dayUseMaxGuests, 10) || null,
      overnightMaxGuests: Number.parseInt(overnightMaxGuests, 10) || null,
      unitId: primary?.id,
      propertyId: context.propertyId,
      propertyNameAr: context.propertyNameAr,
      propertyNameEn: context.propertyNameEn,
      bedrooms: primary?.bedrooms ?? null,
      bathrooms: primary?.bathrooms ?? null,
      checkInFrom,
      checkOutUntil: overnightCheckOutUntil,
      dayUseCheckOutUntil,
      overnightCheckOutUntil,
      depositMinor,
      policiesAr: policiesAr.trim() || null,
      policiesEn: policiesEn.trim() || null,
      policiesJson: buildStayPoliciesJson({
        general: { ar: policiesAr, en: policiesEn },
        cancellation: { ar: cancellationPoliciesAr, en: cancellationPoliciesEn },
        events: { ar: eventsPoliciesAr, en: eventsPoliciesEn },
        payment: { ar: paymentPoliciesAr, en: paymentPoliciesEn },
      }),
      coverImageUrl: cover ?? null,
      imageUrls: cover ? [cover] : [],
    };
  }, [
    checkInFrom,
    context,
    currency,
    dayUseCheckOutUntil,
    dayUseMaxGuests,
    listingTitleAr,
    listingTitleEn,
    minorUnit,
    overnightCheckOutUntil,
    overnightMaxGuests,
    policiesAr,
    policiesEn,
    cancellationPoliciesAr,
    cancellationPoliciesEn,
    eventsPoliciesAr,
    eventsPoliciesEn,
    paymentPoliciesAr,
    paymentPoliciesEn,
    primaryPricing,
    primaryUnit,
    propertySummary,
    selectedUnitIds,
    slug,
  ]);

  const policySectionFields = useMemo(
    () =>
      [
        {
          key: 'general' as StayPolicySectionKey,
          title: t.sectionGeneralPolicies,
          ar: policiesAr,
          en: policiesEn,
          setAr: setPoliciesAr,
          setEn: setPoliciesEn,
        },
        {
          key: 'cancellation' as StayPolicySectionKey,
          title: t.sectionCancellationPolicies,
          ar: cancellationPoliciesAr,
          en: cancellationPoliciesEn,
          setAr: setCancellationPoliciesAr,
          setEn: setCancellationPoliciesEn,
        },
        {
          key: 'events' as StayPolicySectionKey,
          title: t.sectionEventsPolicies,
          ar: eventsPoliciesAr,
          en: eventsPoliciesEn,
          setAr: setEventsPoliciesAr,
          setEn: setEventsPoliciesEn,
        },
        {
          key: 'payment' as StayPolicySectionKey,
          title: t.sectionPaymentPolicies,
          ar: paymentPoliciesAr,
          en: paymentPoliciesEn,
          setAr: setPaymentPoliciesAr,
          setEn: setPaymentPoliciesEn,
        },
      ] as const,
    [
      t.sectionCancellationPolicies,
      t.sectionEventsPolicies,
      t.sectionGeneralPolicies,
      t.sectionPaymentPolicies,
      cancellationPoliciesAr,
      cancellationPoliciesEn,
      eventsPoliciesAr,
      eventsPoliciesEn,
      paymentPoliciesAr,
      paymentPoliciesEn,
      policiesAr,
      policiesEn,
    ],
  );

  async function runTranslate(
    source: string,
    target: 'ar' | 'en',
    apply: (value: string) => void,
    key: TranslateKey,
  ) {
    if (!source.trim()) return;
    setTranslating(key);
    setError(null);
    try {
      const translated = await translateText(source, target);
      apply(translated);
    } catch {
      setError(
        locale === 'ar'
          ? 'تعذّرت الترجمة التلقائية. عدّل النص يدوياً أو أعد المحاولة.'
          : 'Automatic translation failed. Edit manually or retry.',
      );
    } finally {
      setTranslating(null);
    }
  }

  async function ensureUnitType(): Promise<string> {
    if (unitTypeId) return unitTypeId;
    if (!propertyId) throw new Error('property_required');
    const overnight = Number.parseInt(overnightMaxGuests, 10) || 4;
    const payload = {
      propertyId,
      code: 'default',
      nameAr: unitTypeNameAr || context?.propertyNameAr || 'إقامة',
      nameEn: unitTypeNameEn || context?.propertyNameEn || 'Stay',
      maxGuests: overnight,
    };
    const created = writeAvailable
      ? await browserNextMutation<{ id: string }>('/api/owner/stays/setup', {
          method: 'POST',
          body: JSON.stringify({ action: 'create_unit_type', payload }),
        })
      : await browserMutation<{ id: string }>('/v1/stays/setup/unit-types', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
    setUnitTypeId(created.id);
    return created.id;
  }

  async function saveUnitsStep() {
    if (!propertyId || !selectedUnitIds.length) {
      throw new Error(locale === 'ar' ? 'اختر وحدة واحدة على الأقل' : 'Select at least one unit');
    }
    const typeId = await ensureUnitType();
    const payload = {
      propertyId,
      unitTypeId: typeId,
      unitIds: selectedUnitIds,
      currency,
    };
    const result = writeAvailable
      ? await browserNextMutation<{ profiles: Array<{ id: string; unitId: string }> }>(
          '/api/owner/stays/setup',
          {
            method: 'POST',
            body: JSON.stringify({ action: 'create_profiles', payload }),
          },
        )
      : await browserMutation<{ profiles: Array<{ id: string; unitId: string }> }>(
          '/v1/stays/setup/profiles',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
    setProfileIds(result.profiles.map((row) => row.id));
    setUnitTypeId(typeId);
  }

  async function saveRulesStep() {
    const ids = resolveProfileIds();
    if (!ids.length) throw new Error(t.saveError);
    const overnightGuests = Number.parseInt(overnightMaxGuests, 10) || 4;
    const dayGuests = Number.parseInt(dayUseMaxGuests, 10) || overnightGuests;
    const policies = linesToPolicies(policiesAr);
    const policiesJson = buildStayPoliciesJson({
      general: { ar: policiesAr, en: policiesEn },
      cancellation: { ar: cancellationPoliciesAr, en: cancellationPoliciesEn },
      events: { ar: eventsPoliciesAr, en: eventsPoliciesEn },
      payment: { ar: paymentPoliciesAr, en: paymentPoliciesEn },
    });
    const payload = {
      maxGuests: overnightGuests,
      maxAdults: overnightGuests,
      overnightMaxGuests: overnightGuests,
      dayUseMaxGuests: dayGuests,
      minNights: Number.parseInt(minNights, 10) || 1,
      maxNights: Number.parseInt(maxNights, 10) || 30,
      instantBook,
      checkInFrom,
      dayUseCheckOutUntil,
      overnightCheckOutUntil,
      checkOutUntil: overnightCheckOutUntil,
      policiesJson,
      policiesAr: policies.join('\n') || null,
      policiesEn: policiesEn.trim() || null,
      instructionsAr: null,
      instructionsEn: null,
    };
    await Promise.all(
      ids.map((id) =>
        writeAvailable
          ? browserNextMutation('/api/owner/stays/setup', {
              method: 'POST',
              body: JSON.stringify({ action: 'update_profile', profileId: id, payload }),
            })
          : browserMutation(`/v1/stays/setup/profiles/${id}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            }),
      ),
    );
  }

  async function savePricingStep() {
    const unitsToPrice = selectedUnits.filter((unit) => selectedUnitIds.includes(unit.id));
    if (!unitsToPrice.length) {
      throw new Error(locale === 'ar' ? 'اختر وحدة واحدة على الأقل' : 'Select at least one unit');
    }

    const saves: Promise<unknown>[] = [];
    for (const unit of unitsToPrice) {
      const resolvedProfileId = unit.profileId;
      if (!resolvedProfileId) {
        throw new Error(
          locale === 'ar'
            ? `احفظ خطوة الوحدات أولاً (${unit.code})`
            : `Save the units step first (${unit.code})`,
        );
      }

      const row = unitPricing[unit.id] ?? emptyUnitPricing();
      const minor = minorFromMajor(row.nightlyRate, minorUnit);
      if (!minor) {
        throw new Error(
          locale === 'ar'
            ? `أدخل سعراً صالحاً للوحدة ${unit.code}`
            : `Enter a valid rate for unit ${unit.code}`,
        );
      }
      const dayUseMinor = row.dayUseRate.trim() ? minorFromMajor(row.dayUseRate, minorUnit) : null;
      const overnightOnlyMinor = row.overnightOnlyRate.trim()
        ? minorFromMajor(row.overnightOnlyRate, minorUnit)
        : null;
      if (row.dayUseRate.trim() && !dayUseMinor) {
        throw new Error(locale === 'ar' ? 'سعر بدون مبيت غير صالح' : 'Invalid day-use rate');
      }
      if (row.overnightOnlyRate.trim() && !overnightOnlyMinor) {
        throw new Error(locale === 'ar' ? 'سعر المبيت فقط غير صالح' : 'Invalid overnight-only rate');
      }
      const depositMinor = row.depositAmount.trim()
        ? minorFromMajor(row.depositAmount, minorUnit)
        : null;
      if (row.depositAmount.trim() && !depositMinor) {
        throw new Error(locale === 'ar' ? 'مبلغ التأمين غير صالح' : 'Invalid deposit amount');
      }

      const ratePayload = {
        baseNightlyMinor: minor,
        ...(dayUseMinor ? { dayUseMinor } : {}),
        ...(overnightOnlyMinor ? { overnightOnlyMinor } : {}),
        currency,
        nameAr: 'السعر الأساسي',
        nameEn: 'Base rate',
        refundable: true,
      };
      const depositPayload = { depositMinor: depositMinor ?? null };

      saves.push(
        writeAvailable
          ? browserNextMutation(`/api/owner/stays/setup`, {
              method: 'POST',
              body: JSON.stringify({
                action: 'upsert_rate_plan',
                profileId: resolvedProfileId,
                payload: ratePayload,
              }),
            })
          : browserMutation(`/v1/stays/setup/profiles/${resolvedProfileId}/rate-plan`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(ratePayload),
            }),
      );
      saves.push(
        writeAvailable
          ? browserNextMutation('/api/owner/stays/setup', {
              method: 'POST',
              body: JSON.stringify({
                action: 'update_profile',
                profileId: resolvedProfileId,
                payload: depositPayload,
              }),
            })
          : browserMutation(`/v1/stays/setup/profiles/${resolvedProfileId}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(depositPayload),
            }),
      );
    }

    await Promise.all(saves);
  }

  async function ensureListingFromProperty() {
    if (!propertyId) throw new Error(t.saveError);
    const typeId = await ensureUnitType();
    const primary =
      context?.units.find((unit) => selectedUnitIds.includes(unit.id)) ?? context?.units[0];
    const autoSlug =
      slug.trim() ||
      slugify(`${listingTitleEn || context?.propertyNameEn || 'stay'}-${primary?.code ?? 'unit'}`);
    if (!autoSlug) throw new Error(locale === 'ar' ? 'الرابط مطلوب' : 'Slug is required');
    setSlug(autoSlug);
    const summaryAr =
      context?.propertyDescriptionAr?.trim() ||
      propertySummary?.descriptionAr?.trim() ||
      undefined;
    const summaryEn =
      context?.propertyDescriptionEn?.trim() ||
      propertySummary?.descriptionEn?.trim() ||
      undefined;
    const payload = {
      propertyId,
      unitTypeId: typeId,
      slug: autoSlug,
      titleAr: listingTitleAr.trim() || context?.propertyNameAr || 'إقامة',
      titleEn: listingTitleEn.trim() || context?.propertyNameEn || 'Stay',
      summaryAr,
      summaryEn,
    };
    if (writeAvailable) {
      await browserNextMutation('/api/owner/stays/setup', {
        method: 'POST',
        body: JSON.stringify({ action: 'upsert_listing', payload }),
      });
    } else {
      await browserMutation('/v1/stays/setup/listings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    return autoSlug;
  }

  async function publishAll() {
    const ids = resolveProfileIds();
    if (!ids.length) throw new Error(t.publishError);
    if (writeAvailable) {
      await browserNextMutation('/api/owner/stays/setup', {
        method: 'POST',
        body: JSON.stringify({ action: 'publish_profiles', profileIds: ids }),
      });
      return;
    }
    await Promise.all(
      ids.map((id) =>
        browserMutation(`/v1/stays/setup/profiles/${id}/publish`, { method: 'POST' }),
      ),
    );
  }

  async function handleNext() {
    if (!canWrite) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (current === 'units') await saveUnitsStep();
      if (current === 'rules') await saveRulesStep();
      if (current === 'pricing') await savePricingStep();
      setStep((value) => Math.min(STEPS.length - 1, value + 1));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t.saveError);
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (!canWrite) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const publishedSlug = await ensureListingFromProperty();
      await publishAll();
      setNotice(t.published);
      if (publishedSlug) {
        const focusUnit =
          selectedUnits.find((unit) => selectedUnitIds.includes(unit.id))?.id ??
          selectedUnitIds[0];
        const qs = focusUnit ? `?unit=${encodeURIComponent(focusUnit)}` : '';
        router.push(`/stays/${encodeURIComponent(publishedSlug)}${qs}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t.publishError);
    } finally {
      setBusy(false);
    }
  }

  function toggleUnit(unitId: string) {
    setSelectedUnitIds((current) =>
      current.includes(unitId) ? current.filter((id) => id !== unitId) : [...current, unitId],
    );
  }

  return (
    <div className="form-shell wizard-shell stays-setup-wizard">
      <header className="wizard-hero">
        <h1>{t.wizardTitle}</h1>
        <p className="wizard-hero__intro">{t.wizardIntro}</p>
        {!propertyId ? (
          <p className="notice notice--warning" role="status">
            {t.propertyRequired}
          </p>
        ) : null}
        {!canWrite ? (
          <p className="notice notice--warning" role="status">
            {apiHint ?? t.comingOnline}
          </p>
        ) : null}
        {loading ? <p className="muted">{locale === 'ar' ? 'جاري التحميل…' : 'Loading…'}</p> : null}
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="notice notice--success" role="status">
            {notice}
          </p>
        ) : null}
      </header>

      {propertySummary && propertyId ? (
        <section
          className="stays-setup-property-card card"
          aria-label={locale === 'ar' ? 'ملخص العقار' : 'Property summary'}
        >
          <div className="stays-setup-property-card__head">
            <PropertyOpsRowKey
              propertyId={propertyId}
              coverImageUrl={propertySummary.coverImageUrl}
              locale={locale}
              name={locale === 'ar' ? propertySummary.nameAr : propertySummary.nameEn}
            />
            <div>
              <h2 className="stays-setup-property-card__title">
                {locale === 'ar' ? propertySummary.nameAr : propertySummary.nameEn}
              </h2>
              {propertySummary.serialNumber ? (
                <p className="stays-setup-property-card__serial" dir="ltr">
                  {propertySummary.serialNumber}
                </p>
              ) : null}
            </div>
          </div>
          <dl className="stays-setup-property-card__meta">
            <div>
              <dt>{t.location}</dt>
              <dd>{propertySummary.location || '—'}</dd>
            </div>
            <div>
              <dt>{t.kind}</dt>
              <dd>{propertySummary.kind}</dd>
            </div>
            <div>
              <dt>{t.unitsCount}</dt>
              <dd>{propertySummary.unitCount}</dd>
            </div>
            <div>
              <dt>{t.status}</dt>
              <dd>{propertySummary.status}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <nav className="wizard-progress wizard-progress--desktop" aria-label={t.wizardTitle}>
        <ol className="wizard-progress__list">
          {STEPS.map((key, index) => {
            const state =
              index === step
                ? 'wizard-progress__item is-current'
                : index < step
                  ? 'wizard-progress__item is-done'
                  : 'wizard-progress__item';
            return (
              <li key={key} className={state}>
                <button
                  type="button"
                  className="wizard-progress__btn"
                  onClick={() => setStep(index)}
                  aria-current={index === step ? 'step' : undefined}
                >
                  <span className="wizard-progress__dot" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="wizard-progress__label">{t.steps[key]}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <form
        className="wizard-form card"
        onSubmit={(event) => {
          event.preventDefault();
          if (current === 'publish') void handlePublish();
          else void handleNext();
        }}
      >
        <div className="card__content">
          <h2>{t.steps[current]}</h2>

          {current === 'units' ? (
            <fieldset disabled={!canWrite || busy} className="stays-setup-wizard__fields">
              <p className="muted">{t.selectUnits}</p>
              {context?.units.length ? (
                <div className="stays-setup-wizard__unit-actions">
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={!canWrite || busy}
                    onClick={() => {
                      const unpublished = (context?.units ?? []).filter(
                        (unit) => unit.publishStatus !== 'published',
                      );
                      const target = unpublished.length ? unpublished : (context?.units ?? []);
                      setSelectedUnitIds(target.map((unit) => unit.id));
                      setProfileIds(
                        target
                          .map((unit) => unit.profileId)
                          .filter((id): id is string => Boolean(id)),
                      );
                    }}
                  >
                    {t.selectUnpublished}
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={!canWrite || busy}
                    onClick={() => {
                      const all = (context?.units ?? []).map((unit) => unit.id);
                      setSelectedUnitIds(all);
                      setProfileIds(
                        (context?.units ?? [])
                          .filter((unit) => unit.profileId)
                          .map((unit) => unit.profileId as string),
                      );
                    }}
                  >
                    {t.selectAllUnits}
                  </Button>
                </div>
              ) : null}
              {!context?.units.length ? <p>{t.noUnits}</p> : null}
              <div className="data-table-wrap ops-desktop-table stays-setup-units-table">
                <table className="data-table ops-table">
                  <thead>
                    <tr>
                      <th scope="col">{t.photo}</th>
                      <th scope="col">{t.unitCode}</th>
                      <th scope="col">{t.unitName}</th>
                      <th scope="col">{t.bedrooms}</th>
                      <th scope="col">{t.bathrooms}</th>
                      <th scope="col">{t.stayStatus}</th>
                      <th scope="col">{t.selectAction}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {context?.units.map((unit) => {
                      const status = stayStatusLabel(unit.publishStatus, locale);
                      return (
                        <tr key={unit.id}>
                          <td className="ops-table__thumb-cell">
                            <PropertyOpsRowKey
                              propertyId={propertyId || unit.id}
                              coverImageUrl={
                                unit.coverImageUrl ?? propertySummary?.coverImageUrl ?? null
                              }
                              locale={locale}
                              name={locale === 'ar' ? unit.nameAr : unit.nameEn}
                            />
                          </td>
                          <td dir="ltr">{unit.code}</td>
                          <td>{locale === 'ar' ? unit.nameAr : unit.nameEn}</td>
                          <td>{unit.bedrooms}</td>
                          <td>{unit.bathrooms}</td>
                          <td>
                            {status ? (
                              <span className={`ops-status ops-status--${status.tone}`}>
                                {status.label}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <label className="checkbox-row stays-setup-units-table__check">
                              <input
                                type="checkbox"
                                checked={selectedUnitIds.includes(unit.id)}
                                onChange={() => toggleUnit(unit.id)}
                              />
                              <span className="sr-only">
                                {locale === 'ar' ? unit.nameAr : unit.nameEn}
                              </span>
                            </label>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="field">
                <div className="stays-setup-wizard__summary-head">
                  <label htmlFor="unit-type-ar">{t.unitTypeName} (AR)</label>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={translating !== null || !unitTypeNameAr.trim()}
                    onClick={() =>
                      void runTranslate(unitTypeNameAr, 'en', setUnitTypeNameEn, 'unit-en')
                    }
                  >
                    {translating === 'unit-en' ? t.translating : t.translateToEn}
                  </Button>
                </div>
                <input
                  id="unit-type-ar"
                  className="input"
                  value={unitTypeNameAr}
                  onChange={(event) => setUnitTypeNameAr(event.target.value)}
                />
              </div>
              <div className="field">
                <div className="stays-setup-wizard__summary-head">
                  <label htmlFor="unit-type-en">{t.unitTypeName} (EN)</label>
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={translating !== null || !unitTypeNameEn.trim()}
                    onClick={() =>
                      void runTranslate(unitTypeNameEn, 'ar', setUnitTypeNameAr, 'unit-ar')
                    }
                  >
                    {translating === 'unit-ar' ? t.translating : t.translateToAr}
                  </Button>
                </div>
                <input
                  id="unit-type-en"
                  className="input"
                  value={unitTypeNameEn}
                  onChange={(event) => setUnitTypeNameEn(event.target.value)}
                  dir="ltr"
                />
              </div>
              <p className="muted stays-setup-hint">{t.usesPropertyDescription}</p>
            </fieldset>
          ) : null}

          {current === 'rules' ? (
            <fieldset disabled={!canWrite || busy} className="stays-setup-wizard__fields">
              <section className="stays-setup-section">
                <h3>{t.sectionTimes}</h3>
                <div className="field-grid stays-setup-times">
                  <div className="field">
                    <label htmlFor="check-in">{t.checkInFrom}</label>
                    <input
                      id="check-in"
                      className="input"
                      type="time"
                      value={checkInFrom}
                      onChange={(event) => setCheckInFrom(event.target.value)}
                      dir="ltr"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="day-use-out">{t.dayUseCheckOut}</label>
                    <input
                      id="day-use-out"
                      className="input"
                      type="time"
                      value={dayUseCheckOutUntil}
                      onChange={(event) => setDayUseCheckOutUntil(event.target.value)}
                      dir="ltr"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="overnight-out">{t.overnightCheckOut}</label>
                    <input
                      id="overnight-out"
                      className="input"
                      type="time"
                      value={overnightCheckOutUntil}
                      onChange={(event) => setOvernightCheckOutUntil(event.target.value)}
                      dir="ltr"
                    />
                  </div>
                </div>
              </section>

              <section className="stays-setup-section">
                <h3>{t.sectionGuests}</h3>
                <div className="field-grid">
                  <div className="field">
                    <label htmlFor="day-use-guests">{t.dayUseMaxGuests}</label>
                    <input
                      id="day-use-guests"
                      className="input"
                      inputMode="numeric"
                      value={dayUseMaxGuests}
                      onChange={(event) => setDayUseMaxGuests(event.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="overnight-guests">{t.overnightMaxGuests}</label>
                    <input
                      id="overnight-guests"
                      className="input"
                      inputMode="numeric"
                      value={overnightMaxGuests}
                      onChange={(event) => setOvernightMaxGuests(event.target.value)}
                    />
                  </div>
                </div>
              </section>

              <section className="stays-setup-section">
                <h3>{t.sectionNights}</h3>
                <div className="field-grid">
                  <div className="field">
                    <label htmlFor="min-nights">{t.minNights}</label>
                    <input
                      id="min-nights"
                      className="input"
                      inputMode="numeric"
                      value={minNights}
                      onChange={(event) => setMinNights(event.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="max-nights">{t.maxNights}</label>
                    <input
                      id="max-nights"
                      className="input"
                      inputMode="numeric"
                      value={maxNights}
                      onChange={(event) => setMaxNights(event.target.value)}
                    />
                  </div>
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={instantBook}
                    onChange={(event) => setInstantBook(event.target.checked)}
                  />
                  <span>{t.instantBook}</span>
                </label>
              </section>

              <section className="stays-setup-section">
                <div className="stays-setup-section__head">
                  <h3>{t.sectionPolicies}</h3>
                  <button
                    type="button"
                    className="button button--quiet"
                    onClick={() => {
                      setPoliciesAr(DEFAULT_POLICIES_AR.join('\n'));
                      setPoliciesEn(DEFAULT_POLICIES_EN.join('\n'));
                      setCancellationPoliciesAr(DEFAULT_CANCELLATION_AR.join('\n'));
                      setCancellationPoliciesEn(DEFAULT_CANCELLATION_EN.join('\n'));
                      setEventsPoliciesAr(DEFAULT_EVENTS_AR.join('\n'));
                      setEventsPoliciesEn(DEFAULT_EVENTS_EN.join('\n'));
                      setPaymentPoliciesAr(DEFAULT_PAYMENT_AR.join('\n'));
                      setPaymentPoliciesEn(DEFAULT_PAYMENT_EN.join('\n'));
                    }}
                  >
                    {t.useDefaultPolicies}
                  </button>
                </div>
                <p className="muted">{t.policiesHint}</p>
                {policySectionFields.map((section) => (
                  <div key={section.key} className="stays-setup-policies-section">
                    <h4>{section.title}</h4>
                    <div className="field">
                      <div className="stays-setup-wizard__summary-head">
                        <label htmlFor={`policies-${section.key}-ar`}>{t.policiesAr}</label>
                        <Button
                          type="button"
                          variant="quiet"
                          disabled={translating !== null || !section.ar.trim()}
                          onClick={() =>
                            void runTranslate(
                              section.ar,
                              'en',
                              section.setEn,
                              `policies-${section.key}-en`,
                            )
                          }
                        >
                          {translating === `policies-${section.key}-en`
                            ? t.translating
                            : t.translateToEn}
                        </Button>
                      </div>
                      <textarea
                        id={`policies-${section.key}-ar`}
                        className="input stays-setup-policies"
                        rows={section.key === 'general' ? 8 : 5}
                        value={section.ar}
                        onChange={(event) => section.setAr(event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <div className="stays-setup-wizard__summary-head">
                        <label htmlFor={`policies-${section.key}-en`}>{t.policiesEn}</label>
                        <Button
                          type="button"
                          variant="quiet"
                          disabled={translating !== null || !section.en.trim()}
                          onClick={() =>
                            void runTranslate(
                              section.en,
                              'ar',
                              section.setAr,
                              `policies-${section.key}-ar`,
                            )
                          }
                        >
                          {translating === `policies-${section.key}-ar`
                            ? t.translating
                            : t.translateToAr}
                        </Button>
                      </div>
                      <textarea
                        id={`policies-${section.key}-en`}
                        className="input stays-setup-policies"
                        rows={section.key === 'general' ? 8 : 5}
                        value={section.en}
                        onChange={(event) => section.setEn(event.target.value)}
                        dir="ltr"
                      />
                    </div>
                  </div>
                ))}
              </section>
            </fieldset>
          ) : null}

          {current === 'pricing' ? (
            <fieldset disabled={!canWrite || busy} className="stays-setup-wizard__fields">
              <p className="muted">{t.pricingHint}</p>
              {selectedUnits.length > 1 ? (
                <p className="muted stays-setup-hint">{t.pricingPerUnitHint}</p>
              ) : null}
              <div className="data-table-wrap">
                <table className="data-table ops-table stays-setup-pricing-table">
                  <thead>
                    <tr>
                      <th>{t.unitCode}</th>
                      <th>{t.unitName}</th>
                      <th>
                        {t.nightlyRate} ({currency})
                      </th>
                      <th>
                        {t.dayUseRate} ({currency})
                      </th>
                      <th>
                        {t.overnightOnlyRate} ({currency})
                      </th>
                      <th>
                        {t.deposit} ({currency})
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedUnits.map((unit) => {
                      const row = unitPricing[unit.id] ?? emptyUnitPricing();
                      const unitLabel =
                        locale === 'ar'
                          ? unit.nameAr || unit.code
                          : unit.nameEn || unit.code;
                      return (
                        <tr key={unit.id}>
                          <td dir="ltr">{unit.code}</td>
                          <td>{unitLabel}</td>
                          <td>
                            <input
                              className="input"
                              inputMode="decimal"
                              value={row.nightlyRate}
                              onChange={(event) =>
                                patchUnitPricing(unit.id, { nightlyRate: event.target.value })
                              }
                              placeholder={majorFromMinor('25000', minorUnit)}
                              dir="ltr"
                              required
                              aria-label={`${t.nightlyRate} ${unit.code}`}
                            />
                          </td>
                          <td>
                            <input
                              className="input"
                              inputMode="decimal"
                              value={row.dayUseRate}
                              onChange={(event) =>
                                patchUnitPricing(unit.id, { dayUseRate: event.target.value })
                              }
                              placeholder={majorFromMinor('15000', minorUnit)}
                              dir="ltr"
                              aria-label={`${t.dayUseRate} ${unit.code}`}
                            />
                          </td>
                          <td>
                            <input
                              className="input"
                              inputMode="decimal"
                              value={row.overnightOnlyRate}
                              onChange={(event) =>
                                patchUnitPricing(unit.id, {
                                  overnightOnlyRate: event.target.value,
                                })
                              }
                              placeholder={majorFromMinor('20000', minorUnit)}
                              dir="ltr"
                              aria-label={`${t.overnightOnlyRate} ${unit.code}`}
                            />
                          </td>
                          <td>
                            <input
                              className="input"
                              inputMode="decimal"
                              value={row.depositAmount}
                              onChange={(event) =>
                                patchUnitPricing(unit.id, { depositAmount: event.target.value })
                              }
                              placeholder={majorFromMinor('80000', minorUnit)}
                              dir="ltr"
                              aria-label={`${t.deposit} ${unit.code}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted">{t.depositHint}</p>
            </fieldset>
          ) : null}

          {current === 'publish' ? (
            <div className="stays-setup-review">
              <p className="muted">{t.review}</p>
              <p className="muted stays-setup-hint">{t.previewHint}</p>
              <details className="stays-setup-review__summary">
                <summary>{locale === 'ar' ? 'ملخص سريع' : 'Quick summary'}</summary>
                <ul>
                  {reviewLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>

              <section className="stays-setup-preview" aria-label={t.previewTitle}>
                <h3>{t.previewTitle}</h3>
                {previewDetail ? (
                  <StayPublicShowcase detail={previewDetail} locale={locale} preview />
                ) : (
                  <p className="muted">{t.loadError}</p>
                )}
                {slug.trim() ? (
                  <p className="stays-setup-preview__slug" dir="ltr">
                    /stays/{slug.trim()}
                  </p>
                ) : null}
              </section>
            </div>
          ) : null}
        </div>

        <div className="wizard-footer form-actions">
          <button
            type="button"
            className="button button--quiet"
            disabled={step === 0 || busy}
            onClick={() => setStep((value) => Math.max(0, value - 1))}
          >
            {t.back}
          </button>
          {current === 'publish' ? (
            <button type="submit" className="button button--primary" disabled={!canWrite || busy}>
              {busy ? t.publishing : t.publish}
            </button>
          ) : (
            <button type="submit" className="button button--primary" disabled={!canWrite || busy}>
              {busy ? (locale === 'ar' ? 'جاري الحفظ…' : 'Saving…') : t.saveContinue}
            </button>
          )}
        </div>
      </form>

      <p>
        <Link className="text-link" href={`/${portal}/stays`} prefetch scroll={false}>
          {t.backToStays}
        </Link>
      </p>
    </div>
  );
}
