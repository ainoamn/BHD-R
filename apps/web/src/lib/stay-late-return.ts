/**
 * Late return vs the stay's booked check-out clock (Asia/Muscat).
 * Used after host check-out to show owners/accountants a deposit decision fact.
 */

import { muscatLocalDateTime } from '@/lib/stay-checkin-window';
import {
  displayStayCheckoutOn,
  resolveStayPeriodTimes,
  type StayPeriodProfileTimes,
  type StayPeriodType,
} from '@/lib/stay-period-times';

export type StayLateReturn = {
  scheduledAt: string;
  actualAt: string;
  lateMinutes: number;
  lateHours: number;
  lateDays: number;
  /** Human summary for UI (Arabic / English). */
  labelAr: string;
  labelEn: string;
};

export function computeStayLateReturn(input: {
  checkInOn: string;
  checkOutOn: string;
  stayType: StayPeriodType | string | null | undefined;
  profile: StayPeriodProfileTimes;
  /** Actual check-out instant (ISO). */
  actualAt: Date | string;
}): StayLateReturn {
  const period = resolveStayPeriodTimes(input.stayType as StayPeriodType | null, input.profile);
  const displayOutOn = displayStayCheckoutOn(input.stayType, input.checkInOn, input.checkOutOn);
  const scheduled = muscatLocalDateTime(displayOutOn, period.checkOutTime);
  const actual = typeof input.actualAt === 'string' ? new Date(input.actualAt) : input.actualAt;
  const actualMs = actual.getTime();
  const scheduledMs = scheduled.getTime();
  const lateMinutes =
    Number.isFinite(actualMs) && Number.isFinite(scheduledMs) && actualMs > scheduledMs
      ? Math.floor((actualMs - scheduledMs) / 60_000)
      : 0;
  const lateDays = Math.floor(lateMinutes / (24 * 60));
  const lateHours = Math.floor((lateMinutes % (24 * 60)) / 60);
  const remMinutes = lateMinutes % 60;
  const labelAr =
    lateMinutes <= 0
      ? 'بدون تأخير عن موعد المغادرة'
      : [
          lateDays > 0 ? `${lateDays} يوم` : null,
          lateHours > 0 ? `${lateHours} ساعة` : null,
          remMinutes > 0 && lateDays === 0 ? `${remMinutes} دقيقة` : null,
        ]
          .filter(Boolean)
          .join(' و ') || `${lateMinutes} دقيقة`;
  const labelEn =
    lateMinutes <= 0
      ? 'No delay past scheduled check-out'
      : [
          lateDays > 0 ? `${lateDays}d` : null,
          lateHours > 0 ? `${lateHours}h` : null,
          remMinutes > 0 && lateDays === 0 ? `${remMinutes}m` : null,
        ]
          .filter(Boolean)
          .join(' ') || `${lateMinutes}m`;
  return {
    scheduledAt: scheduled.toISOString(),
    actualAt: actual.toISOString(),
    lateMinutes,
    lateHours: lateDays * 24 + lateHours,
    lateDays,
    labelAr,
    labelEn,
  };
}
