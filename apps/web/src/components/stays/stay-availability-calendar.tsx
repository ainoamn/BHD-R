'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, browserGet, browserStayBookingGet, humanizeBrowserError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  addCalendarMonths,
  enumerateStayDates,
  isStayDateSelectable,
  monthStartFromDate,
  nextMonthStart,
  type StayDayStatus,
} from '@/lib/stay-calendar-utils';

type StayInventoryDay = {
  stayDate: string;
  availabilityStatus: StayDayStatus;
  effectiveRateMinor?: string | null;
  currency?: string | null;
  publicNote?: string | null;
  slots?: { morning: SlotStatus; evening: SlotStatus };
  remainingSlot?: 'morning' | 'evening' | null;
  remainingRateMinor?: string | null;
};

type SlotStatus = 'available' | 'booked' | 'hold' | 'blocked';

/** Half-day stay type that books the given free slot. */
export type HalfDayStayType = 'day_use' | 'overnight_only';

type StayInventoryLockSpan = {
  kind: string;
  checkInOn: string;
  checkOutOn: string;
  slot?: 'morning' | 'evening' | 'full';
  bookingReference?: string | null;
  note?: string | null;
};

type StayInventoryCalendarResponse = {
  unitId: string;
  fromOn: string;
  toOn: string;
  currency?: string | null;
  days: StayInventoryDay[];
  locks?: StayInventoryLockSpan[];
};

