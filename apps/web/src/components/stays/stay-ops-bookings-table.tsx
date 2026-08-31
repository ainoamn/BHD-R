import { EmptyState } from '@bhd-r/ui';

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

export function StayOpsBookingsTable({
  locale,
  items,
}: {
  locale: string;
  items: OpsStayBooking[];
}) {
  const ar = locale === 'ar';

  if (!items.length) {
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
          </tr>
        </thead>
        <tbody>
          {items.map((booking) => (
            <tr key={booking.id}>
              <td dir="ltr">{booking.referenceCode}</td>
              <td dir="ltr">
                {booking.checkInOn} → {booking.checkOutOn}
              </td>
              <td dir="ltr">{booking.nights ?? '—'}</td>
              <td dir="ltr">{booking.status}</td>
              <td dir="ltr">{booking.bookingMode}</td>
              <td dir="ltr">
                {booking.currency} {booking.totalMinor}
              </td>
              <td dir="ltr" className="muted">
                {booking.unitId.slice(0, 8)}…
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
