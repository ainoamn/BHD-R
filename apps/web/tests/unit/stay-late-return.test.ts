import { describe, expect, it } from 'vitest';
import { computeStayLateReturn } from '@/lib/stay-late-return';

describe('computeStayLateReturn', () => {
  it('reports no delay when the guest left on time', () => {
    const result = computeStayLateReturn({
      checkInOn: '2026-10-21',
      checkOutOn: '2026-10-22',
      stayType: 'day_use',
      profile: { dayUseCheckOutUntil: '22:00' },
      actualAt: '2026-10-21T16:56:00+04:00',
    });
    expect(result.lateMinutes).toBe(0);
    expect(result.labelAr).toContain('بدون تأخير');
  });

  it('counts hours when the guest leaves after the booked check-out', () => {
    const result = computeStayLateReturn({
      checkInOn: '2026-10-21',
      checkOutOn: '2026-10-22',
      stayType: 'day_use',
      profile: { dayUseCheckOutUntil: '22:00' },
      actualAt: '2026-10-22T01:30:00+04:00',
    });
    expect(result.lateMinutes).toBe(3 * 60 + 30);
    expect(result.lateDays).toBe(0);
    expect(result.labelAr).toContain('ساعة');
  });
});
