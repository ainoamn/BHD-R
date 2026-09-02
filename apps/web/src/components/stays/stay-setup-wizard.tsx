'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Button, BrandMark } from '@bhd-r/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError, browserGet, browserMutation, browserNextMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { generateListingDescriptions, translateText } from '@/lib/property-listing-copy';
import { toPublicMediaSrc } from '@/lib/public-media-url';
import type { StaySetupContext } from '@bhd-r/contracts';
import type { StaySetupPropertySummary } from '@/lib/stay-setup-neon';
import { PropertyOpsRowKey } from '@/components/property-ops-row-key';

type StepId = 'units' | 'capacity' | 'pricing' | 'content' | 'publish';

const STEPS: StepId[] = ['units', 'capacity', 'pricing', 'content', 'publish'];

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
  return (parsed / 10 ** minorUnit).toFixed(minorUnit);
}

const copy = {
  ar: {
    wizardTitle: 'إعداد الإقامة اليومية',
    wizardIntro: 'فعّل وحداتك للإقامة القصيرة دون المساس بإيجارك السنوي أو البيع.',
    comingOnline: 'الخدمة غير مفعّلة — تواصل مع الإدارة لتفعيل STAYS_PLATFORM_ENABLED',
    propertyRequired: 'افتح المعالج من صفحة العقار (إعداد الإقامة اليومية).',
    loadError: 'تعذر تحميل بيانات العقار.',
    saveError: 'تعذر الحفظ. حاول مجدداً.',
    publishError: 'تعذر النشر. تأكد من السعر والمحتوى.',
    published: 'تم النشر — ستظهر الإقامة في /stays بعد دقائق.',
    next: 'التالي',
    back: 'رجوع',
    saveContinue: 'حفظ ومتابعة',
    publish: 'نشر الإقامة',
    publishing: 'جاري النشر…',
    steps: {
      units: 'اختيار الوحدات',
      capacity: 'السعة والقواعد',
      pricing: 'السعر',
      content: 'العنوان والمحتوى',
      publish: 'المراجعة والنشر',
    } satisfies Record<StepId, string>,
    selectUnits: 'اختر الوحدات المتاحة للإقامة اليومية',
    unitTypeName: 'اسم نوع الوحدة (للعرض)',
    maxGuests: 'الحد الأقصى للضيوف',
    minNights: 'الحد الأدنى لليالي',
    maxNights: 'الحد الأقصى لليالي',
    checkInFrom: 'الدخول من',
    checkOutUntil: 'المغادرة قبل',
    instantBook: 'حجز فوري',
    nightlyRate: 'إقامة مع مبيت',
    dayUseRate: 'إقامة بدون مبيت',
    overnightOnlyRate: 'مبيت فقط',
    pricingHint: 'حدد أسعار أنواع الإقامة الثلاثة. إن تُرك حقل فارغاً يُستخدم سعر الإقامة مع مبيت.',
    titleAr: 'العنوان (عربي)',
    titleEn: 'العنوان (إنجليزي)',
    slug: 'الرابط (slug)',
    summaryAr: 'ملخص (عربي)',
    summaryEn: 'ملخص (إنجليزي)',
    generateSummary: 'توليد الملخص بالذكاء الاصطناعي',
    translateToEn: 'ترجمة إلى الإنجليزية',
    translateToAr: 'ترجمة إلى العربية',
    previewTitle: 'معاينة كما ستظهر للجمهور',
    previewHint: 'هذه معاينة تقريبية — بعد النشر ستُفتح صفحة الإقامة مباشرة.',
    viewListing: 'عرض صفحة الإقامة',
    review: 'راجع الإعداد قبل النشر',
    backToStays: 'العودة للوحة الإقامات',
    noUnits: 'لا توجد وحدات في هذا العقار.',
    propertyNo: 'رقم العقار',
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
    publishError: 'Publish failed. Check rate and listing content.',
    published: 'Published — listing will appear on /stays shortly.',
    next: 'Next',
    back: 'Back',
    saveContinue: 'Save & continue',
    publish: 'Publish stay',
    publishing: 'Publishing…',
    steps: {
      units: 'Select units',
      capacity: 'Capacity & rules',
      pricing: 'Nightly rate',
      content: 'Title & content',
      publish: 'Review & publish',
    } satisfies Record<StepId, string>,
    selectUnits: 'Choose units available for daily stays',
    unitTypeName: 'Unit type label (display)',
    maxGuests: 'Max guests',
    minNights: 'Minimum nights',
    maxNights: 'Maximum nights',
    checkInFrom: 'Check-in from',
    checkOutUntil: 'Check-out before',
    instantBook: 'Instant book',
    nightlyRate: 'Stay with overnight',
    dayUseRate: 'Day use (no overnight)',
    overnightOnlyRate: 'Overnight only',
    pricingHint: 'Set prices for all three stay types. Empty fields fall back to stay-with-overnight.',
    titleAr: 'Title (Arabic)',
    titleEn: 'Title (English)',
    slug: 'URL slug',
    summaryAr: 'Summary (Arabic)',
    summaryEn: 'Summary (English)',
    generateSummary: 'Generate summary with AI',
    translateToEn: 'Translate to English',
    translateToAr: 'Translate to Arabic',
    previewTitle: 'Preview as guests will see it',
    previewHint: 'Approximate preview — after publish you will land on the live stay page.',
    viewListing: 'View stay page',
    review: 'Review before publishing',
    backToStays: 'Back to stays dashboard',
    noUnits: 'No units on this property.',
    propertyNo: 'Property no.',
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
  const [maxGuests, setMaxGuests] = useState('4');
  const [minNights, setMinNights] = useState('1');
  const [maxNights, setMaxNights] = useState('30');
  const [checkInFrom, setCheckInFrom] = useState('15:00');
  const [checkOutUntil, setCheckOutUntil] = useState('11:00');
  const [instantBook, setInstantBook] = useState(true);
  const [nightlyRate, setNightlyRate] = useState('');
  const [dayUseRate, setDayUseRate] = useState('');
  const [overnightOnlyRate, setOvernightOnlyRate] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [slug, setSlug] = useState('');
  const [summaryAr, setSummaryAr] = useState('');
  const [summaryEn, setSummaryEn] = useState('');
  const [profileIds, setProfileIds] = useState<string[]>([]);
  const [translating, setTranslating] = useState<
    'title-en' | 'title-ar' | 'summary-en' | 'summary-ar' | null
  >(null);

  const current = STEPS[step]!;
  const canWrite = Boolean(propertyId) && (writeAvailable || apiAvailable);

  function resolveProfileIds(): string[] {
    if (profileIds.length) return profileIds;
    if (!context) return [];
    return context.units
      .filter((unit) => selectedUnitIds.includes(unit.id) && unit.profileId)
      .map((unit) => unit.profileId as string);
  }

  const applyContext = useCallback((data: StaySetupContext) => {
    setContext(data);
    setUnitTypeNameAr(data.propertyNameAr);
    setUnitTypeNameEn(data.propertyNameEn);
    setTitleAr(data.propertyNameAr);
    setTitleEn(data.propertyNameEn);
    if (data.unitTypes[0]) {
      setUnitTypeId(data.unitTypes[0].id);
      setUnitTypeNameAr(data.unitTypes[0].nameAr);
      setUnitTypeNameEn(data.unitTypes[0].nameEn);
    }
    if (data.listings[0]) {
      setSlug(data.listings[0].slug);
      setTitleAr(data.listings[0].titleAr);
      setTitleEn(data.listings[0].titleEn);
      setSummaryAr(data.listings[0].summaryAr ?? '');
      setSummaryEn(data.listings[0].summaryEn ?? '');
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
  }, []);

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

  const reviewLines = useMemo(() => {
    if (!context) return [];
    const units = context.units.filter((unit) => selectedUnitIds.includes(unit.id));
    return [
      `${locale === 'ar' ? 'العقار' : 'Property'}: ${locale === 'ar' ? context.propertyNameAr : context.propertyNameEn}`,
      `${locale === 'ar' ? 'الوحدات' : 'Units'}: ${units.map((unit) => unit.code).join(', ') || '—'}`,
      `${t.maxGuests}: ${maxGuests}`,
      `${t.nightlyRate}: ${nightlyRate || '—'} ${currency}`,
      `${t.dayUseRate}: ${dayUseRate || '—'} ${currency}`,
      `${t.overnightOnlyRate}: ${overnightOnlyRate || '—'} ${currency}`,
      `${t.slug}: ${slug || '—'}`,
    ];
  }, [
    context,
    currency,
    dayUseRate,
    locale,
    maxGuests,
    nightlyRate,
    overnightOnlyRate,
    selectedUnitIds,
    slug,
    t.dayUseRate,
    t.maxGuests,
    t.nightlyRate,
    t.overnightOnlyRate,
    t.slug,
  ]);

  const previewPriceLabel = useMemo(() => {
    const minor = minorFromMajor(nightlyRate, minorUnit);
    if (!minor) return null;
    return formatMoney(minor, currency, locale);
  }, [currency, locale, minorUnit, nightlyRate]);

  const previewCover = toPublicMediaSrc(propertySummary?.coverImageUrl ?? null);

  async function translateField(
    source: string,
    target: 'ar' | 'en',
    apply: (value: string) => void,
    key: 'title-en' | 'title-ar' | 'summary-en' | 'summary-ar',
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

  function runAiSummary() {
    if (!context) return;
    const primary =
      context.units.find((unit) => selectedUnitIds.includes(unit.id)) ?? context.units[0];
    if (!primary) return;
    const locationParts = propertySummary?.location?.split(' · ') ?? [];
    const generated = generateListingDescriptions({
      nameAr: titleAr.trim() || context.propertyNameAr,
      nameEn: titleEn.trim() || context.propertyNameEn,
      category: propertySummary?.kind === 'multi_unit' ? 'building' : 'apartment',
      governorate: locationParts.at(-1) ?? '',
      wilayat: locationParts.at(-2) ?? '',
      village: locationParts.at(-3) ?? '',
      street: locationParts[0] ?? '',
      bedrooms: primary.bedrooms,
      bathrooms: primary.bathrooms,
      majlis: 0,
      halls: 0,
      kitchens: 0,
      area: undefined,
      listingPurpose: 'rent',
      furnishing: '',
      amenities: [],
      multiUnit:
        propertySummary?.kind === 'multi_unit'
          ? {
              shopCount: 0,
              showroomCount: 0,
              apartmentCount: propertySummary.unitCount,
              totalArea: undefined,
              yearBuilt: undefined,
            }
          : undefined,
    });
    setSummaryAr(generated.descriptionAr);
    setSummaryEn(generated.descriptionEn);
  }

  async function ensureUnitType(): Promise<string> {
    if (unitTypeId) return unitTypeId;
    if (!propertyId) throw new Error('property_required');
    const payload = {
      propertyId,
      code: 'default',
      nameAr: unitTypeNameAr || context?.propertyNameAr || 'إقامة',
      nameEn: unitTypeNameEn || context?.propertyNameEn || 'Stay',
      maxGuests: Number.parseInt(maxGuests, 10) || 4,
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

  async function saveCapacityStep() {
    const ids = resolveProfileIds();
    if (!ids.length) throw new Error(t.saveError);
    const payload = {
      maxGuests: Number.parseInt(maxGuests, 10) || 4,
      maxAdults: Number.parseInt(maxGuests, 10) || 4,
      minNights: Number.parseInt(minNights, 10) || 1,
      maxNights: Number.parseInt(maxNights, 10) || 30,
      instantBook,
      checkInFrom,
      checkOutUntil,
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
    const ids = resolveProfileIds();
    if (!ids.length) throw new Error(t.saveError);
    const payload = {
      baseNightlyMinor: minor,
      ...(dayUseMinor ? { dayUseMinor } : {}),
      ...(overnightOnlyMinor ? { overnightOnlyMinor } : {}),
      currency,
      nameAr: 'السعر الأساسي',
      nameEn: 'Base rate',
      refundable: true,
    };
    await Promise.all(
      ids.map((id) =>
        writeAvailable
          ? browserNextMutation(`/api/owner/stays/setup`, {
              method: 'POST',
              body: JSON.stringify({ action: 'upsert_rate_plan', profileId: id, payload }),
            })
          : browserMutation(`/v1/stays/setup/profiles/${id}/rate-plan`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            }),
      ),
    );
  }

  async function saveContentStep() {
    if (!propertyId || !unitTypeId) throw new Error(t.saveError);
    if (!slug.trim()) throw new Error(locale === 'ar' ? 'الرابط مطلوب' : 'Slug is required');
    const payload = {
      propertyId,
      unitTypeId,
      slug: slug.trim(),
      titleAr: titleAr.trim(),
      titleEn: titleEn.trim(),
      summaryAr: summaryAr.trim() || undefined,
      summaryEn: summaryEn.trim() || undefined,
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
      if (current === 'capacity') await saveCapacityStep();
      if (current === 'pricing') await savePricingStep();
      if (current === 'content') await saveContentStep();
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
    const publishedSlug = slug.trim();
    try {
      if (current !== 'publish') {
        await saveContentStep();
      }
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
        <section className="stays-setup-property-card card" aria-label={locale === 'ar' ? 'ملخص العقار' : 'Property summary'}>
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
            </fieldset>
          ) : null}

          {current === 'capacity' ? (
            <fieldset disabled={!canWrite || busy} className="stays-setup-wizard__fields">
              <div className="field-grid">
                <div className="field">
                  <label htmlFor="max-guests">{t.maxGuests}</label>
                  <input
                    id="max-guests"
                    className="input"
                    inputMode="numeric"
                    value={maxGuests}
                    onChange={(event) => setMaxGuests(event.target.value)}
                  />
                </div>
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
                <div className="field">
                  <label htmlFor="check-in">{t.checkInFrom}</label>
                  <input
                    id="check-in"
                    className="input"
                    value={checkInFrom}
                    onChange={(event) => setCheckInFrom(event.target.value)}
                    dir="ltr"
                  />
                </div>
                <div className="field">
                  <label htmlFor="check-out">{t.checkOutUntil}</label>
                  <input
                    id="check-out"
                    className="input"
                    value={checkOutUntil}
                    onChange={(event) => setCheckOutUntil(event.target.value)}
                    dir="ltr"
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
            </fieldset>
          ) : null}

          {current === 'pricing' ? (
            <fieldset disabled={!canWrite || busy} className="stays-setup-wizard__fields">
              <p className="muted">{t.pricingHint}</p>
              <div className="field">
                <label htmlFor="nightly-rate">{t.nightlyRate} ({currency})</label>
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
                <label htmlFor="day-use-rate">{t.dayUseRate} ({currency})</label>
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
                <label htmlFor="overnight-only-rate">{t.overnightOnlyRate} ({currency})</label>
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
            </fieldset>
          ) : null}

          {current === 'content' ? (
            <fieldset disabled={!canWrite || busy} className="stays-setup-wizard__fields">
              <div className="field">
                <label htmlFor="title-ar">{t.titleAr}</label>
                <input
                  id="title-ar"
                  className="input"
                  value={titleAr}
                  onChange={(event) => setTitleAr(event.target.value)}
                />
                <div className="hero-actions stays-setup-wizard__field-actions">
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={translating !== null || !titleAr.trim()}
                    onClick={() =>
                      void translateField(titleAr, 'en', setTitleEn, 'title-en')
                    }
                  >
                    {translating === 'title-en' ? '…' : t.translateToEn}
                  </Button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="title-en">{t.titleEn}</label>
                <input
                  id="title-en"
                  className="input"
                  value={titleEn}
                  onChange={(event) => setTitleEn(event.target.value)}
                  dir="ltr"
                />
                <div className="hero-actions stays-setup-wizard__field-actions">
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={translating !== null || !titleEn.trim()}
                    onClick={() =>
                      void translateField(titleEn, 'ar', setTitleAr, 'title-ar')
                    }
                  >
                    {translating === 'title-ar' ? '…' : t.translateToAr}
                  </Button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="slug">{t.slug}</label>
                <input
                  id="slug"
                  className="input"
                  value={slug}
                  onChange={(event) => setSlug(slugify(event.target.value))}
                  dir="ltr"
                />
              </div>
              <div className="field">
                <div className="stays-setup-wizard__summary-head">
                  <label htmlFor="summary-ar">{t.summaryAr}</label>
                  <div className="hero-actions">
                    <Button type="button" variant="quiet" onClick={runAiSummary}>
                      {t.generateSummary}
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={translating !== null || !summaryAr.trim()}
                      onClick={() =>
                        void translateField(summaryAr, 'en', setSummaryEn, 'summary-en')
                      }
                    >
                      {translating === 'summary-en' ? '…' : t.translateToEn}
                    </Button>
                  </div>
                </div>
                <textarea
                  id="summary-ar"
                  className="input"
                  rows={4}
                  value={summaryAr}
                  onChange={(event) => setSummaryAr(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="summary-en">{t.summaryEn}</label>
                <textarea
                  id="summary-en"
                  className="input"
                  rows={4}
                  value={summaryEn}
                  onChange={(event) => setSummaryEn(event.target.value)}
                  dir="ltr"
                />
                <div className="hero-actions stays-setup-wizard__field-actions">
                  <Button
                    type="button"
                    variant="quiet"
                    disabled={translating !== null || !summaryEn.trim()}
                    onClick={() =>
                      void translateField(summaryEn, 'ar', setSummaryAr, 'summary-ar')
                    }
                  >
                    {translating === 'summary-ar' ? '…' : t.translateToAr}
                  </Button>
                </div>
              </div>
            </fieldset>
          ) : null}

          {current === 'publish' ? (
            <div className="stays-setup-review">
              <p className="muted">{t.review}</p>
              <ul>
                {reviewLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>

              <section className="stays-setup-preview" aria-label={t.previewTitle}>
                <h3>{t.previewTitle}</h3>
                <p className="muted">{t.previewHint}</p>
                <article className="listing-card stay-card stays-setup-preview__card">
                  <div className="listing-card__image">
                    {previewCover ? (
                      <Image
                        src={previewCover}
                        alt={locale === 'ar' ? titleAr : titleEn}
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
                    <h4>{locale === 'ar' ? titleAr || context?.propertyNameAr : titleEn || context?.propertyNameEn}</h4>
                    {propertySummary?.location ? (
                      <p className="listing-card__location">{propertySummary.location.split(' · ').pop()}</p>
                    ) : null}
                    <div className="listing-card__facts">
                      <span>
                        {maxGuests} {locale === 'ar' ? 'ضيوف' : 'guests'}
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
