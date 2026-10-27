'use client';

import { useMemo, useState } from 'react';
import { EmptyState } from '@bhd-r/ui';
import { Link } from '@/i18n/navigation';
import { formatMoney } from '@/lib/format';
import {
  reservationHref,
  stayHref,
  tenancyLandlordName,
  tenancyUnitLabel,
  viewingHref,
  type MyTenancy,
  type TenancyReservation,
  type TenancyStay,
  type TenancyViewing,
} from '@/lib/tenancy-shared';
import { domainStatusLabel, stayStatusLabel } from '@/lib/ui-labels';

type Kind = 'viewing' | 'stay' | 'reservation';
type Filter = 'all' | 'attention' | Kind;

type BoardItem = {
  key: string;
  kind: Kind;
  sortAt: string;
  attention: boolean;
  reference: string;
  title: string;
  subtitle: string;
  whenLabel: string;
  whenValue: string;
  amount: string | null;
  statusLabel: string;
  statusTone: 'action' | 'good' | 'danger' | undefined;
  href: string | null;
  cta: string | null;
};

function formatDate(value: string | null | undefined, ar: boolean): string {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(ar ? 'ar-OM' : 'en-OM', {
    dateStyle: 'medium',
    ...(value.length > 10 ? { timeStyle: 'short' } : {}),
  }).format(date);
}

function period(from: string | null, to: string | null, ar: boolean): string {
  if (!from && !to) return '—';
  return `${formatDate(from, ar)} ${ar ? '←' : '→'} ${formatDate(to, ar)}`;
}

function money(amountMinor: string | null, currency: string | null, locale: string): string | null {
  return amountMinor && currency ? formatMoney(amountMinor, currency, locale) : null;
}

function stayAttention(stay: TenancyStay): boolean {
  return (
    ['payment_pending', 'payment_failed', 'request_pending'].includes(stay.status) ||
    stay.canRequestDepositRefund
  );
}

function reservationAttention(reservation: TenancyReservation): boolean {
  return (
    Boolean(reservation.handover) ||
    (reservation.status === 'pending' && reservation.awaitingPayment)
  );
}

function viewingAttention(viewing: TenancyViewing): boolean {
  return viewing.status === 'scheduled' && Boolean(viewing.passHref);
}

function kindLabel(kind: Kind, ar: boolean): string {
  if (kind === 'viewing') return ar ? 'معاينة' : 'Viewing';
  if (kind === 'stay') return ar ? 'إقامة يومية' : 'Daily stay';
  return ar ? 'إيجار / شراء' : 'Rent / purchase';
}

