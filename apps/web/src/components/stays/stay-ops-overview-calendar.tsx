'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { humanizeBrowserError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  addCalendarMonths,
  enumerateStayDates,
  monthStartFromDate,
  nextMonthStart,
} from '@/lib/stay-calendar-utils';
import { stayStatusLabel } from '@/lib/ui-labels';
import type {
  StayCalendarOverviewBooking,
  StayCalendarUnit,
} from '@/components/stays/stay-ops-calendar-panel';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthLabel(monthStart: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${monthStart}T00:00:00.000Z`));
}

function weekdayLabels(locale: string): string[] {
  const base = new Date('2026-09-06T00:00:00.000Z'); // Sunday
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + index);
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-GB', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(date);
  });
}

function nextDay(isoDate: string): string {
  const cursor = new Date(`${isoDate}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor.toISOString().slice(0, 10);
}

export function unitLabel(unit: StayCalendarUnit, ar: boolean): string {
  const property = ar
    ? unit.propertyNameAr || unit.propertyNameEn
    : unit.propertyNameEn || unit.propertyNameAr;
  const name = ar ? unit.unitNameAr || unit.unitNameEn : unit.unitNameEn || unit.unitNameAr;
  return [property, name || unit.unitCode].filter(Boolean).join(' — ');
}

function stayPeriodLabel(stayType: string | null, ar: boolean): string {
  if (stayType === 'day_use') return ar ? 'الفترة الصباحية (بدون مبيت)' : 'Morning (day use)';
  if (stayType === 'overnight_only') {
    return ar ? 'الفترة المسائية (مبيت فقط)' : 'Evening (overnight only)';
  }
  return ar ? 'اليوم كاملاً (مع مبيت)' : 'Whole day (overnight stay)';
}

