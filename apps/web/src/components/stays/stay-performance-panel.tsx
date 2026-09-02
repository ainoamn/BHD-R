import { EmptyState } from '@bhd-r/ui';
import { formatMoney } from '@/lib/format';

export type StayPerformanceMetrics = {
  fromOn: string;
  toOn: string;
  currency: string | null;
  availableRoomNights: number;
  occupiedRoomNights: number;
  roomRevenueMinor: string;
  occupancyPercent: string | null;
  adrMinor: string | null;
  revparMinor: string | null;
  bookingCount: number;
};

export function StayPerformancePanel({
  locale,
  metrics,
}: {
  locale: string;
  metrics: StayPerformanceMetrics | null;
}) {
  const ar = locale === 'ar';

  if (!metrics) {
    return (
      <EmptyState
        title={ar ? 'لا بيانات أداء بعد' : 'No performance data yet'}
        description={
          ar
            ? 'يظهر الإشغال ومتوسط سعر الليلة وإيراد الغرفة بعد تفعيل المخزون والحجوزات المؤكدة.'
            : 'Occupancy, average daily rate, and revenue per room appear once inventory and confirmed stays exist.'
        }
      />
    );
  }

  const money = (minor: string | null) =>
    minor == null || !metrics.currency ? '—' : formatMoney(minor, metrics.currency, locale);

  return (
    <div className="stays-performance">
      <p className="muted" dir="ltr">
        {metrics.fromOn} → {metrics.toOn}
      </p>
      <ul className="stays-portal__stats stays-performance__stats">
        <li>
          <span>{ar ? 'الإشغال' : 'Occupancy'}</span>
          <strong dir="ltr">
            {metrics.occupancyPercent != null ? `${metrics.occupancyPercent}%` : '—'}
          </strong>
        </li>
        <li>
          <span>{ar ? 'متوسط سعر الليلة' : 'Avg nightly rate'}</span>
          <strong dir="ltr">{money(metrics.adrMinor)}</strong>
        </li>
        <li>
          <span>{ar ? 'إيراد الغرفة / ليلة' : 'Rev. per room night'}</span>
          <strong dir="ltr">{money(metrics.revparMinor)}</strong>
        </li>
        <li>
          <span>{ar ? 'ليالي مشغولة' : 'Occupied nights'}</span>
          <strong dir="ltr">
            {metrics.occupiedRoomNights}/{metrics.availableRoomNights}
          </strong>
        </li>
        <li>
          <span>{ar ? 'إيراد الغرف' : 'Room revenue'}</span>
          <strong dir="ltr">{money(metrics.roomRevenueMinor)}</strong>
        </li>
        <li>
          <span>{ar ? 'حجوزات في النطاق' : 'Bookings in range'}</span>
          <strong dir="ltr">{metrics.bookingCount}</strong>
        </li>
      </ul>
    </div>
  );
}
