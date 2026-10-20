import { describe, expect, it } from 'vitest';
import {
  bookingNeedsApproval,
  bookingPriority,
  bookingStatusTone,
  compareBookingPriority,
} from '@/lib/booking-priority';

describe('booking priority', () => {
  it('flags requests and pending deposits as needing approval', () => {
    expect(bookingNeedsApproval('request_pending', 'stay_booking')).toBe(true);
    expect(bookingNeedsApproval('pending', 'reservation')).toBe(true);
    expect(bookingNeedsApproval('pending', 'viewing')).toBe(false);
    expect(bookingNeedsApproval('confirmed', 'stay_booking')).toBe(false);
  });

  it('ranks approval, action, in-house, upcoming, finished, cancelled', () => {
    expect(
      [
        'cancelled',
        'checked_out',
        'confirmed',
        'checked_in',
        'payment_pending',
        'request_pending',
      ].map((status) => bookingPriority(status, 'stay_booking')),
    ).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it('sorts approvals first, open rows by nearest date, closed rows most recent first', () => {
    const rows = [
      { id: 'old-done', status: 'checked_out', date: '2026-09-01' },
      { id: 'late-confirmed', status: 'confirmed', date: '2026-12-01' },
      { id: 'new-done', status: 'checked_out', date: '2026-10-01' },
      { id: 'request', status: 'request_pending', date: '2026-11-15' },
      { id: 'soon-confirmed', status: 'confirmed', date: '2026-10-20' },
      { id: 'cancelled', status: 'cancelled', date: '2026-10-25' },
      { id: 'deposit', status: 'pending', recordKind: 'reservation', date: '2026-10-30' },
    ];
    expect(rows.sort(compareBookingPriority).map((row) => row.id)).toEqual([
      'deposit',
      'request',
      'soon-confirmed',
      'late-confirmed',
      'new-done',
      'old-done',
      'cancelled',
    ]);
  });

  it('gives each status family its own colour', () => {
    expect(bookingStatusTone('request_pending', 'stay_booking')).toBe('approval');
    expect(bookingStatusTone('payment_pending', 'stay_booking')).toBe('warning');
    expect(bookingStatusTone('scheduled', 'viewing')).toBe('info');
    expect(bookingStatusTone('confirmed', 'stay_booking')).toBe('positive');
    expect(bookingStatusTone('checked_out', 'stay_booking')).toBe('neutral');
    expect(bookingStatusTone('completed', 'viewing')).toBe('positive');
    expect(bookingStatusTone('cancelled', 'stay_booking')).toBe('negative');
  });
});
