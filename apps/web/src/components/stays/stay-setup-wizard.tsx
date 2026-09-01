'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { ApiError, browserGet, browserMutation } from '@/lib/api';
import type { StaySetupContext } from '@bhd-r/contracts';

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
    nightlyRate: 'السعر لليلة',
    titleAr: 'العنوان (عربي)',
    titleEn: 'العنوان (إنجليزي)',
    slug: 'الرابط (slug)',
    summaryAr: 'ملخص (عربي)',
    review: 'راجع الإعداد قبل النشر',
    backToStays: 'العودة للوحة الإقامات',
    noUnits: 'لا توجد وحدات في هذا العقار.',
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
    nightlyRate: 'Nightly rate',
    titleAr: 'Title (Arabic)',
    titleEn: 'Title (English)',
    slug: 'URL slug',
    summaryAr: 'Summary (Arabic)',
    review: 'Review before publishing',
    backToStays: 'Back to stays dashboard',
    noUnits: 'No units on this property.',
  },
} as const;

export function StaySetupWizard({
  locale,
  portal,
  propertyId,
  apiAvailable = false,
  apiHint = null,
  initialContext = null,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  propertyId?: string | null;
  apiAvailable?: boolean;
  apiHint?: string | null;
  initialContext?: StaySetupContext | null;
}) {
  const t = copy[locale];
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
  const [titleAr, setTitleAr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [slug, setSlug] = useState('');
  const [summaryAr, setSummaryAr] = useState('');
  const [profileIds, setProfileIds] = useState<string[]>([]);

  const current = STEPS[step]!;
  const canWrite = apiAvailable && Boolean(propertyId);

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
    if (!propertyId || !apiAvailable) return;
    setLoading(true);
    setError(null);
    try {
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
  }, [apiAvailable, applyContext, propertyId, t.loadError]);

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
      `${t.slug}: ${slug || '—'}`,
    ];
  }, [context, currency, locale, maxGuests, nightlyRate, selectedUnitIds, slug, t.maxGuests, t.nightlyRate, t.slug]);

  async function ensureUnitType(): Promise<string> {
    if (unitTypeId) return unitTypeId;
    if (!propertyId) throw new Error('property_required');
    const created = await browserMutation<{ id: string }>('/v1/stays/setup/unit-types', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId,
        code: 'default',
        nameAr: unitTypeNameAr || context?.propertyNameAr || 'إقامة',
        nameEn: unitTypeNameEn || context?.propertyNameEn || 'Stay',
        maxGuests: Number.parseInt(maxGuests, 10) || 4,
      }),
    });
    setUnitTypeId(created.id);
    return created.id;
  }

  async function saveUnitsStep() {
    if (!propertyId || !selectedUnitIds.length) {
      throw new Error(locale === 'ar' ? 'اختر وحدة واحدة على الأقل' : 'Select at least one unit');
    }
    const typeId = await ensureUnitType();
    const result = await browserMutation<{ profiles: Array<{ id: string; unitId: string }> }>(
      '/v1/stays/setup/profiles',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          unitTypeId: typeId,
          unitIds: selectedUnitIds,
          currency,
        }),
      },
    );
    setProfileIds(result.profiles.map((row) => row.id));
    setUnitTypeId(typeId);
  }

  async function saveCapacityStep() {
    const ids = profileIds.length ? profileIds : [];
    if (!ids.length) throw new Error(t.saveError);
    await Promise.all(
      ids.map((id) =>
        browserMutation(`/v1/stays/setup/profiles/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            maxGuests: Number.parseInt(maxGuests, 10) || 4,
            maxAdults: Number.parseInt(maxGuests, 10) || 4,
            minNights: Number.parseInt(minNights, 10) || 1,
            maxNights: Number.parseInt(maxNights, 10) || 30,
            instantBook,
            checkInFrom,
            checkOutUntil,
          }),
        }),
      ),
    );
  }

  async function savePricingStep() {
    const minor = minorFromMajor(nightlyRate, minorUnit);
    if (!minor) throw new Error(locale === 'ar' ? 'أدخل سعراً صالحاً' : 'Enter a valid rate');
    const ids = profileIds.length ? profileIds : [];
    if (!ids.length) throw new Error(t.saveError);
    await Promise.all(
      ids.map((id) =>
        browserMutation(`/v1/stays/setup/profiles/${id}/rate-plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            baseNightlyMinor: minor,
            currency,
            nameAr: 'السعر الأساسي',
            nameEn: 'Base rate',
            refundable: true,
          }),
        }),
      ),
    );
  }

  async function saveContentStep() {
    if (!propertyId || !unitTypeId) throw new Error(t.saveError);
    if (!slug.trim()) throw new Error(locale === 'ar' ? 'الرابط مطلوب' : 'Slug is required');
    await browserMutation('/v1/stays/setup/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        propertyId,
        unitTypeId,
        slug: slug.trim(),
        titleAr: titleAr.trim(),
        titleEn: titleEn.trim(),
        summaryAr: summaryAr.trim() || undefined,
      }),
    });
  }

  async function publishAll() {
    const ids = profileIds.length ? profileIds : [];
    if (!ids.length) throw new Error(t.publishError);
    for (const id of ids) {
      await browserMutation(`/v1/stays/setup/profiles/${id}/publish`, { method: 'POST' });
    }
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
    try {
      if (current !== 'publish') {
        await saveContentStep();
      }
      await publishAll();
      setNotice(t.published);
      await loadContext();
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
        ) : apiHint && context ? (
          <p className="notice notice--info" role="status">
            {apiHint}
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
              <ul className="stays-setup-units">
                {context?.units.map((unit) => (
                  <li key={unit.id}>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedUnitIds.includes(unit.id)}
                        onChange={() => toggleUnit(unit.id)}
                      />
                      <span>
                        {locale === 'ar' ? unit.nameAr : unit.nameEn} ({unit.code})
                        {unit.publishStatus ? ` · ${unit.publishStatus}` : ''}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
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
                <label htmlFor="summary-ar">{t.summaryAr}</label>
                <textarea
                  id="summary-ar"
                  className="input"
                  rows={3}
                  value={summaryAr}
                  onChange={(event) => setSummaryAr(event.target.value)}
                />
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
