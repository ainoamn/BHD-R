'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { EmptyState } from '@bhd-r/ui';
import { ApiError, browserMutation } from '@/lib/api';
import { formatMoney } from '@/lib/format';

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
};

const CANCELABLE = new Set(['request_pending', 'payment_pending', 'confirmed', 'pre_arrival']);

const NO_SHOWABLE = new Set(['confirmed', 'pre_arrival']);

const CHECKOUTABLE = new Set(['checked_in']);

function statusLabel(status: string, ar: boolean): string {
  const labels: Record<string, { ar: string; en: string }> = {
    payment_pending: { ar: 'بانتظار الدفع', en: 'Awaiting payment' },
    request_pending: { ar: 'بانتظار الاعتماد', en: 'Awaiting approval' },
    confirmed: { ar: 'مؤكّد', en: 'Confirmed' },
    paid: { ar: 'مدفوع', en: 'Paid' },
    pre_arrival: { ar: 'قبل الوصول', en: 'Pre-arrival' },
    checked_in: { ar: 'تم الوصول', en: 'Checked in' },
    checked_out: { ar: 'تم المغادرة', en: 'Checked out' },
    cancelled: { ar: 'ملغى', en: 'Cancelled' },
    no_show: { ar: 'لم يحضر', en: 'No-show' },
  };
  const hit = labels[status];
  return hit ? (ar ? hit.ar : hit.en) : status;
}

export function StayOpsBookingsTable({
  locale,
  items,
}: {
  locale: string;
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
            <th>{ar ? 'التواريخ' : 'Dates'}</th>
            <th>{ar ? 'الليالي' : 'Nights'}</th>
            <th>{ar ? 'الحالة' : 'Status'}</th>
            <th>{ar ? 'النمط' : 'Mode'}</th>
            <th>{ar ? 'المبلغ' : 'Total'}</th>
            <th>{ar ? 'الوحدة' : 'Unit'}</th>
            <th>{ar ? 'إجراءات' : 'Actions'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((booking) => {
            const disabled = pending || busyId === booking.id;
            const canCancel = CANCELABLE.has(booking.status);
            const canNoShow = NO_SHOWABLE.has(booking.status);
            const canCheckout = CHECKOUTABLE.has(booking.status);
            return (
              <tr key={booking.id}>
                <td dir="ltr">{booking.referenceCode}</td>
                <td dir="ltr">
                  {booking.checkInOn} → {booking.checkOutOn}
                </td>
                <td dir="ltr">{booking.nights ?? '—'}</td>
                <td>{statusLabel(booking.status, ar)}</td>
                <td dir="ltr">{booking.bookingMode}</td>
                <td dir="ltr">{formatMoney(booking.totalMinor, booking.currency, locale)}</td>
                <td dir="ltr" className="muted">
                  {booking.unitId.slice(0, 8)}…
                </td>
                <td>
                  <div className="stays-ops-bookings__actions">
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
                    {!canCancel && !canNoShow && !canCheckout ? (
                      <span className="muted">—</span>
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