function buildItems(
  data: Pick<MyTenancy, 'viewings' | 'stays' | 'reservations'>,
  ar: boolean,
  locale: string,
): BoardItem[] {
  const viewings: BoardItem[] = data.viewings.map((viewing) => {
    const place =
      (ar
        ? viewing.propertyNameAr || viewing.propertyNameEn
        : viewing.propertyNameEn || viewing.propertyNameAr) ?? tenancyUnitLabel(viewing, ar);
    const when = viewing.scheduledAt || viewing.preferredAt || viewing.createdAt;
    const href = viewingHref(viewing);
    return {
      key: `viewing:${viewing.id}`,
      kind: 'viewing',
      sortAt: when,
      attention: viewingAttention(viewing),
      reference: viewing.reference,
      title: place,
      subtitle: `${tenancyUnitLabel(viewing, ar)} · ${tenancyLandlordName(viewing.landlord, ar)}`,
      whenLabel: viewing.scheduledAt
        ? ar
          ? 'الموعد'
          : 'Appointment'
        : ar
          ? 'تاريخ الطلب'
          : 'Requested',
      whenValue: formatDate(when, ar),
      amount: null,
      statusLabel: domainStatusLabel(viewing.status, ar),
      statusTone: viewing.status === 'scheduled' ? 'good' : undefined,
      href,
      cta: href ? (ar ? 'بطاقة الزيارة' : 'Visit pass') : null,
    };
  });

  const stays: BoardItem[] = data.stays.map((stay) => {
    const title =
      (ar ? stay.titleAr || stay.titleEn : stay.titleEn || stay.titleAr) ?? stay.referenceCode;
    return {
      key: `stay:${stay.id}`,
      kind: 'stay',
      sortAt: stay.checkInOn,
      attention: stayAttention(stay),
      reference: stay.referenceCode,
      title,
      subtitle: ar ? 'إقامة يومية' : 'Daily stay',
      whenLabel: ar ? 'الفترة' : 'Dates',
      whenValue: period(stay.checkInOn, stay.checkOutOn, ar),
      amount: money(stay.totalMinor, stay.currency, locale),
      statusLabel: stayStatusLabel(stay.status, ar),
      statusTone: ['payment_pending', 'payment_failed'].includes(stay.status)
        ? 'action'
        : ['cancelled', 'rejected', 'no_show', 'expired'].includes(stay.status)
          ? 'danger'
          : ['confirmed', 'pre_arrival', 'checked_in'].includes(stay.status)
            ? 'good'
            : undefined,
      href: stayHref(stay),
      cta: ar ? 'فتح الحجز' : 'Open booking',
    };
  });

  const reservations: BoardItem[] = data.reservations.map((reservation) => {
    const href = reservationHref(reservation);
    const awaitingPay = reservation.status === 'pending' && reservation.awaitingPayment;
    return {
      key: `reservation:${reservation.id}`,
      kind: 'reservation',
      sortAt: reservation.expiresAt,
      attention: reservationAttention(reservation),
      reference: reservation.referenceCode ?? reservation.id.slice(0, 8),
      title: tenancyUnitLabel(reservation, ar),
      subtitle: `${
        reservation.mode === 'sale' ? (ar ? 'شراء' : 'Purchase') : ar ? 'إيجار' : 'Rent'
      } · ${tenancyLandlordName(reservation.landlord, ar)}`,
      whenLabel: ar ? 'صالح حتى' : 'Valid until',
      whenValue: formatDate(reservation.expiresAt, ar),
      amount: money(reservation.depositMinor, reservation.currency, locale),
      statusLabel: awaitingPay
        ? ar
          ? 'بانتظار دفع الضمان'
          : 'Deposit payment due'
        : reservation.handover === 'awaiting_acceptance'
          ? ar
            ? 'محضر التسليم'
            : 'Handover record'
          : reservation.handover === 'defects_open'
            ? ar
              ? 'اعتراض على المحضر'
              : 'Object to handover'
            : domainStatusLabel(reservation.status, ar),
      statusTone:
        awaitingPay || reservation.handover
          ? 'action'
          : reservation.status === 'confirmed'
            ? 'good'
            : undefined,
      href,
      cta: href ? (ar ? 'فتح مراحل الحجز' : 'Open booking journey') : null,
    };
  });

  return [...viewings, ...stays, ...reservations].sort((a, b) => {
    if (a.attention !== b.attention) return a.attention ? -1 : 1;
    return b.sortAt.localeCompare(a.sortAt);
  });
}

