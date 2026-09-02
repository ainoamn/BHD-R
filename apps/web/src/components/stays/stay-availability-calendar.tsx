'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, browserGet, browserPublicGet } from '@/lib/api';
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
};

type StayInventoryLockSpan = {
  kind: string;
  checkInOn: string;
  checkOutOn: string;
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
    maintenance: ['صيانة', 'Maintenance'],
    lease: ['إيجار طويل', 'Long-term lease'],
    unavailable: ['غير متاح', 'Unavailable'],
  };
  const pair = labels[status];
  return ar ? pair[0] : pair[1];
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

function lockForDay(
  locks: StayInventoryCalendarResponse['locks'] | undefined,
  stayDate: string,
) {
  if (!locks?.length) return null;
  return (
    locks.find((lock) => stayDate >= lock.checkInOn && stayDate < lock.checkOutOn) ?? null
  );
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
}: {
  locale: string;
  mode: CalendarMode;
  slug?: string;
  unitId?: string;
  monthCount?: 1 | 2;
  size?: 'default' | 'large';
  selectedCheckIn?: string;
  selectedCheckOut?: string;
  onRangeChange?: (checkIn: string, checkOut: string) => void;
}) {
  const ar = locale === 'ar';
  const [viewMonthStart, setViewMonthStart] = useState(() =>
    monthStartFromDate(selectedCheckIn || todayIso()),
  );
  const [data, setData] = useState<StayInventoryCalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickStart, setPickStart] = useState<string | null>(selectedCheckIn ?? null);

  const fromOn = viewMonthStart;
  const toOn = addCalendarMonths(viewMonthStart, monthCount);
  const weekdays = useMemo(() => weekdayLabels(locale), [locale]);

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ fromOn, toOn });
      const payload =
        mode === 'public' && slug
          ? await browserPublicGet<StayInventoryCalendarResponse>(
              `/v1/public/stays/${encodeURIComponent(slug)}/calendar?${qs.toString()}`,
            )
          : mode === 'ops' && unitId
            ? await browserGet<StayInventoryCalendarResponse>(
                `/v1/stays/units/${encodeURIComponent(unitId)}/inventory-days?${qs.toString()}`,
              )
            : null;
      if (!payload) throw new Error('calendar_unconfigured');
      setData(payload);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : 'calendar_failed',
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fromOn, toOn, mode, slug, unitId]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  const daysByDate = useMemo(() => {
    const map = new Map<string, StayInventoryDay>();
    for (const day of data?.days ?? []) map.set(day.stayDate, day);
    return map;
  }, [data]);

  const months = useMemo(
    () => Array.from({ length: monthCount }, (_, index) => addCalendarMonths(viewMonthStart, index)),
    [monthCount, viewMonthStart],
  );

  function handleDayClick(stayDate: string) {
    if (mode !== 'public' || !onRangeChange) return;
    const day = daysByDate.get(stayDate);
    if (!day || !isStayDateSelectable(day.availabilityStatus, stayDate)) return;

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
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      return stayDate === checkIn;
    }
    return stayDate >= checkIn && stayDate < checkOut;
  }

  function isRangeStart(stayDate: string): boolean {
    return Boolean(selectedCheckIn && stayDate === selectedCheckIn);
  }

  function isRangeEnd(stayDate: string): boolean {
    const checkIn = selectedCheckIn;
    const checkOut = selectedCheckOut;
    if (!checkIn || !checkOut || checkOut <= checkIn) return false;
    const lastNight = enumerateStayDates(checkIn, checkOut).at(-1);
    return stayDate === lastNight;
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
            <section key={monthStart} className="stays-calendar__month" aria-label={monthLabel(monthStart, locale)}>
              <h4 className="stays-calendar__month-title">{monthLabel(monthStart, locale)}</h4>
              <div className="stays-calendar__weekdays" aria-hidden="true">
                {weekdays.map((label) => (
                  <span key={`${monthStart}-${label}`}>{label}</span>
                ))}
              </div>
              <div className="stays-calendar__grid" role="grid">
                {cells.map((cell) => {
                  if (!cell.stayDate) {
                    return <span key={cell.key} className="stays-calendar__day stays-calendar__day--pad" />;
                  }
                  const day = daysByDate.get(cell.stayDate);
                  const status = day?.availabilityStatus ?? 'unavailable';
                  const selectable =
                    mode === 'public' &&
                    Boolean(onRangeChange) &&
                    isStayDateSelectable(status, cell.stayDate);
                  const lock = lockForDay(data?.locks, cell.stayDate);
                  const titleParts = [statusLabel(status, ar)];
                  if (lock?.bookingReference) titleParts.push(lock.bookingReference);
                  if (day?.effectiveRateMinor && data?.currency) {
                    titleParts.push(formatMoney(day.effectiveRateMinor, data.currency, locale));
                  }

                  return (
                    <button
                      key={cell.key}
                      type="button"
                      className={[
                        'stays-calendar__day',
                        statusClass(status),
                        isInSelectedRange(cell.stayDate) ? 'is-in-range' : '',
                        isRangeStart(cell.stayDate) ? 'is-range-start' : '',
                        isRangeEnd(cell.stayDate) ? 'is-range-end' : '',
                        cell.stayDate < todayIso() ? 'is-past' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      disabled={!selectable}
                      onClick={() => handleDayClick(cell.stayDate!)}
                      title={titleParts.join(' · ')}
                      aria-label={`${cell.stayDate} — ${statusLabel(status, ar)}`}
                    >
                      <span className="stays-calendar__day-num">
                        {Number(cell.stayDate.slice(8, 10))}
                      </span>
                      {mode === 'ops' && lock?.bookingReference ? (
                        <span className="stays-calendar__day-ref" dir="ltr">
                          {lock.bookingReference}
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

      <ul className="stays-calendar__legend" aria-label={ar ? 'دليل الألوان' : 'Legend'}>
        {(['available', 'booked', 'hold', 'blocked'] as const).map((status) => (
          <li key={status}>
            <span className={`stays-calendar__swatch ${statusClass(status)}`} aria-hidden="true" />
            {statusLabel(status, ar)}
          </li>
        ))}
      </ul>

      {mode === 'ops' && data?.locks?.length ? (
        <div className="stays-calendar__locks">
          <h4>{ar ? 'الحجوزات والإغلاقات' : 'Bookings and blocks'}</h4>
          <ul>
            {data.locks.map((lock) => (
              <li key={`${lock.kind}-${lock.checkInOn}-${lock.checkOutOn}`}>
                <strong dir="ltr">
                  {lock.checkInOn} → {lock.checkOutOn}
                </strong>
                <span>{lock.kind}</span>
                {lock.bookingReference ? (
                  <span dir="ltr">{lock.bookingReference}</span>
                ) : null}
                {lock.note ? <span className="muted">{lock.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
