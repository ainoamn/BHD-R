'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
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
};

const CANCELABLE = new Set(['request_pending', 'payment_pending', 'confirmed', 'pre_arrival']);

const NO_SHOWABLE = new Set(['confirmed', 'pre_arrival']);

const CHECKOUTABLE = new Set(['checked_in']);

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
    <div className="ops-panel data-table-wrap stays-ops-bookings">
      {error ? (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      ) : null}
      <table className="data-table">
        <thead>
          <tr>
            <th>{ar ? 'المرجع' : 'Reference'}</th>
            <th>{ar ? 'العقار' : 'Property'}</th>
            <th>{ar ? 'الوحدة' : 'Unit'}</th>
            <th>{ar ? 'التواريخ' : 'Dates'}</th>
            <th>{ar ? 'الليالي' : 'Nights'}</th>
            <th>{ar ? 'الحالة' : 'Status'}</th>
            <th>{ar ? 'النمط' : 'Mode'}</th>
            <th>{ar ? 'المبلغ' : 'Total'}</th>
            <th>{ar ? 'إجراءات' : 'Actions'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((booking) => {
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
            return (
              <tr key={booking.id}>
                <td dir="ltr">
                  <Link href={`/${portal}/stays/bookings/${booking.id}`}>
                    <strong>{booking.referenceCode}</strong>
                  </Link>
                </td>
                <td>
                  <Link href={`/${portal}/properties/${booking.propertyId}`}>
                    {propertyName || (ar ? 'فتح العقار' : 'Open property')}
                  </Link>
                </td>
                <td>
                  <Link href={`/${portal}/properties/${booking.propertyId}?unit=${booking.unitId}`}>
                    {unitLabel}
                  </Link>
                </td>
                <td dir="ltr">
                  {booking.checkInOn} → {booking.checkOutOn}
                </td>
                <td dir="ltr">{booking.nights ?? '—'}</td>
                <td>{stayStatusLabel(booking.status, locale)}</td>
                <td>{stayBookingModeLabel(booking.bookingMode, locale)}</td>
                <td dir="ltr">{formatMoney(booking.totalMinor, booking.currency, locale)}</td>
                <td>
                  <div className="stays-ops-bookings__actions">
                    <Link
                      className="button button--quiet"
                      href={`/${portal}/stays/bookings/${booking.id}`}
                    >
                      {ar ? 'العقد' : 'Contract'}
                    </Link>
                    <Link
                      className="button button--quiet"
                      href={`/${portal}/properties/${booking.propertyId}`}
                    >
                      {ar ? 'العقار' : 'Property'}
                    </Link>
                    {canCancel ? (
                      <button
                        type="button"
                        className="button button--quiet"
                        disabled={disabled}
                        onClick={() => void runAction(booking.id, 'cancel')}
                      >
                        {ar ? 'إلغاء' : 'Cancel'}
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
                    {canCheckout ? (
                      <button
                        type="button"
                        className="button button--primary"
                        disabled={disabled}
                        onClick={() => void runAction(booking.id, 'checkout')}
                      >
                        {ar ? 'مغادرة' : 'Check-out'}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