export function TenantBookingsBoard({
  locale,
  data,
  compact = false,
}: {
  locale: 'ar' | 'en';
  data: Pick<MyTenancy, 'viewings' | 'stays' | 'reservations'>;
  /** Hide browse CTA and shrink chrome for dashboard previews. */
  compact?: boolean;
}) {
  const ar = locale === 'ar';
  const [filter, setFilter] = useState<Filter>('all');
  const items = useMemo(() => buildItems(data, ar, locale), [data, ar, locale]);

  const counts = {
    all: items.length,
    attention: items.filter((item) => item.attention).length,
    viewing: data.viewings.length,
    stay: data.stays.length,
    reservation: data.reservations.length,
  };

  const visible = items.filter((item) => {
    if (filter === 'all') return true;
    if (filter === 'attention') return item.attention;
    return item.kind === filter;
  });

  const filters: { id: Filter; label: string; count: number; tone?: string }[] = [
    { id: 'all', label: ar ? 'الكل' : 'All', count: counts.all },
    {
      id: 'attention',
      label: ar ? 'يحتاج إجراء' : 'Needs action',
      count: counts.attention,
      tone: 'attention',
    },
    { id: 'viewing', label: ar ? 'معاينات' : 'Viewings', count: counts.viewing, tone: 'viewing' },
    { id: 'stay', label: ar ? 'إقامات' : 'Stays', count: counts.stay, tone: 'stay' },
    {
      id: 'reservation',
      label: ar ? 'إيجار وشراء' : 'Rent & buy',
      count: counts.reservation,
      tone: 'reservation',
    },
  ];

  return (
    <div className={`tenant-bookings${compact ? ' tenant-bookings--compact' : ''}`}>
      {!compact ? (
        <div className="tenant-bookings__stats" role="group" aria-label={ar ? 'ملخص' : 'Summary'}>
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`tenant-bookings__stat${item.tone ? ` is-${item.tone}` : ''}${
                filter === item.id ? ' is-selected' : ''
              }`}
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
            >
              <strong>{item.count}</strong>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="tenant-bookings__toolbar">
        <p className="tenant-bookings__count">
          {ar
            ? `${visible.length} من ${items.length} حجز`
            : `${visible.length} of ${items.length} bookings`}
        </p>
        <div className="tenant-bookings__chips" role="tablist" aria-label={ar ? 'تصفية' : 'Filter'}>
          {filters.map((item) => (
            <button
              key={`chip-${item.id}`}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`tenant-bookings__chip${filter === item.id ? ' is-active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <em>{item.count}</em>
            </button>
          ))}
        </div>
      </div>

      {!items.length ? (
        <EmptyState
          title={ar ? 'لا حجوزات بعد' : 'No bookings yet'}
          description={
            ar
              ? 'عند طلب معاينة أو حجز إقامة أو وحدة ستظهر هنا مرتبة وواضحة.'
              : 'When you request a viewing or book a stay or unit, they will appear here clearly.'
          }
        />
      ) : !visible.length ? (
        <p className="tenant-bookings__empty">
          {ar ? 'لا نتائج في هذا التصنيف.' : 'Nothing in this filter.'}
        </p>
      ) : (
        <ul className="tenant-bookings__list">
          {visible.map((item) => (
            <li
              key={item.key}
              className={`tenant-bookings__card is-${item.kind}${
                item.attention ? ' is-attention' : ''
              }`}
            >
              <div className="tenant-bookings__card-main">
                <div className="tenant-bookings__card-info">
                  <div className="tenant-bookings__card-identity">
                    <span className={`tenant-bookings__kind is-${item.kind}`}>
                      {kindLabel(item.kind, ar)}
                    </span>
                    <bdi className="tenant-bookings__ref">{item.reference}</bdi>
                  </div>
                  <h3>{item.title}</h3>
                  <p className="tenant-bookings__subtitle">{item.subtitle}</p>
                  <div className="tenant-bookings__meta">
                    <span>
                      <em>{item.whenLabel}</em> {item.whenValue}
                    </span>
                    {item.amount ? (
                      <span>
                        <em>{ar ? 'المبلغ' : 'Amount'}</em> {item.amount}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="tenant-bookings__card-side">
                  <span
                    className={`tenant-status${
                      item.statusTone ? ` tenant-status--${item.statusTone}` : ''
                    }`}
                  >
                    {item.statusLabel}
                  </span>
                  {item.href && item.cta ? (
                    <Link
                      href={item.href}
                      className={`button ${
                        item.attention ? 'button--primary' : 'button--quiet'
                      }`}
                    >
                      {item.cta}
                    </Link>
                  ) : item.kind === 'viewing' && !item.href ? (
                    <span className="tenant-bookings__waiting">
                      {ar ? 'بانتظار تأكيد المالك' : 'Awaiting owner confirmation'}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!compact ? (
        <div className="tenant-bookings__browse">
          <p>
            {ar
              ? 'تبحث عن وحدة جديدة؟ تصفّح العقارات واطلب معاينة أو احجز مباشرة.'
              : 'Looking for a new place? Browse properties, request a viewing, or book directly.'}
          </p>
          <Link href="/properties" className="button button--primary">
            {ar ? 'تصفّح العقارات' : 'Browse properties'}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