type CalendarMode = 'public' | 'ops';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthLabel(monthStart: string, locale: string): string {
  const date = new Date(`${monthStart}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
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

function statusClass(status: StayInventoryDay['availabilityStatus']): string {
  switch (status) {
    case 'available':
      return 'is-available';
    case 'booked':
      return 'is-booked';
    case 'hold':
      return 'is-hold';
    case 'blocked':
    case 'maintenance':
    case 'lease':
      return 'is-blocked';
    default:
      return 'is-unavailable';
  }
}

function statusLabel(status: StayInventoryDay['availabilityStatus'], ar: boolean): string {
  const labels: Record<StayInventoryDay['availabilityStatus'], [string, string]> = {
    available: ['شاغر', 'Available'],
    booked: ['محجوز', 'Booked'],
    hold: ['محجوز مؤقتاً', 'On hold'],
    blocked: ['مغلق', 'Blocked'],
    maintenance: ['مغلق', 'Blocked'],
    lease: ['مغلق', 'Blocked'],
    unavailable: ['غير متاح', 'Unavailable'],
  };
  const pair = labels[status];
  return ar ? pair[0] : pair[1];
}

function lockKindLabel(kind: string, ar: boolean): string {
  const map: Record<string, [string, string]> = {
    booking: ['حجز مؤكد', 'Confirmed booking'],
    hold: ['حجز مؤقت', 'Temporary hold'],
    maintenance: ['صيانة', 'Maintenance'],
    lease: ['إيجار طويل', 'Lease'],
    owner_block: ['إغلاق مالك', 'Owner block'],
    channel: ['قناة خارجية', 'Channel block'],
  };
  const pair = map[kind];
  if (pair) return ar ? pair[0] : pair[1];
  return kind;
}

/** Compact mark shown inside each day cell. */
function statusMark(status: StayInventoryDay['availabilityStatus'], ar: boolean): string | null {
  switch (status) {
    case 'available':
      return ar ? 'شاغر' : 'Free';
    case 'booked':
      return ar ? 'محجوز' : 'Booked';
    case 'hold':
      return ar ? 'مؤقت' : 'Hold';
    case 'blocked':
    case 'maintenance':
    case 'lease':
      return ar ? 'مغلق' : 'Closed';
    default:
      return null;
  }
}

function slotStatusLabel(status: SlotStatus, ar: boolean): string {
  const labels: Record<SlotStatus, [string, string]> = {
    available: ['شاغرة', 'free'],
    booked: ['محجوزة', 'booked'],
    hold: ['محجوزة مؤقتاً', 'on hold'],
    blocked: ['مغلقة', 'closed'],
  };
  return ar ? labels[status][0] : labels[status][1];
}

function slotMark(status: SlotStatus): string {
  return status === 'available' ? '✓' : '✗';
}

function slotName(slot: 'morning' | 'evening', ar: boolean): string {
  if (slot === 'morning') return ar ? 'الصباحية' : 'Morning';
  return ar ? 'المسائية' : 'Evening';
}

function isPartialDay(day: StayInventoryDay): boolean {
  return (
    Boolean(day.remainingSlot && day.slots) &&
    (day.availabilityStatus === 'booked' || day.availabilityStatus === 'hold')
  );
}

function partialSummary(day: StayInventoryDay, ar: boolean): string {
  if (!day.slots) return '';
  return `${slotName('morning', ar)} ${slotStatusLabel(day.slots.morning, ar)} · ${slotName(
    'evening',
    ar,
  )} ${slotStatusLabel(day.slots.evening, ar)}`;
}

function halfDayTypeForSlot(slot: 'morning' | 'evening'): HalfDayStayType {
  return slot === 'morning' ? 'day_use' : 'overnight_only';
}

function rangeFullyAvailable(
  daysByDate: Map<string, StayInventoryDay>,
  checkInOn: string,
  checkOutOn: string,
): boolean {
  if (checkOutOn <= checkInOn) return false;
  return enumerateStayDates(checkInOn, checkOutOn).every(
    (stayDate) => daysByDate.get(stayDate)?.availabilityStatus === 'available',
  );
}

function lockForDay(locks: StayInventoryCalendarResponse['locks'] | undefined, stayDate: string) {
  if (!locks?.length) return null;
  return locks.find((lock) => stayDate >= lock.checkInOn && stayDate < lock.checkOutOn) ?? null;
}

function compactMoney(amountMinor: string, currency: string, locale: string): string {
  const formatted = formatMoney(amountMinor, currency, locale);
  return formatted
    .replace(/\s*ر\.?\s*ع\.?/gi, '')
    .replace(/\s*OMR/gi, '')
    .trim();
}

export function StayAvailabilityCalendar({
  locale,
  mode,
  slug,
  unitId,
  monthCount = 2,
  size = 'default',
  selectedCheckIn,
  selectedCheckOut,
  onRangeChange,
  onDaySelect,
}: {
  locale: string;
  mode: CalendarMode;
  slug?: string;
  unitId?: string;
  monthCount?: 1 | 2;
  size?: 'default' | 'large';
  selectedCheckIn?: string;
  selectedCheckOut?: string;
  /** `halfDay` is set when the guest picks the free slot of a partially booked day. */
  onRangeChange?: (checkIn: string, checkOut: string, halfDay?: HalfDayStayType) => void;
  onDaySelect?: (day: StayInventoryDay) => void;
}) {
  const ar = locale === 'ar';
  const [viewMonthStart, setViewMonthStart] = useState(() =>
    monthStartFromDate(selectedCheckIn || todayIso()),
  );
  const [data, setData] = useState<StayInventoryCalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickStart, setPickStart] = useState<string | null>(selectedCheckIn ?? null);

  useEffect(() => {
    if (selectedCheckIn) setPickStart(selectedCheckIn);
  }, [selectedCheckIn]);

  const fromOn = viewMonthStart;
  const toOn = addCalendarMonths(viewMonthStart, monthCount);
  const weekdays = useMemo(() => weekdayLabels(locale), [locale]);

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const fetchOnce = async () => {
      const qs = new URLSearchParams({ fromOn, toOn });
      if (mode === 'public' && slug) {
        if (unitId) qs.set('unitId', unitId);
        return browserStayBookingGet<StayInventoryCalendarResponse>(
          `/${encodeURIComponent(slug)}/calendar?${qs.toString()}`,
        );
      }
      if (mode === 'ops' && unitId) {
        try {
          const response = await fetch(
            `/api/owner/stays/inventory-days?unitId=${encodeURIComponent(unitId)}&${qs.toString()}`,
            {
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
              cache: 'no-store',
              signal: AbortSignal.timeout(45_000),
            },
          );
          if (response.ok) {
            return (await response.json()) as StayInventoryCalendarResponse;
          }
        } catch {
          /* fall through to Nest */
        }
        return browserGet<StayInventoryCalendarResponse>(
          `/v1/stays/units/${encodeURIComponent(unitId)}/inventory-days?${qs.toString()}`,
        );
      }
      throw new Error('calendar_unconfigured');
    };

    try {
      let payload: StayInventoryCalendarResponse;
      try {
        payload = await fetchOnce();
      } catch (first) {
        const retryable =
          first instanceof ApiError &&
          (first.code === 'network_error' ||
            first.code === 'api_unreachable' ||
            first.status === 502 ||
            first.status === 503);
        if (!retryable) throw first;
        await new Promise((resolve) => setTimeout(resolve, 2500));
        payload = await fetchOnce();
      }
      setData(payload);
    } catch (caught) {
      setError(humanizeBrowserError(caught, ar));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ar, fromOn, toOn, mode, slug, unitId]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  const daysByDate = useMemo(() => {
    const map = new Map<string, StayInventoryDay>();
    for (const day of data?.days ?? []) map.set(day.stayDate, day);
    return map;
  }, [data]);

  const partialDays = useMemo(() => {
    const today = todayIso();
    return (data?.days ?? []).filter((day) => day.stayDate >= today && isPartialDay(day));
  }, [data]);

  const months = useMemo(
    () =>
      Array.from({ length: monthCount }, (_, index) => addCalendarMonths(viewMonthStart, index)),
    [monthCount, viewMonthStart],
  );

  function handleDayClick(stayDate: string) {
    const day = daysByDate.get(stayDate) ?? {
      stayDate,
      availabilityStatus: 'available' as const,
      effectiveRateMinor: data?.currency ? null : null,
      currency: data?.currency ?? null,
    };

    if (mode === 'ops' && onDaySelect) {
      onDaySelect(day);
      return;
    }

    if (mode !== 'public' || !onRangeChange) return;

    if (isPartialDay(day) && day.remainingSlot && stayDate >= todayIso()) {
      if (
        pickStart &&
        stayDate > pickStart &&
        rangeFullyAvailable(daysByDate, pickStart, stayDate)
      ) {
        onRangeChange(pickStart, stayDate);
        setPickStart(null);
        return;
      }
      setPickStart(null);
      onRangeChange(stayDate, stayDate, halfDayTypeForSlot(day.remainingSlot));
      return;
    }

    if (!isStayDateSelectable(day.availabilityStatus, stayDate)) return;

    if (!pickStart) {
      setPickStart(stayDate);
      onRangeChange(stayDate, stayDate);
      return;
    }

    if (stayDate <= pickStart) {
      setPickStart(stayDate);
      onRangeChange(stayDate, stayDate);
      return;
    }

    if (!rangeFullyAvailable(daysByDate, pickStart, stayDate)) {
      setPickStart(stayDate);
      onRangeChange(stayDate, stayDate);
      return;
    }

    onRangeChange(pickStart, stayDate);
    setPickStart(null);
  }

  function isInSelectedRange(stayDate: string): boolean {
    const checkIn = selectedCheckIn;
    const checkOut = selectedCheckOut;
    if (!checkIn) return stayDate === pickStart;
    if (!checkOut || checkOut <= checkIn) {
      return stayDate === checkIn || stayDate === pickStart;
    }
    // Inclusive of departure day so the form range is visible on the grid.
    return stayDate >= checkIn && stayDate <= checkOut;
  }

  function isRangeStart(stayDate: string): boolean {
    if (selectedCheckIn && stayDate === selectedCheckIn) return true;
    if (!selectedCheckIn && pickStart && stayDate === pickStart) return true;
    return false;
  }

  function isRangeEnd(stayDate: string): boolean {
    const checkIn = selectedCheckIn;
    const checkOut = selectedCheckOut;
    if (!checkIn || !checkOut || checkOut <= checkIn) return false;
    return stayDate === checkOut;
  }

  return (
    <div className={`stays-calendar stays-calendar--${mode} stays-calendar--${size}`}>
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
          {monthLabel(months[0]!, locale)}
          {monthCount > 1 ? ` — ${monthLabel(months[1]!, locale)}` : ''}
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
          {ar ? 'جاري تحميل التقويم…' : 'Loading calendar…'}
        </p>
      ) : null}
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <div className={`stays-calendar__months stays-calendar__months--${monthCount}`}>
        {months.map((monthStart) => {
          const monthEnd = nextMonthStart(monthStart);
          const leading = new Date(`${monthStart}T00:00:00.000Z`).getUTCDay();
          const monthDays = enumerateStayDates(monthStart, monthEnd);
          const cells: Array<{ key: string; stayDate?: string }> = [];
          for (let index = 0; index < leading; index += 1) {
            cells.push({ key: `pad-${monthStart}-${index}` });
          }
          for (const stayDate of monthDays) {
            cells.push({ key: stayDate, stayDate });
          }

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
                {cells.map((cell) => {
                  if (!cell.stayDate) {
                    return (
                      <span
                        key={cell.key}
                        className="stays-calendar__day stays-calendar__day--pad"
                      />
                    );
                  }
                  const day = daysByDate.get(cell.stayDate) ?? {
                    stayDate: cell.stayDate,
                    availabilityStatus: 'available' as const,
                    effectiveRateMinor: null,
                    currency: data?.currency ?? null,
                  };
                  const lock = lockForDay(data?.locks, cell.stayDate);
                  const status = day.slots
                    ? day.availabilityStatus
                    : lock?.kind === 'booking'
                      ? ('booked' as const)
                      : lock?.kind === 'hold'
                        ? ('hold' as const)
                        : lock?.kind === 'maintenance'
                          ? ('maintenance' as const)
                          : lock?.kind === 'lease'
                            ? ('lease' as const)
                            : lock?.kind === 'owner_block' || lock?.kind === 'channel'
                              ? ('blocked' as const)
                              : day.availabilityStatus;
                  const partial = isPartialDay({ ...day, availabilityStatus: status });
                  const selectable =
                    (mode === 'public' &&
                      Boolean(onRangeChange) &&
                      (isStayDateSelectable(status, cell.stayDate) ||
                        (partial && cell.stayDate >= todayIso()))) ||
                    (mode === 'ops' && Boolean(onDaySelect) && cell.stayDate >= todayIso());
                  const currency = day.currency ?? data?.currency ?? null;
                  const titleParts = partial
                    ? [ar ? 'محجوز جزئياً' : 'Partly booked', partialSummary(day, ar)]
                    : [statusLabel(status, ar)];
                  if (day.publicNote) titleParts.push(day.publicNote);
                  if (lock?.bookingReference) titleParts.push(lock.bookingReference);
                  if (partial && day.remainingSlot && day.remainingRateMinor && currency) {
                    titleParts.push(
                      `${ar ? 'سعر الفترة' : 'Slot price'} ${slotName(day.remainingSlot, ar)}: ${formatMoney(
                        day.remainingRateMinor,
                        currency,
                        locale,
                      )}`,
                    );
                  } else if (day.effectiveRateMinor && currency) {
                    titleParts.push(formatMoney(day.effectiveRateMinor, currency, locale));
                  }

                  const mark = statusMark(status, ar);
                  const selected = isInSelectedRange(cell.stayDate);
                  const rangeStart = isRangeStart(cell.stayDate);
                  const rangeEnd = isRangeEnd(cell.stayDate);
                  const selectedLabel = rangeStart
                    ? ar
                      ? 'وصول'
                      : 'In'
                    : rangeEnd
                      ? ar
                        ? 'مغادرة'
                        : 'Out'
                      : selected
                        ? ar
                          ? 'مختار'
                          : 'Pick'
                        : null;

                  return (
                    <button
                      key={cell.key}
                      type="button"
                      className={[
                        'stays-calendar__day',
                        partial
                          ? `is-partial is-partial--${day.remainingSlot}-free`
                          : statusClass(status),
                        selected ? 'is-in-range' : '',
                        rangeStart ? 'is-range-start' : '',
                        rangeEnd ? 'is-range-end' : '',
                        cell.stayDate < todayIso() ? 'is-past' : '',
                        day.publicNote ? 'has-note' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      disabled={!selectable}
                      onClick={() => handleDayClick(cell.stayDate!)}
                      title={titleParts.join(' · ')}
                      aria-label={`${cell.stayDate} — ${titleParts.slice(0, 2).join(' — ')}${
                        selectedLabel ? ` — ${selectedLabel}` : ''
                      }`}
                      aria-pressed={selected}
                    >
                      <span className="stays-calendar__day-num">
                        {Number(cell.stayDate.slice(8, 10))}
                      </span>
                      {partial && day.slots ? (
                        <span className="stays-calendar__slots" aria-hidden="true">
                          <span className={`stays-calendar__slot is-${day.slots.morning}`}>
                            {ar ? 'ص' : 'AM'}
                            <i>{slotMark(day.slots.morning)}</i>
                          </span>
                          <span className={`stays-calendar__slot is-${day.slots.evening}`}>
                            {ar ? 'م' : 'PM'}
                            <i>{slotMark(day.slots.evening)}</i>
                          </span>
                        </span>
                      ) : null}
                      {selectedLabel ? (
                        <span className="stays-calendar__day-status">{selectedLabel}</span>
                      ) : partial ? (
                        day.remainingRateMinor && currency ? (
                          <span className="stays-calendar__day-price" dir="ltr">
                            {compactMoney(day.remainingRateMinor, currency, locale)}
                          </span>
                        ) : (
                          <span className="stays-calendar__day-status">
                            {ar ? 'جزئي' : 'Partial'}
                          </span>
                        )
                      ) : status === 'booked' ||
                        status === 'hold' ||
                        status === 'blocked' ||
                        status === 'maintenance' ||
                        status === 'lease' ? (
                        <span className="stays-calendar__day-status">{mark}</span>
                      ) : day.effectiveRateMinor && currency ? (
                        <span className="stays-calendar__day-price" dir="ltr">
                          {compactMoney(day.effectiveRateMinor, currency, locale)}
                        </span>
                      ) : mark && mode === 'ops' ? (
                        <span className="stays-calendar__day-status">{mark}</span>
                      ) : null}
                      {day.publicNote && !selected ? (
                        <span className="stays-calendar__day-note" aria-hidden="true">
                          ✎
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <ul
        className="stays-calendar__legend"
        aria-label={ar ? 'دليل حالات الأيام' : 'Day status legend'}
      >
        <li className="stays-calendar__legend-item is-selected-range">
          <span className="stays-calendar__swatch is-selected-range" aria-hidden="true" />
          <span>{ar ? 'التواريخ المختارة' : 'Selected dates'}</span>
        </li>
        {(['available', 'booked', 'hold', 'blocked'] as const).map((status) => (
          <li key={status} className={`stays-calendar__legend-item ${statusClass(status)}`}>
            <span className={`stays-calendar__swatch ${statusClass(status)}`} aria-hidden="true" />
            <span>{statusLabel(status, ar)}</span>
          </li>
        ))}
        <li className="stays-calendar__legend-item is-partial">
          <span className="stays-calendar__swatch is-partial" aria-hidden="true" />
          <span>{ar ? 'محجوز جزئياً' : 'Partly booked'}</span>
        </li>
      </ul>
      <ul
        className="stays-calendar__legend stays-calendar__legend--slots"
        aria-label={ar ? 'دليل الفترات' : 'Slot legend'}
      >
        <li className="stays-calendar__legend-item">
          <span className="stays-calendar__slot is-available" aria-hidden="true">
            {ar ? 'ص' : 'AM'}
          </span>
          <span>{ar ? 'الفترة الصباحية (بدون مبيت)' : 'Morning slot (day use)'}</span>
        </li>
        <li className="stays-calendar__legend-item">
          <span className="stays-calendar__slot is-available" aria-hidden="true">
            {ar ? 'م' : 'PM'}
          </span>
          <span>{ar ? 'الفترة المسائية (مبيت فقط)' : 'Evening slot (overnight only)'}</span>
        </li>
        <li className="stays-calendar__legend-item">
          <span className="stays-calendar__slot is-available" aria-hidden="true">
            ✓
          </span>
          <span>{ar ? 'الفترة شاغرة' : 'Slot free'}</span>
        </li>
        <li className="stays-calendar__legend-item">
          <span className="stays-calendar__slot is-booked" aria-hidden="true">
            ✗
          </span>
          <span>{ar ? 'الفترة محجوزة' : 'Slot booked'}</span>
        </li>
        <li className="stays-calendar__legend-item">
          <span className="stays-calendar__legend-price" aria-hidden="true">
            {ar ? '٨٠' : '80'}
          </span>
          <span>{ar ? 'سعر الفترة المتبقية' : 'Remaining slot price'}</span>
        </li>
      </ul>

      {partialDays.length ? (
        <div className="stays-calendar__partials">
          <h4>{ar ? 'أيام محجوزة جزئياً' : 'Partly booked days'}</h4>
          <ul>
            {partialDays.map((day) => {
              const currency = day.currency ?? data?.currency ?? null;
              return (
                <li key={day.stayDate}>
                  <strong dir="ltr">{day.stayDate}</strong>
                  <span>{partialSummary(day, ar)}</span>
                  {day.remainingSlot ? (
                    <span className="stays-calendar__partial-price">
                      {ar ? 'المتبقي: الفترة ' : 'Remaining: '}
                      {slotName(day.remainingSlot, ar)}
                      {day.remainingRateMinor && currency
                        ? ` — ${formatMoney(day.remainingRateMinor, currency, locale)}`
                        : ''}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {mode === 'public' && onRangeChange ? (
            <p className="muted stays-calendar__partials-hint">
              {ar
                ? 'اضغط على اليوم المحجوز جزئياً لحجز الفترة المتبقية فقط.'
                : 'Tap a partly booked day to book only the remaining slot.'}
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === 'ops' && data?.locks?.length ? (
        <div className="stays-calendar__locks">
          <h4>{ar ? 'الحجوزات والإغلاقات' : 'Bookings and blocks'}</h4>
          <ul>
            {data.locks.map((lock, index) => (
              <li
                key={`${lock.kind}-${lock.checkInOn}-${lock.checkOutOn}-${lock.slot ?? 'full'}-${index}`}
              >
                <strong dir="ltr">
                  {lock.checkInOn} → {lock.checkOutOn}
                </strong>
                <span>{lockKindLabel(lock.kind, ar)}</span>
                <span className="muted">
                  {lock.slot === 'morning' || lock.slot === 'evening'
                    ? `${ar ? 'جزئي — الفترة ' : 'Partial — '}${slotName(lock.slot, ar)}`
                    : ar
                      ? 'كامل اليوم'
                      : 'Whole day'}
                </span>
                {lock.bookingReference ? <span dir="ltr">{lock.bookingReference}</span> : null}
                {lock.note ? <span className="muted">{lock.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
