'use client';

import { useState } from 'react';
import { Link } from '@/i18n/navigation';

const STEPS = [
  'stepUnits',
  'stepUnitTypes',
  'stepCapacity',
  'stepAmenities',
  'stepHouseRules',
  'stepPolicies',
  'stepPricing',
  'stepCalendar',
  'stepContent',
  'stepPublish',
] as const;

type StepKey = (typeof STEPS)[number];

const copy = {
  ar: {
    wizardTitle: 'إعداد الإقامة اليومية',
    wizardIntro: 'معالج مستقل عن إنشاء العقار. الحفظ يُفعَّل عند جاهزية الواجهة البرمجية.',
    comingOnline: 'قريباً — الخدمة قيد التفعيل',
    next: 'التالي',
    back: 'رجوع',
    finish: 'إنهاء',
    steps: {
      stepUnits: 'اختيار الوحدات',
      stepUnitTypes: 'أنواع الوحدات',
      stepCapacity: 'السعة والأسرة',
      stepAmenities: 'المرافق والخدمات',
      stepHouseRules: 'الدخول والخروج والقوانين',
      stepPolicies: 'سياسة الحجز والإلغاء',
      stepPricing: 'السعر والرسوم',
      stepCalendar: 'التقويم والإغلاقات',
      stepContent: 'الصور والمحتوى',
      stepPublish: 'الجاهزية والنشر',
    } satisfies Record<StepKey, string>,
    placeholder:
      'هذه الخطوة واجهة فقط حالياً. لن تُكتب بيانات حتى تصبح واجهة /v1/stays متاحة لمؤسستك.',
    backToStays: 'العودة للوحة الإقامات',
  },
  en: {
    wizardTitle: 'Daily stay setup',
    wizardIntro: 'A separate wizard from property creation. Saving unlocks when the API is ready.',
    comingOnline: 'Coming online — stays API not ready yet',
    next: 'Next',
    back: 'Back',
    finish: 'Finish',
    steps: {
      stepUnits: 'Select units',
      stepUnitTypes: 'Unit types',
      stepCapacity: 'Capacity & beds',
      stepAmenities: 'Amenities & services',
      stepHouseRules: 'Check-in/out & house rules',
      stepPolicies: 'Booking & cancellation',
      stepPricing: 'Rates & fees',
      stepCalendar: 'Calendar & blocks',
      stepContent: 'Photos & content',
      stepPublish: 'Readiness & publish',
    } satisfies Record<StepKey, string>,
    placeholder:
      'This step is a UI shell only. Nothing is written until /v1/stays is available for your organization.',
    backToStays: 'Back to stays dashboard',
  },
} as const;

export function StaySetupWizard({
  locale,
  portal,
  propertyId,
  apiAvailable = false,
}: {
  locale: 'ar' | 'en';
  portal: 'owner' | 'developer';
  propertyId?: string | null;
  /** When false / API 404, form posts stay disabled. */
  apiAvailable?: boolean;
}) {
  const t = copy[locale];
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;
  const canWrite = apiAvailable;

  return (
    <div className="form-shell wizard-shell stays-setup-wizard">
      <header className="wizard-hero">
        <h1>{t.wizardTitle}</h1>
        <p className="wizard-hero__intro">{t.wizardIntro}</p>
        {propertyId ? (
          <p className="muted" dir="ltr">
            propertyId: {propertyId}
          </p>
        ) : null}
        {!canWrite ? (
          <p className="notice notice--info" role="status">
            {t.comingOnline}
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
        }}
      >
        <div className="card__content">
          <h2>{t.steps[current]}</h2>
          <p className="muted">{t.placeholder}</p>
          <fieldset disabled={!canWrite} className="stays-setup-wizard__fields">
            <div className="field">
              <label htmlFor="stay-setup-note">{locale === 'ar' ? 'ملاحظات' : 'Notes'}</label>
              <textarea
                id="stay-setup-note"
                className="input"
                rows={3}
                name="notes"
                placeholder={canWrite ? undefined : t.comingOnline}
              />
            </div>
          </fieldset>
        </div>
        <div className="wizard-footer form-actions">
          <button
            type="button"
            className="button button--quiet"
            disabled={step === 0}
            onClick={() => setStep((value) => Math.max(0, value - 1))}
          >
            {t.back}
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => setStep((value) => Math.min(STEPS.length - 1, value + 1))}
            >
              {t.next}
            </button>
          ) : (
            <button type="submit" className="button button--primary" disabled={!canWrite}>
              {canWrite ? t.finish : t.comingOnline}
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
