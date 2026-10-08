'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@bhd-r/ui';
import { StayAvailabilityCalendar } from '@/components/stays/stay-availability-calendar';
import {
  StayOpsOverviewCalendar,
  StayUnitPicker,
  unitLabel,
} from '@/components/stays/stay-ops-overview-calendar';
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
  propertyNameAr?: string;
  propertyNameEn?: string;
  unitNameAr?: string;
  unitNameEn?: string;
};

export type StayCalendarOverviewBooking = {
  id: string;
  referenceCode: string;
  unitId: string;
  unitCode: string;
  propertyNameAr: string | null;
  propertyNameEn: string | null;
  checkInOn: string;
  checkOutOn: string;
  status: string;
  totalMinor: string;
  currency: string;
  stayType: string | null;
  guestName: string | null;
  guestPhone: string | null;
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

type PanelView = 'bookings' | 'prices';

export function StayOpsCalendarPanel({
  locale,
  items,
  portal = 'owner',
  initialUnitId = null,
  initialView = 'bookings',
}: {
  locale: string;
  items: StayCalendarUnit[];
  portal?: 'owner' | 'developer';
  initialUnitId?: string | null;
  initialView?: PanelView;
}) {
  const ar = locale === 'ar';
  const [activeUnitId, setActiveUnitId] = useState<string | null>(() =>
    initialUnitId && items.some((unit) => unit.unitId === initialUnitId) ? initialUnitId : null,
  );
  const [view, setView] = useState<PanelView>(initialView);
  const [selectedDay, setSelectedDay] = useState<EditableDay | null>(null);
  const editorRef = useRef<HTMLElement>(null);
  const [rateMajor, setRateMajor] = useState('');
  const [publicNote, setPublicNote] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const activeUnit = useMemo(
    () => items.find((unit) => unit.unitId === activeUnitId) ?? null,
    [activeUnitId, items],
  );

  useEffect(() => {
    if (selectedDay) editorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedDay]);

  if (!items.length) {
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
      setError(caught instanceof ApiError ? caught.message : humanizeBrowserError(caught, ar));
    } finally {
      setBusy(false);
    }
  }

  const showPrices = Boolean(activeUnit) && view === 'prices';

  return (
    <div className="stays-ops-calendar">
      <section className="pmh-card stays-ops-calendar__board">
        <div className="stays-ops-calendar__toolbar">
          <StayUnitPicker
            locale={locale}
            units={items}
            value={activeUnit?.unitId ?? null}
            onChange={(unitId) => {
              setActiveUnitId(unitId);
              setSelectedDay(null);
              if (!unitId) setView('bookings');
            }}
          />
          {activeUnit ? (
            <div
              className="stays-bookings-board__filters stays-ops-calendar__views"
              role="tablist"
              aria-label={unitLabel(activeUnit, ar)}
            >
              {(
                [
                  ['bookings', ar ? 'الحجوزات' : 'Bookings'],
                  ['prices', ar ? 'الأسعار وإغلاق الأيام' : 'Prices & closed days'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={view === id}
                  className={
                    view === id
                      ? 'stays-bookings-board__chip is-active'
                      : 'stays-bookings-board__chip'
                  }
                  onClick={() => {
                    setView(id);
                    setSelectedDay(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted stays-ops-calendar__hint">
              {ar
                ? 'لتعديل سعر يوم أو إغلاقه اختر وحدة من القائمة.'
                : 'Pick a unit to change a day’s price or close it.'}
            </p>
          )}
        </div>

        {showPrices && activeUnit ? (
          <div className="stays-ops-calendar__layout">
            <div className="stays-ops-calendar__prices">
              <p className="muted stays-ops-calendar__hint">
                {ar
                  ? 'اضغط على أي يوم لتغيير سعره (عرض أو مناسبة) أو إغلاقه أمام الحجز.'
                  : 'Tap a day to change its price (offer or occasion) or close it for booking.'}
              </p>
              <StayAvailabilityCalendar
                key={`${activeUnit.unitId}-${reloadKey}`}
                locale={locale}
                mode="ops"
                unitId={activeUnit.unitId}
                monthCount={2}
                size="large"
                onDaySelect={openDay}
              />
              {message ? <p className="notice notice--success">{message}</p> : null}
            </div>

            {selectedDay ? (
              <aside
                ref={editorRef}
                className="stays-ops-calendar__editor"
                aria-label={ar ? 'تعديل اليوم' : 'Edit day'}
              >
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
                    {ar
                      ? 'ملاحظة للجمهور (تهنئة / سبب التخفيض)'
                      : 'Public note (greeting / discount reason)'}
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

                {error ? (
                  <p className="field__error" role="alert">
                    {error}
                  </p>
                ) : null}
              </aside>
            ) : null}
          </div>
        ) : (
          <StayOpsOverviewCalendar
            key={activeUnit?.unitId ?? 'all'}
            locale={locale}
            portal={portal}
            units={items}
            unitId={activeUnit?.unitId ?? null}
          />
        )}
      </section>

      <details className="pmh-card stays-ops-calendar__export">
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