/** Searchable dropdown: "All properties" or one stay unit. */
export function StayUnitPicker({
  locale,
  units,
  value,
  onChange,
}: {
  locale: string;
  units: StayCalendarUnit[];
  value: string | null;
  onChange: (unitId: string | null) => void;
}) {
  const ar = locale === 'ar';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = units.find((unit) => unit.unitId === value) ?? null;
  const allLabel = ar ? `كل العقارات (${units.length})` : `All properties (${units.length})`;

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return units;
    return units.filter((unit) =>
      [unit.propertyNameAr, unit.propertyNameEn, unit.unitNameAr, unit.unitNameEn, unit.unitCode]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(needle)),
    );
  }, [query, units]);

  function choose(unitId: string | null) {
    onChange(unitId);
    setOpen(false);
    setQuery('');
  }

  return (
    <div
      className="stays-unit-picker"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <label className="stays-unit-picker__label" htmlFor="stays-unit-picker-button">
        {ar ? 'العقار' : 'Property'}
      </label>
      <button
        id="stays-unit-picker-button"
        type="button"
        className="stays-unit-picker__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected ? unitLabel(selected, ar) : allLabel}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="stays-unit-picker__popover">
          <input
            className="input stays-unit-picker__search"
            type="search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={ar ? 'ابحث باسم العقار أو رمز الوحدة…' : 'Search property or unit code…'}
            aria-label={ar ? 'بحث عن عقار' : 'Search properties'}
          />
          <ul className="stays-unit-picker__list" role="listbox">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={value === null}
                className="stays-unit-picker__option"
                onClick={() => choose(null)}
              >
                {allLabel}
              </button>
            </li>
            {filtered.map((unit) => (
              <li key={unit.unitId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={unit.unitId === value}
                  className="stays-unit-picker__option"
                  onClick={() => choose(unit.unitId)}
                >
                  <span>{unitLabel(unit, ar)}</span>
                  <span dir="ltr" className="muted">
                    {unit.unitCode}
                  </span>
                </button>
              </li>
            ))}
            {!filtered.length ? (
              <li className="muted stays-unit-picker__empty">
                {ar ? 'لا توجد نتائج مطابقة.' : 'No matching properties.'}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Booking-occupancy calendar across all units: red = has bookings, green = free. */
export function StayOpsOverviewCalendar({
  locale,
  portal,
  units,
  unitId,
}: {
  locale: string;
  portal: 'owner' | 'developer';
  units: StayCalendarUnit[];
  unitId: string | null;
}) {
  const ar = locale === 'ar';
  const [viewMonthStart, setViewMonthStart] = useState(() => monthStartFromDate(todayIso()));
  const [bookings, setBookings] = useState<StayCalendarOverviewBooking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const weekdays = useMemo(() => weekdayLabels(locale), [locale]);
  const months = useMemo(
    () => [viewMonthStart, addCalendarMonths(viewMonthStart, 1)],
    [viewMonthStart],
  );
  const fromOn = viewMonthStart;
  const toOn = addCalendarMonths(viewMonthStart, 2);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ fromOn, toOn });
      if (unitId) qs.set('unitId', unitId);
      const response = await fetch(`/api/owner/stays/calendar-overview?${qs.toString()}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      });
      const payload = (await response.json().catch(() => null)) as {
        bookings?: StayCalendarOverviewBooking[];
        error?: { messageAr?: string };
      } | null;
      if (!response.ok || !payload?.bookings) {
        throw new Error(
          payload?.error?.messageAr ?? (ar ? 'تعذر تحميل الحجوزات.' : 'Could not load bookings.'),
        );
      }
      setBookings(payload.bookings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : humanizeBrowserError(caught, ar));
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, [ar, fromOn, toOn, unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDate = useMemo(() => {
    const map = new Map<string, StayCalendarOverviewBooking[]>();
    for (const booking of bookings) {
      const end =
        booking.checkOutOn > booking.checkInOn ? booking.checkOutOn : nextDay(booking.checkInOn);
      for (const stayDate of enumerateStayDates(booking.checkInOn, end)) {
        const list = map.get(stayDate) ?? [];
        list.push(booking);
        map.set(stayDate, list);
      }
    }
    return map;
  }, [bookings]);

  const unitById = useMemo(() => new Map(units.map((unit) => [unit.unitId, unit])), [units]);
  const selectedBookings = selectedDate ? (byDate.get(selectedDate) ?? []) : [];

  return (
    <div className="stays-calendar stays-calendar--ops stays-calendar--large stays-overview">
      <div className="stays-calendar__toolbar">
        <button
          type="button"
          className="button button--quiet stays-calendar__nav"
          onClick={() => setViewMonthStart((current) => addCalendarMonths(current, -1))}
          aria-label={ar ? 'الشهر السابق' : 'Previous month'}
        >
          {ar ? '→' : '←'}
        </button>
        <p className="stays-calendar__range-label">
          {monthLabel(months[0]!, locale)} — {monthLabel(months[1]!, locale)}
        </p>
        <button
          type="button"
          className="button button--quiet stays-calendar__nav"
          onClick={() => setViewMonthStart((current) => addCalendarMonths(current, 1))}
          aria-label={ar ? 'الشهر التالي' : 'Next month'}
        >
          {ar ? '←' : '→'}
        </button>
      </div>

      {loading ? (
        <p className="stays-calendar__loading muted" role="status">
          {ar ? 'جاري تحميل الحجوزات…' : 'Loading bookings…'}
        </p>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="stays-calendar__months stays-calendar__months--2">
        {months.map((monthStart) => {
          const leading = new Date(`${monthStart}T00:00:00.000Z`).getUTCDay();
          const monthDays = enumerateStayDates(monthStart, nextMonthStart(monthStart));
          return (
            <section
              key={monthStart}
              className="stays-calendar__month"
              aria-label={monthLabel(monthStart, locale)}
            >
              <h4 className="stays-calendar__month-title">{monthLabel(monthStart, locale)}</h4>
              <div className="stays-calendar__weekdays" aria-hidden="true">
                {weekdays.map((label) => (
                  <span key={`${monthStart}-${label}`}>{label}</span>
                ))}
              </div>
              <div className="stays-calendar__grid" role="grid">
                {Array.from({ length: leading }, (_, index) => (
                  <span
                    key={`pad-${monthStart}-${index}`}
                    className="stays-calendar__day stays-calendar__day--pad"
                  />
                ))}
                {monthDays.map((stayDate) => {
                  const count = byDate.get(stayDate)?.length ?? 0;
                  const selected = stayDate === selectedDate;
                  const label =
                    count === 0
                      ? ar
                        ? 'لا حجوزات'
                        : 'No bookings'
                      : ar
                        ? `${count} ${count === 1 ? 'حجز' : 'حجوزات'}`
                        : `${count} booking${count === 1 ? '' : 's'}`;
                  return (
                    <button
                      key={stayDate}
                      type="button"
                      className={[
                        'stays-calendar__day',
                        count ? 'is-booked' : 'is-free',
                        selected ? 'is-selected' : '',
                        stayDate < todayIso() ? 'is-past' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setSelectedDate(selected ? null : stayDate)}
                      aria-pressed={selected}
                      aria-label={`${stayDate} — ${label}`}
                      title={label}
                    >
                      <span className="stays-calendar__day-num">
                        {Number(stayDate.slice(8, 10))}
                      </span>
                      <span className="stays-calendar__day-status">
                        {count ? (ar ? `${count} حجز` : `${count}`) : ar ? 'شاغر' : 'Free'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <ul className="stays-calendar__legend" aria-label={ar ? 'دليل الألوان' : 'Legend'}>
        <li className="stays-calendar__legend-item is-available">
          <span className="stays-calendar__swatch is-available" aria-hidden="true" />
          <span>{ar ? 'لا توجد حجوزات' : 'No bookings'}</span>
        </li>
        <li className="stays-calendar__legend-item is-booked">
          <span className="stays-calendar__swatch is-booked" aria-hidden="true" />
          <span>{ar ? 'يوجد حجز (الرقم = عدد الحجوزات)' : 'Has bookings (number = count)'}</span>
        </li>
      </ul>

      {selectedDate ? (
        <section className="stays-overview__details" aria-live="polite">
          <header className="stays-overview__details-head">
            <h3>
              {ar ? 'حجوزات يوم' : 'Bookings on'} <span dir="ltr">{selectedDate}</span>
            </h3>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setSelectedDate(null)}
            >
              {ar ? 'إغلاق' : 'Close'}
            </button>
          </header>
          {selectedBookings.length ? (
            <ul className="stays-overview__list">
              {selectedBookings.map((booking) => {
                const unit = unitById.get(booking.unitId);
                const property = unit
                  ? unitLabel(unit, ar)
                  : [
                      ar
                        ? booking.propertyNameAr || booking.propertyNameEn
                        : booking.propertyNameEn || booking.propertyNameAr,
                      booking.unitCode,
                    ]
                      .filter(Boolean)
                      .join(' — ');
                return (
                  <li key={booking.id} className="stays-overview__item">
                    <div className="stays-overview__item-head">
                      <strong>{property}</strong>
                      <span className="stays-overview__status">
                        {stayStatusLabel(booking.status, ar)}
                      </span>
                    </div>
                    <dl className="stays-overview__facts">
                      <div>
                        <dt>{ar ? 'الضيف' : 'Guest'}</dt>
                        <dd>{booking.guestName || '—'}</dd>
                      </div>
                      {booking.guestPhone ? (
                        <div>
                          <dt>{ar ? 'الهاتف' : 'Phone'}</dt>
                          <dd dir="ltr">
                            <a href={`tel:${booking.guestPhone}`}>{booking.guestPhone}</a>
                          </dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>{ar ? 'الفترة' : 'Period'}</dt>
                        <dd>{stayPeriodLabel(booking.stayType, ar)}</dd>
                      </div>
                      <div>
                        <dt>{ar ? 'الوصول ← المغادرة' : 'Check-in → out'}</dt>
                        <dd dir="ltr">
                          {booking.checkInOn} → {booking.checkOutOn}
                        </dd>
                      </div>
                      <div>
                        <dt>{ar ? 'المبلغ' : 'Amount'}</dt>
                        <dd>{formatMoney(booking.totalMinor, booking.currency, locale)}</dd>
                      </div>
                      <div>
                        <dt>{ar ? 'المرجع' : 'Reference'}</dt>
                        <dd dir="ltr">{booking.referenceCode}</dd>
                      </div>
                    </dl>
                    <Link
                      className="button button--quiet"
                      href={`/${portal}/stays/bookings/${booking.id}`}
                    >
                      {ar ? 'تفاصيل الحجز' : 'Booking details'}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">
              {unitId
                ? ar
                  ? 'لا توجد حجوزات لهذا العقار في هذا اليوم — شاغر.'
                  : 'No bookings for this property on this day — free.'
                : ar
                  ? 'لا توجد حجوزات في هذا اليوم — كل العقارات شاغرة.'
                  : 'No bookings on this day — all properties are free.'}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
