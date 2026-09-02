'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { BrandMark } from '@bhd-r/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError, browserGet, browserMutation, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import type { StaySetupContext } from '@bhd-r/contracts';
import type { StaySetupPropertySummary } from '@/lib/stay-setup-neon';
import { PropertyOpsRowKey } from '@/components/property-ops-row-key';

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

function policiesToLines(policies: string[] | undefined, fallbackAr: string | null | undefined) {
  if (policies?.length) return policies.join('\n');
  if (fallbackAr?.trim()) return fallbackAr.trim();
  return DEFAULT_POLICIES_AR.join('\n');
}

function linesToPolicies(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•\-–—*]+/, '').trim())
    .filter(Boolean)
    .slice(0, 80);
}

function normalizeTime(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  return value.trim().slice(0, 5);
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
    unitTypeName: 'اسم نوع الوحدة (للعرض)',
    sectionTimes: 'أوقات الدخول والخروج',
    sectionGuests: 'سعة الضيوف',
    sectionNights: 'مدة الإقامة',
    sectionPolicies: 'السياسات',
    sectionInstructions: 'التعليمات',
    checkInFrom: 'وقت الدخول',
    dayUseCheckOut: 'وقت الخروج (بدون مبيت)',
    overnightCheckOut: 'وقت الخروج (عند المبيت)',
    dayUseMaxGuests: 'عدد الضيوف المسموح (بدون مبيت)',
    overnightMaxGuests: 'عدد الضيوف المسموح (مع المبيت)',
    minNights: 'الحد الأدنى لليالي',
    maxNights: 'الحد الأقصى لليالي',
    instantBook: 'حجز فوري',
    policiesHint: 'سطر واحد لكل سياسة — تظهر للضيف كما في صفحة العقار.',
    instructionsHint: 'تعليمات الوصول أو الاستخدام (اختياري).',
    useDefaultPolicies: 'استعادة السياسات الافتراضية',
    nightlyRate: 'إقامة مع مبيت',
    dayUseRate: 'إقامة بدون مبيت',
    overnightOnlyRate: 'مبيت فقط',
    deposit: 'مبلغ التأمين',
    depositHint: 'يُدفع عند الوصول ويُسترد بعد المغادرة وفحص العقار.',
    pricingHint: 'حدد أسعار أنواع الإقامة الثلاثة. إن تُرك حقل فارغاً يُستخدم سعر الإقامة مع مبيت.',
    usesPropertyDescription: 'يُستخدم وصف العقار الحالي تلقائياً — لا حاجة لإعادة كتابته.',
    previewTitle: 'معاينة كما ستظهر للجمهور',
    previewHint: 'معاينة تقريبية — بعد النشر ستُفتح صفحة الإقامة مباشرة.',
    review: 'راجع الإعداد قبل النشر',
    backToStays: 'العودة للوحة الإقامات',
    noUnits: 'لا توجد وحدات في هذا العقار.',
    location: 'الموقع',
    kind: 'النوع',
    unitsCount: 'الوحدات',
    status: 'الحالة',
    unitCode: 'رمز الوحدة',
    unitName: 'الوحدة',
    bedrooms: 'غرف',
    bathrooms: 'حمّامات',
    stayStatus: 'حالة الإقامة',
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
    unitTypeName: 'Unit type label (display)',
    sectionTimes: 'Check-in / check-out times',
    sectionGuests: 'Guest capacity',
    sectionNights: 'Stay length',
    sectionPolicies: 'Policies',
    sectionInstructions: 'Instructions',
    checkInFrom: 'Check-in time',
    dayUseCheckOut: 'Check-out (day use / no overnight)',
    overnightCheckOut: 'Check-out (overnight stay)',
    dayUseMaxGuests: 'Guests allowed (day use)',
    overnightMaxGuests: 'Guests allowed (overnight)',
    minNights: 'Minimum nights',
    maxNights: 'Maximum nights',
    instantBook: 'Instant book',
    policiesHint: 'One policy per line — shown to guests on the stay page.',
    instructionsHint: 'Access or house instructions (optional).',
    useDefaultPolicies: 'Restore default policies',
    nightlyRate: 'Stay with overnight',
    dayUseRate: 'Day use (no overnight)',
    overnightOnlyRate: 'Overnight only',
    deposit: 'Security deposit',
    depositHint: 'Paid on arrival and refunded after checkout inspection.',
    pricingHint: 'Set prices for all three stay types. Empty fields fall back to stay-with-overnight.',
    usesPropertyDescription: 'The existing property description is reused automatically.',
    previewTitle: 'Preview as guests will see it',
    previewHint: 'Approximate preview — after publish you will land on the live stay page.',
    review: 'Review before publishing',
    backToStays: 'Back to stays dashboard',
    noUnits: 'No units on this property.',
    location: 'Location',
    kind: 'Kind',
    unitsCount: 'Units',
    status: 'Status',
    unitCode: 'Unit code',
    unitName: 'Unit',
    bedrooms: 'Bedrooms',
    bathrooms: 'Bathrooms',
    stayStatus: 'Stay status',
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
  const [policiesText, setPoliciesText] = useState(DEFAULT_POLICIES_AR.join('\n'));
  const [instructionsAr, setInstructionsAr] = useState('');
  const [instructionsEn, setInstructionsEn] = useState('');
  const [nightlyRate, setNightlyRate] = useState('');
  const [dayUseRate, setDayUseRate] = useState('');
  const [overnightOnlyRate, setOvernightOnlyRate] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [slug, setSlug] = useState('');
  const [profileIds, setProfileIds] = useState<string[]>([]);

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
      const withProfiles = data.units.filter((unit) => unit.profileId);
      if (withProfiles.length) {
        setSelectedUnitIds(withProfiles.map((unit) => unit.id));
        setProfileIds(withProfiles.map((unit) => unit.profileId!).filter(Boolean));
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
      setPoliciesText(policiesToLines(draft.policiesJson, draft.policiesAr));
      setInstructionsAr(draft.instructionsAr ?? '');
      setInstructionsEn(draft.instructionsEn ?? '');
      if (draft.depositMinor) {
        const minorUnit =
          data.defaultCurrency === 'OMR' ||
          data.defaultCurrency === 'BHD' ||
          data.defaultCurrency === 'KWD'
            ? 3
            : 2;
        setDepositAmount(majorFromMinor(draft.depositMinor, minorUnit));
      }
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

  const reviewLines = useMemo(() => {
    if (!context) return [];
    const units = context.units.filter((unit) => selectedUnitIds.includes(unit.id));
    return [
      `${locale === 'ar' ? 'العقار' : 'Property'}: ${locale === 'ar' ? context.propertyNameAr : context.propertyNameEn}`,
      `${locale === 'ar' ? 'الوحدات' : 'Units'}: ${units.map((unit) => unit.code).join(', ') || '—'}`,
      `${t.checkInFrom}: ${checkInFrom}`,
      `${t.dayUseCheckOut}: ${dayUseCheckOutUntil}`,
      `${t.overnightCheckOut}: ${overnightCheckOutUntil}`,
      `${t.dayUseMaxGuests}: ${dayUseMaxGuests}`,
      `${t.overnightMaxGuests}: ${overnightMaxGuests}`,
      `${t.nightlyRate}: ${nightlyRate || '—'} ${currency}`,
      `${t.dayUseRate}: ${dayUseRate || '—'} ${currency}`,
      `${t.overnightOnlyRate}: ${overnightOnlyRate || '—'} ${currency}`,
      `${t.deposit}: ${depositAmount || '—'} ${currency}`,
      `slug: ${slug || '—'}`,
    ];
  }, [
    checkInFrom,
    context,
    currency,
    dayUseCheckOutUntil,
    dayUseMaxGuests,
    dayUseRate,
    depositAmount,
    locale,
    nightlyRate,
    overnightCheckOutUntil,
    overnightMaxGuests,
    overnightOnlyRate,
    selectedUnitIds,
    slug,
    t.checkInFrom,
    t.dayUseCheckOut,
    t.dayUseMaxGuests,
    t.dayUseRate,
    t.deposit,
    t.nightlyRate,
    t.overnightCheckOut,
    t.overnightMaxGuests,
    t.overnightOnlyRate,
  ]);

  const previewPriceLabel = useMemo(() => {
    const minor = minorFromMajor(nightlyRate, minorUnit);
    if (!minor) return null;
    return formatMoney(minor, currency, locale);
  }, [currency, locale, minorUnit, nightlyRate]);

  const previewCover = toPublicMediaSrc(propertySummary?.coverImageUrl ?? null);
  const policyPreview = linesToPolicies(policiesText).slice(0, 4);

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
    const policies = linesToPolicies(policiesText);
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
      policiesJson: policies,
      policiesAr: policies.join('\n') || null,
      policiesEn: null,
      instructionsAr: instructionsAr.trim() || null,
      instructionsEn: instructionsEn.trim() || null,
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
    const minor = minorFromMajor(nightlyRate, minorUnit);
    if (!minor) throw new Error(locale === 'ar' ? 'أدخل سعراً صالحاً' : 'Enter a valid rate');
    const dayUseMinor = dayUseRate.trim() ? minorFromMajor(dayUseRate, minorUnit) : null;
    const overnightOnlyMinor = overnightOnlyRate.trim()
      ? minorFromMajor(overnightOnlyRate, minorUnit)
      : null;
    if (dayUseRate.trim() && !dayUseMinor) {
      throw new Error(locale === 'ar' ? 'سعر بدون مبيت غير صالح' : 'Invalid day-use rate');
    }
    if (overnightOnlyRate.trim() && !overnightOnlyMinor) {
      throw new Error(locale === 'ar' ? 'سعر المبيت فقط غير صالح' : 'Invalid overnight-only rate');
    }
    const depositMinor = depositAmount.trim()
      ? minorFromMajor(depositAmount, minorUnit)
      : null;
    if (depositAmount.trim() && !depositMinor) {
      throw new Error(locale === 'ar' ? 'مبلغ التأمين غير صالح' : 'Invalid deposit amount');
    }
    const ids = resolveProfileIds();
    if (!ids.length) throw new Error(t.saveError);
    const ratePayload = {
      baseNightlyMinor: minor,
      ...(dayUseMinor ? { dayUseMinor } : {}),
      ...(overnightOnlyMinor ? { overnightOnlyMinor } : {}),
      currency,
      nameAr: 'السعر الأساسي',
      nameEn: 'Base rate',
      refundable: true,
    };
    const depositPayload = {
      depositMinor: depositMinor ?? null,
    };
    await Promise.all(
      ids.flatMap((id) => [
        writeAvailable
          ? browserNextMutation(`/api/owner/stays/setup`, {
              method: 'POST',
              body: JSON.stringify({ action: 'upsert_rate_plan', profileId: id, payload: ratePayload }),
            })
          : browserMutation(`/v1/stays/setup/profiles/${id}/rate-plan`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(ratePayload),
            }),
        writeAvailable
          ? browserNextMutation('/api/owner/stays/setup', {
              method: 'POST',
              body: JSON.stringify({
                action: 'update_profile',
                profileId: id,
                payload: depositPayload,
              }),
            })
          : browserMutation(`/v1/stays/setup/profiles/${id}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(depositPayload),
            }),
      ]),
    );
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
        router.push(`/stays/${encodeURIComponent(publishedSlug)}`);
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
              {!context?.units.length ? <p>{t.noUnits}</p> : null}
              <div className="ops-table-wrap stays-setup-units-table">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th scope="col" aria-label={locale === 'ar' ? 'اختيار' : 'Select'} />
                      <th scope="col">{t.unitCode}</th>
                      <th scope="col">{t.unitName}</th>
                      <th scope="col">{t.bedrooms}</th>
                      <th scope="col">{t.bathrooms}</th>
                      <th scope="col">{t.stayStatus}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {context?.units.map((unit) => (
                      <tr key={unit.id}>
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
                        <td dir="ltr">{unit.code}</td>
                        <td>{locale === 'ar' ? unit.nameAr : unit.nameEn}</td>
                        <td>{unit.bedrooms}</td>
                        <td>{unit.bathrooms}</td>
                        <td>{unit.publishStatus ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="field">
                <label htmlFor="unit-type-ar">{t.unitTypeName} (AR)</label>
                <input
                  id="unit-type-ar"
                  className="input"
                  value={unitTypeNameAr}
                  onChange={(event) => setUnitTypeNameAr(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="unit-type-en">{t.unitTypeName} (EN)</label>
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
                    onClick={() => setPoliciesText(DEFAULT_POLICIES_AR.join('\n'))}
                  >
                    {t.useDefaultPolicies}
                  </button>
                </div>
                <p className="muted">{t.policiesHint}</p>
                <textarea
                  id="policies"
                  className="input stays-setup-policies"
                  rows={10}
                  value={policiesText}
                  onChange={(event) => setPoliciesText(event.target.value)}
                />
              </section>

              <section className="stays-setup-section">
                <h3>{t.sectionInstructions}</h3>
                <p className="muted">{t.instructionsHint}</p>
                <div className="field">
                  <label htmlFor="instructions-ar">
                    {t.sectionInstructions} (AR)
                  </label>
                  <textarea
                    id="instructions-ar"
                    className="input"
                    rows={3}
                    value={instructionsAr}
                    onChange={(event) => setInstructionsAr(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="instructions-en">
                    {t.sectionInstructions} (EN)
                  </label>
                  <textarea
                    id="instructions-en"
                    className="input"
                    rows={3}
                    value={instructionsEn}
                    onChange={(event) => setInstructionsEn(event.target.value)}
                    dir="ltr"
                  />
                </div>
              </section>
            </fieldset>
          ) : null}

          {current === 'pricing' ? (
            <fieldset disabled={!canWrite || busy} className="stays-setup-wizard__fields">
              <p className="muted">{t.pricingHint}</p>
              <div className="stays-setup-rates">
                <div className="field">
                  <label htmlFor="nightly-rate">
                    {t.nightlyRate} ({currency})
                  </label>
                  <input
                    id="nightly-rate"
                    className="input"
                    inputMode="decimal"
                    value={nightlyRate}
                    onChange={(event) => setNightlyRate(event.target.value)}
                    placeholder={majorFromMinor('25000', minorUnit)}
                    dir="ltr"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="day-use-rate">
                    {t.dayUseRate} ({currency})
                  </label>
                  <input
                    id="day-use-rate"
                    className="input"
                    inputMode="decimal"
                    value={dayUseRate}
                    onChange={(event) => setDayUseRate(event.target.value)}
                    placeholder={majorFromMinor('15000', minorUnit)}
                    dir="ltr"
                  />
                </div>
                <div className="field">
                  <label htmlFor="overnight-only-rate">
                    {t.overnightOnlyRate} ({currency})
                  </label>
                  <input
                    id="overnight-only-rate"
                    className="input"
                    inputMode="decimal"
                    value={overnightOnlyRate}
                    onChange={(event) => setOvernightOnlyRate(event.target.value)}
                    placeholder={majorFromMinor('20000', minorUnit)}
                    dir="ltr"
                  />
                </div>
              </div>
              <section className="stays-setup-section">
                <h3>{t.deposit}</h3>
                <p className="muted">{t.depositHint}</p>
                <div className="field">
                  <label htmlFor="deposit">
                    {t.deposit} ({currency})
                  </label>
                  <input
                    id="deposit"
                    className="input"
                    inputMode="decimal"
                    value={depositAmount}
                    onChange={(event) => setDepositAmount(event.target.value)}
                    placeholder={majorFromMinor('30000', minorUnit)}
                    dir="ltr"
                  />
                </div>
              </section>
            </fieldset>
          ) : null}

          {current === 'publish' ? (
            <div className="stays-setup-review">
              <p className="muted">{t.review}</p>
              <p className="muted stays-setup-hint">{t.usesPropertyDescription}</p>
              <ul>
                {reviewLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>

              {policyPreview.length ? (
                <section className="stays-setup-section">
                  <h3>{t.sectionPolicies}</h3>
                  <ul className="stays-setup-policy-preview">
                    {policyPreview.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="stays-setup-preview" aria-label={t.previewTitle}>
                <h3>{t.previewTitle}</h3>
                <p className="muted">{t.previewHint}</p>
                <article className="listing-card stay-card stays-setup-preview__card">
                  <div className="listing-card__image">
                    {previewCover ? (
                      <Image
                        src={previewCover}
                        alt={locale === 'ar' ? listingTitleAr : listingTitleEn}
                        fill
                        sizes="320px"
                      />
                    ) : (
                      <div className="listing-card__placeholder" aria-hidden="true">
                        <BrandMark tone="onDark" />
                      </div>
                    )}
                  </div>
                  <div className="listing-card__body">
                    <h4>
                      {locale === 'ar'
                        ? listingTitleAr || context?.propertyNameAr
                        : listingTitleEn || context?.propertyNameEn}
                    </h4>
                    {propertySummary?.location ? (
                      <p className="listing-card__location">
                        {propertySummary.location.split(' · ').pop()}
                      </p>
                    ) : null}
                    <div className="listing-card__facts">
                      <span>
                        {overnightMaxGuests} {locale === 'ar' ? 'ضيوف' : 'guests'}
                      </span>
                      {previewPriceLabel ? (
                        <span>
                          {locale === 'ar' ? 'ابتداءً من' : 'From'}{' '}
                          <strong dir="ltr">{previewPriceLabel}</strong>{' '}
                          {locale === 'ar' ? 'لليلة' : 'per night'}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </article>
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
