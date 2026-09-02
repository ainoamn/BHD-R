'use client';

import { useMemo, useState } from 'react';
import { EmptyState } from '@bhd-r/ui';
import { StayAvailabilityCalendar } from '@/components/stays/stay-availability-calendar';
import { ApiError, browserNextMutation, humanizeBrowserError } from '@/lib/api';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import { formatMoney } from '@/lib/format';

export type StayCalendarUnit = {
  unitId: string;
  propertyId: string;
  stayProfileId: string;
  timezone: string;
  unitCode: string;
  calendarPath: string;
};

type EditableDay = {
  stayDate: string;
  availabilityStatus: string;
  effectiveRateMinor?: string | null;
  currency?: string | null;
  publicNote?: string | null;
};

function minorToMajorInput(amountMinor: string | null | undefined, currency: string): string {
  if (!amountMinor) return '';
  const minor = currencyMinorUnits[currency as CurrencyCode] ?? 3;
  const value = Number(amountMinor) / 10 ** minor;
  return Number.isFinite(value) ? String(value) : '';
}

export function StayOpsCalendarPanel({
  locale,
  items,
}: {
  locale: string;
  items: StayCalendarUnit[];
}) {
  const ar = locale === 'ar';
  const [activeUnitId, setActiveUnitId] = useState(items[0]?.unitId ?? '');
  const [selectedDay, setSelectedDay] = useState<EditableDay | null>(null);
  const [rateMajor, setRateMajor] = useState('');
  const [publicNote, setPublicNote] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const activeUnit = useMemo(
    () => items.find((unit) => unit.unitId === activeUnitId) ?? items[0],
    [activeUnitId, items],
  );

  if (!items.length || !activeUnit) {
    return (
      <EmptyState
        title={ar ? 'لا وحدات إقامة بعد' : 'No stay units yet'}
        description={
          ar
            ? 'أنشئ ملف إقامة عبر معالج الإعداد، ثم راجع التقويم هنا.'
            : 'Create a stay profile via setup, then review the calendar here.'
        }
      />
    );
  }

  function openDay(day: EditableDay) {
    setSelectedDay(day);
    setRateMajor(minorToMajorInput(day.effectiveRateMinor, day.currency ?? 'OMR'));
    setPublicNote(day.publicNote ?? '');
    setBlocked(day.availabilityStatus === 'blocked' || day.availabilityStatus === 'maintenance');
    setMessage(null);
    setError(null);
  }

  async function saveDay(options?: { clearManualRate?: boolean }) {
    if (!selectedDay || !activeUnit) return;
    const unitId = activeUnit.unitId;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await browserNextMutation<{ day: EditableDay }>('/api/owner/stays/day-override', {
        method: 'POST',
        body: JSON.stringify({
          unitId,
          payload: {
            stayDate: selectedDay.stayDate,
            ...(options?.clearManualRate
              ? { clearManualRate: true }
              : rateMajor.trim()
                ? { rateMajor: rateMajor.trim() }
                : {}),
            publicNote: publicNote.trim() || null,
            availabilityStatus: blocked ? 'blocked' : 'available',
          },
        }),
      });
      setMessage(ar ? 'تم حفظ اليوم.' : 'Day saved.');
      setReloadKey((value) => value + 1);
      setSelectedDay(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : humanizeBrowserError(caught, ar),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-panel stays-ops-calendar">
      <header className="stays-ops-calendar__header">
        <div>
          <h2>{ar ? 'تقويم الإشغال والتسعير' : 'Occupancy & pricing calendar'}</h2>
          <p className="muted">
            {ar
              ? 'اضغط يوماً لتحديد إيجار خاص (رفع أو تخفيض)، أو كتابة ملاحظة/تهنئة تظهر للجمهور، أو إغلاق اليوم.'
              : 'Click a day to set a custom rate (raise or discount), write a public note/greeting, or close the day.'}
          </p>
        </div>
      </header>

      <div className="stays-ops-calendar__units" role="tablist" aria-label={ar ? 'الوحدات' : 'Units'}>
        {items.map((unit) => (
          <button
            key={unit.unitId}
            type="button"
            role="tab"
            aria-selected={unit.unitId === activeUnit.unitId}
            className={
              unit.unitId === activeUnit.unitId
                ? 'button button--primary stays-ops-calendar__unit-tab'
                : 'button button--quiet stays-ops-calendar__unit-tab'
            }
            onClick={() => {
              setActiveUnitId(unit.unitId);
              setSelectedDay(null);
            }}
          >
            <span dir="ltr">{unit.unitCode}</span>
          </button>
        ))}
      </div>

      <div className="stays-ops-calendar__layout">
        <StayAvailabilityCalendar
          key={`${activeUnit.unitId}-${reloadKey}`}
          locale={locale}
          mode="ops"
          unitId={activeUnit.unitId}
          monthCount={2}
          onDaySelect={openDay}
        />

        {selectedDay ? (
          <aside className="stays-ops-calendar__editor" aria-label={ar ? 'تعديل اليوم' : 'Edit day'}>
            <h3 dir="ltr">{selectedDay.stayDate}</h3>
            <p className="muted">
              {selectedDay.effectiveRateMinor && selectedDay.currency
                ? `${ar ? 'السعر الحالي' : 'Current'}: ${formatMoney(selectedDay.effectiveRateMinor, selectedDay.currency, locale)}`
                : ar
                  ? 'لا سعر مخصّص بعد — سيُستخدم السعر الأساسي.'
                  : 'No custom rate yet — base rate applies.'}
            </p>

            <div className="field">
              <label htmlFor="stay-day-rate">
                {ar ? 'إيجار الليلة (ر.ع.)' : 'Nightly rate (OMR)'}
              </label>
              <input
                id="stay-day-rate"
                className="input"
                inputMode="decimal"
                dir="ltr"
                value={rateMajor}
                onChange={(event) => setRateMajor(event.target.value)}
                placeholder={ar ? 'مثال: 20 أو 18.5' : 'e.g. 20 or 18.5'}
              />
            </div>

            <div className="field">
              <label htmlFor="stay-day-note">
                {ar ? 'ملاحظة للجمهور (تهنئة / سبب التخفيض)' : 'Public note (greeting / discount reason)'}
              </label>
              <textarea
                id="stay-day-note"
                className="input"
                rows={3}
                maxLength={280}
                value={publicNote}
                onChange={(event) => setPublicNote(event.target.value)}
                placeholder={
                  ar
                    ? 'مثال: عرض العيد الوطني — خصم خاص'
                    : 'e.g. National Day offer — special discount'
                }
              />
            </div>

            <label className="stays-ops-calendar__check">
              <input
                type="checkbox"
                checked={blocked}
                onChange={(event) => setBlocked(event.target.checked)}
              />
              {ar ? 'إغلاق هذا اليوم (مغلق)' : 'Close this day (blocked)'}
            </label>

            <div className="stays-checkout__nav">
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => setSelectedDay(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy}
                onClick={() => void saveDay({ clearManualRate: true })}
              >
                {ar ? 'إرجاع للسعر الأساسي' : 'Reset to base rate'}
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={busy}
                onClick={() => void saveDay()}
              >
                {busy ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : ar ? 'حفظ' : 'Save'}
              </button>
            </div>

            {message ? <p className="notice notice--success">{message}</p> : null}
            {error ? (
              <p className="field__error" role="alert">
                {error}
              </p>
            ) : null}
          </aside>
        ) : null}
      </div>

      <details className="stays-ops-calendar__export">
        <summary>{ar ? 'تصدير iCal' : 'iCal export'}</summary>
        <p className="muted">
          {ar
            ? 'تصدير للقراءة فقط من أقفال المخزون النشطة.'
            : 'Read-only export from active inventory locks.'}
        </p>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{ar ? 'الوحدة' : 'Unit'}</th>
                <th>{ar ? 'المنطقة الزمنية' : 'Timezone'}</th>
                <th>{ar ? 'تصدير' : 'Export'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((unit) => (
                <tr key={unit.unitId}>
                  <td dir="ltr">{unit.unitCode}</td>
                  <td dir="ltr">{unit.timezone}</td>
                  <td>
                    <a className="button button--quiet" href={unit.calendarPath} download>
                      {ar ? 'تنزيل .ics' : 'Download .ics'}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
