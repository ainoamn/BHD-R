'use client';

import type { KeyboardEvent } from 'react';
import { useState } from 'react';
import { Button, Field } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { browserNextMutation } from '@/lib/api';
import type { PropertyStaySettingsUnit } from '@/lib/property-stay-settings';

type Draft = {
  overnightMaxGuests: string;
  dayUseMaxGuests: string;
  minNights: string;
  maxNights: string;
  instantBook: boolean;
  checkInFrom: string;
  dayUseCheckOutUntil: string;
  overnightCheckOutUntil: string;
  nightly: string;
  weekend: string;
  dayUse: string;
  overnightOnly: string;
  deposit: string;
};

type Status = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string };

function majorFromMinor(minor: string | null, minorUnit: number): string {
  if (!minor) return '';
  if (minorUnit === 0) return minor;
  const digits = minor.padStart(minorUnit + 1, '0');
  const whole = digits.slice(0, -minorUnit);
  const fraction = digits.slice(-minorUnit).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Empty → null; invalid → undefined. */
function minorFromMajor(value: string, minorUnit: number): string | null | undefined {
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > minorUnit) return undefined;
  const minor = `${whole}${fraction.padEnd(minorUnit, '0')}`.replace(/^0+(?=\d)/, '');
  return minor;
}

function time(value: string | null, fallback: string): string {
  return value && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : fallback;
}

function toDraft(unit: PropertyStaySettingsUnit): Draft {
  return {
    overnightMaxGuests: String(unit.overnightMaxGuests),
    dayUseMaxGuests: unit.dayUseMaxGuests ? String(unit.dayUseMaxGuests) : '',
    minNights: String(unit.minNights),
    maxNights: String(unit.maxNights),
    instantBook: unit.instantBook,
    checkInFrom: time(unit.checkInFrom, '15:00'),
    dayUseCheckOutUntil: time(unit.dayUseCheckOutUntil, '23:00'),
    overnightCheckOutUntil: time(unit.overnightCheckOutUntil, '11:00'),
    nightly: majorFromMinor(unit.baseNightlyMinor, unit.minorUnit),
    weekend: majorFromMinor(unit.weekendNightlyMinor, unit.minorUnit),
    dayUse: majorFromMinor(unit.dayUseMinor, unit.minorUnit),
    overnightOnly: majorFromMinor(unit.overnightOnlyMinor, unit.minorUnit),
    deposit: majorFromMinor(unit.depositMinor, unit.minorUnit),
  };
}

function wholeNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return parsed >= min && parsed <= max ? parsed : null;
}

function publishLabel(status: string, ar: boolean): { text: string; tone: string } {
  if (status === 'published') return { text: ar ? 'منشور' : 'Published', tone: 'ready' };
  if (status === 'unpublished') return { text: ar ? 'غير منشور' : 'Unpublished', tone: 'muted' };
  return { text: ar ? 'مسودة' : 'Draft', tone: 'warn' };
}

