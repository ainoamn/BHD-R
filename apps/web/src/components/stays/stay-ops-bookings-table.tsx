'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EmptyState } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { ApiError, browserMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { stayBookingModeLabel, stayStatusLabel } from '@/lib/ui-labels';

export type OpsStayBooking = {
  id: string;
  referenceCode: string;
  propertyId: string;
  unitId: string;
  checkInOn: string;
  checkOutOn: string;
  status: string;
  bookingMode: string;
  source?: string;
  currency: string;
  totalMinor: string;
  nights?: number;
  propertyNameAr?: string;
  propertyNameEn?: string;
  unitCode?: string;
  unitNameAr?: string;
  unitNameEn?: string;
  guestDisplayName?: string;
};

const CANCELABLE = new Set(['request_pending', 'payment_pending', 'confirmed', 'pre_arrival']);
const NO_SHOWABLE = new Set(['confirmed', 'pre_arrival']);
const CHECKOUTABLE = new Set(['checked_in']);

type FilterId = 'all' | 'attention' | 'upcoming' | 'active' | 'done';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusTone(status: string): string {
  switch (status) {
    case 'request_pending':
    case 'payment_pending':
      return 'attention';
    case 'confirmed':
    case 'paid':
    case 'pre_arrival':
      return 'confirmed';
    case 'checked_in':
      return 'active';
    case 'checked_out':
    case 'closed':
      return 'done';
    case 'cancelled':
    case 'expired':
    case 'no_show':
    case 'payment_failed':
      return 'muted';
    default:
      return 'neutral';
  }
}

function formatStayDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-OM' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function matchesFilter(booking: OpsStayBooking, filter: FilterId, today: string): boolean {
  switch (filter) {
    case 'attention':
      return booking.status === 'request_pending' || booking.status === 'payment_pending';
    case 'upcoming':
      return (
        ['confirmed', 'paid', 'pre_arrival'].includes(booking.status) && booking.checkInOn >= today
      );
    case 'active':
      return booking.status === 'checked_in';
    case 'done':
      return ['checked_out', 'closed', 'cancelled', 'expired', 'no_show'].includes(booking.status);
    default:
      return true;
  }
}

