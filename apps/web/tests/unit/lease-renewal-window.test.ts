import { describe, expect, it } from 'vitest';
import {
  isLeaseRenewalWindowOpen,
  leaseDaysRemaining,
  RENEWAL_HEADS_UP_DAYS,
  RENEWAL_OPEN_WITHIN_DAYS,
} from '@/lib/lease-renewal-window';

describe('lease renewal window', () => {
  it('blocks renewal when more than 90 days remain', () => {
    expect(isLeaseRenewalWindowOpen('2026-06-01', '2026-01-01')).toBe(false);
    expect(leaseDaysRemaining('2026-06-01', '2026-01-01')).toBeGreaterThan(
      RENEWAL_OPEN_WITHIN_DAYS,
    );
  });

  it('opens renewal at 90 days or fewer', () => {
    expect(isLeaseRenewalWindowOpen('2026-04-01', '2026-01-01')).toBe(true);
    expect(leaseDaysRemaining('2026-04-01', '2026-01-01')).toBe(90);
    expect(isLeaseRenewalWindowOpen('2026-03-01', '2026-01-01')).toBe(true);
  });

  it('keeps renewal open after expiry', () => {
    expect(isLeaseRenewalWindowOpen('2025-12-01', '2026-01-01')).toBe(true);
    expect(leaseDaysRemaining('2025-12-01', '2026-01-01')).toBeLessThan(0);
  });

  it('heads-up day is before the open window', () => {
    expect(RENEWAL_HEADS_UP_DAYS).toBeGreaterThan(RENEWAL_OPEN_WITHIN_DAYS);
  });
});