/** `sections="prices"` edits only the rate plan and the security deposit (stays rates page). */
export function UnitStaySettings({
  unit,
  ar,
  showUnitName,
  sections = 'all',
  onSaved,
}: {
  unit: PropertyStaySettingsUnit;
  ar: boolean;
  showUnitName: boolean;
  sections?: 'all' | 'prices';
  onSaved?: (unit: PropertyStaySettingsUnit) => void;
}) {
  const pricesOnly = sections === 'prices';
  const [draft, setDraft] = useState<Draft>(() => toDraft(unit));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setStatus({ kind: 'idle' });
  };
  const currency = unit.currency;
  const badge = publishLabel(unit.publishStatus, ar);
  const id = (field: string) => `stay-${field}-${unit.unitId}`;

  function validateMoney():
    { error: string } | { rates: Record<string, string>; depositMinor: string | null } {
    const money = {
      nightly: minorFromMajor(draft.nightly, unit.minorUnit),
      weekend: minorFromMajor(draft.weekend, unit.minorUnit),
      dayUse: minorFromMajor(draft.dayUse, unit.minorUnit),
      overnightOnly: minorFromMajor(draft.overnightOnly, unit.minorUnit),
      deposit: minorFromMajor(draft.deposit, unit.minorUnit),
    };
    if (Object.values(money).some((value) => value === undefined)) {
      return {
        error: ar
          ? `اكتب المبالغ بالأرقام فقط (حتى ${unit.minorUnit} خانات عشرية).`
          : `Enter amounts as numbers (up to ${unit.minorUnit} decimals).`,
      };
    }
    if (!money.nightly || money.nightly === '0') {
      return { error: ar ? 'سعر الليلة مطلوب.' : 'The nightly rate is required.' };
    }
    const rates: Record<string, string> = { baseNightlyMinor: money.nightly, currency };
    if (money.weekend) rates.weekendNightlyMinor = money.weekend;
    if (money.dayUse) rates.dayUseMinor = money.dayUse;
    if (money.overnightOnly) rates.overnightOnlyMinor = money.overnightOnly;
    return {
      rates,
      depositMinor: money.deposit && money.deposit !== '0' ? money.deposit : null,
    };
  }

  function validate():
    | { error: string }
    | {
        profile: Record<string, unknown>;
        rates: Record<string, string>;
      } {
    const priced = validateMoney();
    if ('error' in priced) return priced;
    if (pricesOnly) {
      return { profile: { depositMinor: priced.depositMinor }, rates: priced.rates };
    }
    const overnightGuests = wholeNumber(draft.overnightMaxGuests, 1, 999);
    if (!overnightGuests) {
      return {
        error: ar
          ? 'عدد الضيوف المسموح مع المبيت يجب أن يكون من 1 إلى 999.'
          : 'Overnight guests must be between 1 and 999.',
      };
    }
    const dayGuests = draft.dayUseMaxGuests.trim()
      ? wholeNumber(draft.dayUseMaxGuests, 1, 999)
      : undefined;
    if (dayGuests === null) {
      return {
        error: ar
          ? 'عدد الضيوف المسموح بدون مبيت يجب أن يكون من 1 إلى 999.'
          : 'Day-use guests must be between 1 and 999.',
      };
    }
    const minNights = wholeNumber(draft.minNights, 1, 365);
    const maxNights = wholeNumber(draft.maxNights, 1, 365);
    if (!minNights || !maxNights || maxNights < minNights) {
      return {
        error: ar
          ? 'الحد الأدنى والأقصى لليالي من 1 إلى 365، والأقصى لا يقل عن الأدنى.'
          : 'Minimum and maximum nights are 1–365, and the maximum cannot be below the minimum.',
      };
    }
    return {
      profile: {
        overnightMaxGuests: overnightGuests,
        ...(dayGuests ? { dayUseMaxGuests: dayGuests } : {}),
        minNights,
        maxNights,
        instantBook: draft.instantBook,
        checkInFrom: draft.checkInFrom || null,
        dayUseCheckOutUntil: draft.dayUseCheckOutUntil || null,
        overnightCheckOutUntil: draft.overnightCheckOutUntil || null,
        depositMinor: priced.depositMinor,
      },
      rates: priced.rates,
    };
  }

  async function save() {
    const checked = validate();
    if ('error' in checked) {
      setStatus({ kind: 'error', message: checked.error });
      return;
    }
    setStatus({ kind: 'saving' });
    try {
      await browserNextMutation('/api/owner/stays/setup', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_profile',
          profileId: unit.profileId,
          payload: checked.profile,
        }),
      });
      await browserNextMutation('/api/owner/stays/setup', {
        method: 'POST',
        body: JSON.stringify({
          action: 'upsert_rate_plan',
          profileId: unit.profileId,
          payload: checked.rates,
        }),
      });
      setStatus({ kind: 'saved' });
      onSaved?.({
        ...unit,
        baseNightlyMinor: checked.rates.baseNightlyMinor ?? null,
        weekendNightlyMinor: checked.rates.weekendNightlyMinor ?? null,
        dayUseMinor: checked.rates.dayUseMinor ?? null,
        overnightOnlyMinor: checked.rates.overnightOnlyMinor ?? null,
        depositMinor: (checked.profile.depositMinor as string | null | undefined) ?? null,
      });
    } catch (caught) {
      setStatus({
        kind: 'error',
        message:
          caught instanceof Error && caught.message
            ? caught.message
            : ar
              ? 'تعذّر حفظ إعدادات الإيجار اليومي. أعد المحاولة.'
              : 'Could not save the daily rental settings. Try again.',
      });
    }
  }

  return (
    <fieldset
      className={
        pricesOnly ? 'unit-editor stay-settings-unit is-prices' : 'unit-editor stay-settings-unit'
      }
    >
      {pricesOnly ? null : (
        <div className="unit-editor__head stay-settings-unit__head">
          <strong>
            {showUnitName
              ? `${ar ? unit.unitNameAr || unit.unitNameEn : unit.unitNameEn || unit.unitNameAr} · ${unit.unitCode}`
              : ar
                ? 'الإقامة اليومية'
                : 'Daily stay'}
          </strong>
          <span className={`pmh-badge pmh-badge--${badge.tone}`}>{badge.text}</span>
          {unit.listingSlug ? (
            <Link href={`/stays/${unit.listingSlug}`} target="_blank" rel="noreferrer">
              {ar ? 'عرض صفحة الإقامة ↗' : 'View stay page ↗'}
            </Link>
          ) : null}
        </div>
      )}

      {pricesOnly ? null : (
        <>
          <h4 className="stay-settings-unit__title">
            {ar ? 'الضيوف والمدة' : 'Guests and length'}
          </h4>
          <div className="form-grid">
            <Field
              id={id('overnight-guests')}
              type="number"
              min={1}
              max={999}
              inputMode="numeric"
              label={ar ? 'عدد الضيوف المسموح (مع المبيت)' : 'Guests allowed (overnight)'}
              value={draft.overnightMaxGuests}
              onChange={(event) => set('overnightMaxGuests', event.target.value)}
              required
            />
            <Field
              id={id('day-guests')}
              type="number"
              min={1}
              max={999}
              inputMode="numeric"
              label={ar ? 'عدد الضيوف المسموح (بدون مبيت)' : 'Guests allowed (day use)'}
              value={draft.dayUseMaxGuests}
              onChange={(event) => set('dayUseMaxGuests', event.target.value)}
            />
            <Field
              id={id('min-nights')}
              type="number"
              min={1}
              max={365}
              inputMode="numeric"
              label={ar ? 'الحد الأدنى لليالي' : 'Minimum nights'}
              value={draft.minNights}
              onChange={(event) => set('minNights', event.target.value)}
              required
            />
            <Field
              id={id('max-nights')}
              type="number"
              min={1}
              max={365}
              inputMode="numeric"
              label={ar ? 'الحد الأقصى لليالي' : 'Maximum nights'}
              value={draft.maxNights}
              onChange={(event) => set('maxNights', event.target.value)}
              required
            />
          </div>

          <h4 className="stay-settings-unit__title">
            {ar ? 'أوقات الدخول والخروج' : 'Check-in and check-out'}
          </h4>
          <div className="form-grid">
            <Field
              id={id('check-in')}
              type="time"
              label={ar ? 'الدخول من الساعة' : 'Check-in from'}
              value={draft.checkInFrom}
              onChange={(event) => set('checkInFrom', event.target.value)}
            />
            <Field
              id={id('day-out')}
              type="time"
              label={ar ? 'الخروج بدون مبيت حتى' : 'Day-use check-out until'}
              value={draft.dayUseCheckOutUntil}
              onChange={(event) => set('dayUseCheckOutUntil', event.target.value)}
            />
            <Field
              id={id('night-out')}
              type="time"
              label={ar ? 'الخروج بعد المبيت حتى' : 'Overnight check-out until'}
              value={draft.overnightCheckOutUntil}
              onChange={(event) => set('overnightCheckOutUntil', event.target.value)}
            />
            <label className="checkbox-row stay-settings-unit__check">
              <input
                type="checkbox"
                checked={draft.instantBook}
                onChange={(event) => set('instantBook', event.target.checked)}
              />
              {ar ? 'حجز فوري (دون انتظار موافقتي)' : 'Instant booking (no approval needed)'}
            </label>
          </div>
        </>
      )}

      <h4 className="stay-settings-unit__title">
        {ar ? `الأسعار والعربون (${currency})` : `Prices and deposit (${currency})`}
      </h4>
      <div className="form-grid">
        <Field
          id={id('nightly')}
          inputMode="decimal"
          label={ar ? 'سعر الليلة' : 'Nightly rate'}
          value={draft.nightly}
          onChange={(event) => set('nightly', event.target.value)}
          required
        />
        <Field
          id={id('weekend')}
          inputMode="decimal"
          label={ar ? 'سعر ليلة نهاية الأسبوع' : 'Weekend nightly rate'}
          value={draft.weekend}
          onChange={(event) => set('weekend', event.target.value)}
          hint={ar ? 'اتركه فارغاً لاستخدام سعر الليلة.' : 'Leave empty to use the nightly rate.'}
        />
        <Field
          id={id('day-use')}
          inputMode="decimal"
          label={ar ? 'سعر الإقامة بدون مبيت' : 'Day-use rate'}
          value={draft.dayUse}
          onChange={(event) => set('dayUse', event.target.value)}
        />
        <Field
          id={id('overnight-only')}
          inputMode="decimal"
          label={ar ? 'سعر المبيت فقط' : 'Overnight-only rate'}
          value={draft.overnightOnly}
          onChange={(event) => set('overnightOnly', event.target.value)}
        />
        <Field
          id={id('deposit')}
          inputMode="decimal"
          label={ar ? 'مبلغ التأمين (يُسترد)' : 'Security deposit (refundable)'}
          value={draft.deposit}
          onChange={(event) => set('deposit', event.target.value)}
          hint={
            ar
              ? 'يُدفع عند الوصول ويُسترد بعد المغادرة وفحص العقار.'
              : 'Paid on arrival and refunded after checkout inspection.'
          }
        />
      </div>

      <div className="stay-settings-unit__actions">
        <Button type="button" onClick={() => void save()} disabled={status.kind === 'saving'}>
          {status.kind === 'saving'
            ? ar
              ? 'جارٍ الحفظ…'
              : 'Saving…'
            : pricesOnly
              ? ar
                ? 'حفظ الأسعار'
                : 'Save prices'
              : ar
                ? 'حفظ إعدادات الإيجار اليومي'
                : 'Save daily rental settings'}
        </Button>
        {status.kind === 'saved' ? (
          <p className="notice notice--success" role="status">
            {ar
              ? 'تم الحفظ. تظهر التغييرات في صفحة الإقامة خلال دقائق.'
              : 'Saved. Changes appear on the stay page within minutes.'}
          </p>
        ) : null}
        {status.kind === 'error' ? (
          <p className="notice notice--error" role="alert">
            {status.message}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

/** Edit published daily-rental settings without leaving the property edit page. */
export function PropertyStaySettingsPanel({
  locale,
  units,
  setupHref,
  hasDailyUnits,
}: {
  locale: 'ar' | 'en';
  units: PropertyStaySettingsUnit[];
  setupHref: string;
  hasDailyUnits: boolean;
}) {
  const ar = locale === 'ar';
  if (!units.length && !hasDailyUnits) return null;

  // Inputs live inside the property wizard form; Enter must not advance its steps.
  const keepEnter = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
      event.preventDefault();
    }
  };

  return (
    <section
      className="stay-settings-panel"
      aria-labelledby="stay-settings-title"
      onKeyDown={keepEnter}
    >
      <header className="stay-settings-panel__head">
        <h3 id="stay-settings-title">{ar ? 'إعدادات الإيجار اليومي' : 'Daily rental settings'}</h3>
        <p className="muted">
          {ar
            ? 'عدّل عدد الضيوف المسموح بهم والليالي والأوقات والأسعار والتأمين للإقامة اليومية. يُحفظ كل قسم بزر «حفظ إعدادات الإيجار اليومي» مباشرة، دون حفظ بقية بيانات العقار.'
            : 'Edit allowed guests, nights, times, prices and the deposit for daily stays. Each block saves on its own with “Save daily rental settings”, independently of the rest of the property.'}
        </p>
      </header>
      {units.length ? (
        units.map((unit) => (
          <UnitStaySettings
            key={unit.profileId}
            unit={unit}
            ar={ar}
            showUnitName={units.length > 1}
          />
        ))
      ) : (
        <p className="notice" role="status">
          {ar
            ? 'الإيجار اليومي مفعّل لهذا العقار لكنه لم يُجهّز بعد. ابدأ الإعداد لتحديد الأسعار وعدد الضيوف ثم النشر.'
            : 'Daily rental is enabled for this property but not set up yet. Start the setup to add prices and guest limits, then publish.'}
        </p>
      )}
      <Link className="button button--quiet" href={setupHref}>
        {units.length
          ? ar
            ? 'الإعدادات المتقدمة: السياسات والتعليمات والنشر'
            : 'Advanced: policies, instructions and publishing'
          : ar
            ? 'ابدأ إعداد الإيجار اليومي'
            : 'Start daily rental setup'}
      </Link>
    </section>
  );
}
