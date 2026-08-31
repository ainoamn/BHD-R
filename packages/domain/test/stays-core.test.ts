import { describe, expect, it } from 'vitest';
import {
  assertStayBookingTransition,
  availabilityFromLockKinds,
  computeStayPerformanceMetrics,
  formatDaterangeLiteral,
  nightsBetween,
  quoteStay,
  simulateConcurrentLockWinner,
  stayRangeFullyAvailable,
  stayRangesOverlap,
} from '../src/stays/index.js';

describe('stay availability half-open ranges', () => {
  it('treats adjacent nights as non-overlapping [checkIn, checkOut)', () => {
    expect(
      stayRangesOverlap(
        { checkInOn: '2026-09-01', checkOutOn: '2026-09-03' },
        { checkInOn: '2026-09-03', checkOutOn: '2026-09-05' },
      ),
    ).toBe(false);
    expect(nightsBetween({ checkInOn: '2026-09-01', checkOutOn: '2026-09-03' })).toBe(2);
    expect(formatDaterangeLiteral({ checkInOn: '2026-09-01', checkOutOn: '2026-09-03' })).toBe(
      '[2026-09-01,2026-09-03)',
    );
  });

  it('detects overlapping stays', () => {
    expect(
      stayRangesOverlap(
        { checkInOn: '2026-09-01', checkOutOn: '2026-09-04' },
        { checkInOn: '2026-09-02', checkOutOn: '2026-09-05' },
      ),
    ).toBe(true);
    expect(
      stayRangesOverlap(
        { checkInOn: '2026-09-01', checkOutOn: '2026-09-10' },
        { checkInOn: '2026-08-28', checkOutOn: '2026-09-02' },
      ),
    ).toBe(true);
  });
});

describe('stay pricing OMR 3 decimals', () => {
  it('prices base nights + weekend + cleaning without float', () => {
    // 12.345 OMR = 12345 baisa; weekend 15.000; cleaning 5.000
    const quote = quoteStay({
      currency: 'OMR',
      checkInOn: '2026-09-03', // Thursday
      checkOutOn: '2026-09-06', // Sun exclusive → Thu, Fri, Sat (3 nights)
      baseNightlyMinor: '12345',
      weekendNightlyMinor: '15000',
      cleaningFeeMinor: '5000',
      weekendDays: [5, 6],
    });
    expect(quote.minorUnit).toBe(3);
    expect(quote.nights).toBe(3);
    // Thu base, Fri weekend, Sat weekend
    expect(quote.nightLines.map((line) => line.amountMinor)).toEqual(['12345', '15000', '15000']);
    expect(quote.subtotalMinor).toBe(String(12345 + 15000 + 15000));
    expect(quote.cleaningFeeMinor).toBe('5000');
    expect(quote.totalMinor).toBe(String(12345 + 15000 + 15000 + 5000));
  });

  it('rejects non-integer minor strings', () => {
    expect(() =>
      quoteStay({
        currency: 'OMR',
        checkInOn: '2026-09-01',
        checkOutOn: '2026-09-02',
        baseNightlyMinor: '12.345',
      }),
    ).toThrow();
  });
});

describe('stay booking machine', () => {
  it('rejects illegal transitions', () => {
    expect(assertStayBookingTransition('request_pending', 'checked_in').ok).toBe(false);
    expect(assertStayBookingTransition('payment_pending', 'confirmed').ok).toBe(true);
    expect(assertStayBookingTransition('confirmed', 'pre_arrival').ok).toBe(true);
    expect(assertStayBookingTransition('checked_out', 'cancelled').ok).toBe(false);
  });
});

describe('concurrent lock winner (domain simulation)', () => {
  /**
   * Documents that this is an in-memory first-writer-wins model for unit tests.
   * Source of truth in production is PostgreSQL GiST EXCLUDE on stay_inventory_locks
   * (unit_id WITH =, stay_range WITH &&) WHERE status = 'active'.
   */
  it('accepts only non-overlapping attempts; first overlapping writer wins', () => {
    const range = { checkInOn: '2026-10-01', checkOutOn: '2026-10-05' };
    const attempts = Array.from({ length: 50 }, () => ({ ...range }));
    const result = simulateConcurrentLockWinner(attempts);
    expect(result.winnerIndex).toBe(0);
    expect(result.rejectedIndexes).toHaveLength(49);
    expect(result.rejectedIndexes).not.toContain(0);
  });

  it('allows adjacent checkout/check-in on the same unit', () => {
    const result = simulateConcurrentLockWinner([
      { checkInOn: '2026-10-01', checkOutOn: '2026-10-03' },
      { checkInOn: '2026-10-03', checkOutOn: '2026-10-05' },
    ]);
    expect(result.winnerIndex).toBe(0);
    expect(result.rejectedIndexes).toEqual([]);
  });
});

describe('inventory day projection priority', () => {
  it('prefers booking over hold and blocks over available', () => {
    expect(availabilityFromLockKinds(['hold', 'booking'])).toBe('booked');
    expect(availabilityFromLockKinds(['hold'])).toBe('hold');
    expect(availabilityFromLockKinds(['maintenance'])).toBe('maintenance');
    expect(availabilityFromLockKinds(['owner_block'])).toBe('blocked');
    expect(availabilityFromLockKinds([])).toBe('available');
  });
});

describe('stay range fully available', () => {
  it('requires every night in [checkIn, checkOut) to be available', () => {
    expect(
      stayRangeFullyAvailable(
        [
          { stayDate: '2026-11-01', availabilityStatus: 'available' },
          { stayDate: '2026-11-02', availabilityStatus: 'available' },
        ],
        { checkInOn: '2026-11-01', checkOutOn: '2026-11-03' },
      ),
    ).toBe(true);
    expect(
      stayRangeFullyAvailable(
        [
          { stayDate: '2026-11-01', availabilityStatus: 'available' },
          { stayDate: '2026-11-02', availabilityStatus: 'booked' },
        ],
        { checkInOn: '2026-11-01', checkOutOn: '2026-11-03' },
      ),
    ).toBe(false);
    expect(
      stayRangeFullyAvailable([{ stayDate: '2026-11-01', availabilityStatus: 'available' }], {
        checkInOn: '2026-11-01',
        checkOutOn: '2026-11-03',
      }),
    ).toBe(false);
  });
});

describe('stay performance Occupancy / ADR / RevPAR', () => {
  it('computes KPIs with integer minor money', () => {
    const metrics = computeStayPerformanceMetrics({
      availableRoomNights: 10,
      occupiedRoomNights: 5,
      roomRevenueMinor: '100000',
    });
    expect(metrics.occupancyPercent).toBe('50.00');
    expect(metrics.occupancyRatio).toBe('0.500000');
    expect(metrics.adrMinor).toBe('20000');
    expect(metrics.revparMinor).toBe('10000');
  });

  it('returns null ADR/RevPAR when denominators are zero', () => {
    const empty = computeStayPerformanceMetrics({
      availableRoomNights: 0,
      occupiedRoomNights: 0,
      roomRevenueMinor: '0',
    });
    expect(empty.occupancyPercent).toBeNull();
    expect(empty.adrMinor).toBeNull();
    expect(empty.revparMinor).toBeNull();
  });
});