export function StayOpsBookingsTable({
  locale,
  portal = 'owner',
  items,
}: {
  locale: string;
  portal?: 'owner' | 'developer';
  items: OpsStayBooking[];
}) {
  const ar = locale === 'ar';
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState(items);
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');
  const today = useMemo(() => todayIso(), []);

  const stats = useMemo(() => {
    const attention = rows.filter((b) => matchesFilter(b, 'attention', today)).length;
    const upcoming = rows.filter((b) => matchesFilter(b, 'upcoming', today)).length;
    const active = rows.filter((b) => matchesFilter(b, 'active', today)).length;
    const done = rows.filter((b) => matchesFilter(b, 'done', today)).length;
    return { total: rows.length, attention, upcoming, active, done };
  }, [rows, today]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((booking) => {
      if (!matchesFilter(booking, filter, today)) return false;
      if (!q) return true;
      const propertyName = (
        ar
          ? booking.propertyNameAr || booking.propertyNameEn
          : booking.propertyNameEn || booking.propertyNameAr
      )?.toLowerCase();
      const haystack = [
        booking.referenceCode,
        booking.guestDisplayName,
        propertyName,
        booking.unitCode,
        booking.unitNameAr,
        booking.unitNameEn,
        booking.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, filter, query, today, ar]);

  async function runAction(bookingId: string, action: 'cancel' | 'no-show' | 'checkout') {
    setError(null);
    setBusyId(bookingId);
    try {
      const result = await browserMutation<{ id: string; status: string }>(
        `/v1/stays/bookings/${encodeURIComponent(bookingId)}/${action}`,
        { method: 'POST', body: '{}' },
      );
      setRows((prev) =>
        prev.map((row) => (row.id === bookingId ? { ...row, status: result.status } : row)),
      );
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : ar
            ? 'فشل تحديث الحجز'
            : 'Failed to update booking',
      );
    } finally {
      setBusyId(null);
    }
  }

  const filters: Array<{ id: FilterId; label: string; count: number }> = [
    { id: 'all', label: ar ? 'الكل' : 'All', count: stats.total },
    { id: 'attention', label: ar ? 'تحتاج إجراء' : 'Needs action', count: stats.attention },
    { id: 'upcoming', label: ar ? 'قادمة' : 'Upcoming', count: stats.upcoming },
    { id: 'active', label: ar ? 'داخل العقار' : 'In-house', count: stats.active },
    { id: 'done', label: ar ? 'منتهية' : 'Closed', count: stats.done },
  ];

  if (!rows.length) {
    return (
      <EmptyState
        title={ar ? 'لا حجوزات بعد' : 'No bookings yet'}
        description={
          ar
            ? 'تظهر الحجوزات هنا بعد مسار الضيف العام أو الإنشاء التشغيلي.'
            : 'Bookings appear here after the public guest path or operational creation.'
        }
      />
    );
  }

  return (
    <div className="stays-bookings-board">
      <div className="stays-bookings-board__stats" role="list">
        <div className="stays-bookings-board__stat" role="listitem">
          <span>{ar ? 'إجمالي' : 'Total'}</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="stays-bookings-board__stat is-attention" role="listitem">
          <span>{ar ? 'تحتاج إجراء' : 'Needs action'}</span>
          <strong>{stats.attention}</strong>
        </div>
        <div className="stays-bookings-board__stat is-upcoming" role="listitem">
          <span>{ar ? 'قادمة' : 'Upcoming'}</span>
          <strong>{stats.upcoming}</strong>
        </div>
        <div className="stays-bookings-board__stat is-active" role="listitem">
          <span>{ar ? 'داخل العقار' : 'In-house'}</span>
          <strong>{stats.active}</strong>
        </div>
      </div>

      <div className="stays-bookings-board__toolbar">
        <div
          className="stays-bookings-board__filters"
          role="tablist"
          aria-label={ar ? 'تصفية' : 'Filter'}
        >
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={
                filter === item.id
                  ? 'stays-bookings-board__chip is-active'
                  : 'stays-bookings-board__chip'
              }
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <em>{item.count}</em>
            </button>
          ))}
        </div>
        <label className="stays-bookings-board__search">
          <span className="sr-only">{ar ? 'بحث' : 'Search'}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              ar ? 'ابحث بالمرجع أو الضيف أو العقار…' : 'Search reference, guest, property…'
            }
          />
        </label>
      </div>

      {error ? (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      ) : null}

      {!filtered.length ? (
        <p className="stays-bookings-board__empty muted">
          {ar ? 'لا نتائج لهذا التصفية أو البحث.' : 'No bookings match this filter or search.'}
        </p>
      ) : (
        <ul className="stays-bookings-board__list">
          {filtered.map((booking) => {
            const disabled = pending || busyId === booking.id;
            const canCancel = CANCELABLE.has(booking.status);
            const canNoShow = NO_SHOWABLE.has(booking.status);
            const canCheckout = CHECKOUTABLE.has(booking.status);
            const propertyName = ar
              ? booking.propertyNameAr || booking.propertyNameEn
              : booking.propertyNameEn || booking.propertyNameAr;
            const unitLabel =
              (ar
                ? booking.unitNameAr || booking.unitNameEn
                : booking.unitNameEn || booking.unitNameAr) ||
              booking.unitCode ||
              `${booking.unitId.slice(0, 8)}…`;
            const rejectLabel =
              booking.status === 'request_pending'
                ? ar
                  ? 'رفض'
                  : 'Reject'
                : ar
                  ? 'إلغاء'
                  : 'Cancel';
            const tone = statusTone(booking.status);

            return (
              <li key={booking.id} className={`stays-bookings-card is-${tone}`}>
                <div className="stays-bookings-card__main">
                  <div className="stays-bookings-card__identity">
                    <Link
                      className="stays-bookings-card__ref"
                      href={`/${portal}/stays/bookings/${booking.id}`}
                    >
                      <strong dir="ltr">{booking.referenceCode}</strong>
                    </Link>
                    <span className={`stays-bookings-card__badge is-${tone}`}>
                      {stayStatusLabel(booking.status, locale)}
                    </span>
                    <span className="stays-bookings-card__mode">
                      {stayBookingModeLabel(booking.bookingMode, locale)}
                    </span>
                  </div>

                  <div className="stays-bookings-card__guest">
                    <span className="stays-bookings-card__label">{ar ? 'الضيف' : 'Guest'}</span>
                    <strong>{booking.guestDisplayName || (ar ? 'ضيف' : 'Guest')}</strong>
                  </div>

                  <div className="stays-bookings-card__property">
                    <span className="stays-bookings-card__label">{ar ? 'العقار' : 'Property'}</span>
                    <Link href={`/${portal}/properties/${booking.propertyId}`}>
                      {propertyName || (ar ? 'فتح العقار' : 'Open property')}
                    </Link>
                    <span className="muted">{unitLabel}</span>
                  </div>

                  <div className="stays-bookings-card__dates" dir="ltr">
                    <div>
                      <span className="stays-bookings-card__label">{ar ? 'وصول' : 'Check-in'}</span>
                      <strong>{formatStayDate(booking.checkInOn, locale)}</strong>
                    </div>
                    <span className="stays-bookings-card__arrow" aria-hidden>
                      →
                    </span>
                    <div>
                      <span className="stays-bookings-card__label">
                        {ar ? 'مغادرة' : 'Check-out'}
                      </span>
                      <strong>{formatStayDate(booking.checkOutOn, locale)}</strong>
                    </div>
                    <em>
                      {booking.nights ?? '—'}{' '}
                      {ar
                        ? booking.nights === 1
                          ? 'ليلة'
                          : 'ليالٍ'
                        : booking.nights === 1
                          ? 'night'
                          : 'nights'}
                    </em>
                  </div>

                  <div className="stays-bookings-card__amount" dir="ltr">
                    <span className="stays-bookings-card__label">{ar ? 'المبلغ' : 'Total'}</span>
                    <strong>{formatMoney(booking.totalMinor, booking.currency, locale)}</strong>
                  </div>
                </div>

                <div className="stays-bookings-card__actions">
                  <Link
                    className="button button--primary"
                    href={`/${portal}/stays/bookings/${booking.id}`}
                  >
                    {ar ? 'عرض التفاصيل' : 'View details'}
                  </Link>
                  {canCheckout ? (
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={disabled}
                      onClick={() => void runAction(booking.id, 'checkout')}
                    >
                      {ar ? 'مغادرة' : 'Check-out'}
                    </button>
                  ) : null}
                  {canCancel ? (
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={disabled}
                      onClick={() => void runAction(booking.id, 'cancel')}
                    >
                      {rejectLabel}
                    </button>
                  ) : null}
                  {canNoShow ? (
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={disabled}
                      onClick={() => void runAction(booking.id, 'no-show')}
                    >
                      {ar ? 'عدم حضور' : 'No-show'}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
