import { describe, expect, it } from 'vitest';
import {
  leaseOwnerLifecycleState,
  ownerLifecycleState,
  stayGuestStageDetail,
} from '../../src/lib/owner-lifecycle-status';

describe('owner lifecycle status', () => {
  const today = '2026-10-22';

  it('aligns stay bookings with contract lifecycle', () => {
    expect(
      ownerLifecycleState({
        contractStatus: 'signed',
        linkedStatus: 'checked_in',
        endsOn: '2026-10-25',
        today,
      }),
    ).toBe('active');
    expect(
      ownerLifecycleState({
        contractStatus: 'signed',
        linkedStatus: 'checked_out',
        endsOn: '2026-10-25',
        today,
      }),
    ).toBe('cancelled');
    expect(
      ownerLifecycleState({
        contractStatus: 'terminated',
        linkedStatus: 'checked_out',
        endsOn: '2026-10-25',
        today,
      }),
    ).toBe('cancelled');
    expect(
      ownerLifecycleState({
        contractStatus: 'draft',
        linkedStatus: 'request_pending',
        endsOn: '2026-10-25',
        today,
      }),
    ).toBe('pending');
    expect(
      ownerLifecycleState({
        contractStatus: 'signed',
        linkedStatus: 'cancelled',
        endsOn: '2026-10-25',
        today,
      }),
    ).toBe('cancelled');
  });

  it('maps stay-linked leases like daily contracts', () => {
    expect(
      leaseOwnerLifecycleState({
        leaseStatus: 'active',
        endsOn: '2026-10-25',
        today,
        sourceType: 'stay_booking',
        contractStatus: 'signed',
        linkedBookingStatus: 'checked_in',
      }),
    ).toBe('active');
    expect(
      leaseOwnerLifecycleState({
        leaseStatus: 'active',
        endsOn: '2026-10-25',
        today,
        sourceType: 'stay_booking',
        contractStatus: 'signed',
        linkedBookingStatus: 'checked_out',
      }),
    ).toBe('cancelled');
  });

  it('maps long-term leases onto the same four labels', () => {
    expect(
      leaseOwnerLifecycleState({
        leaseStatus: 'active',
        endsOn: '2027-01-01',
        today,
        sourceType: 'manual',
      }),
    ).toBe('active');
    expect(
      leaseOwnerLifecycleState({
        leaseStatus: 'active',
        endsOn: '2026-10-01',
        today,
        sourceType: 'manual',
      }),
    ).toBe('ended');
    expect(
      leaseOwnerLifecycleState({
        leaseStatus: 'draft',
        endsOn: '2027-01-01',
        today,
      }),
    ).toBe('pending');
    expect(
      leaseOwnerLifecycleState({
        leaseStatus: 'cancelled',
        endsOn: '2027-01-01',
        today,
      }),
    ).toBe('cancelled');
  });

  it('keeps guest journey as a detail under the lifecycle badge', () => {
    expect(stayGuestStageDetail('checked_in', 'awaiting_check_out')).toBe('awaiting_check_out');
    expect(stayGuestStageDetail('checked_out', 'checked_out')).toBeNull();
    expect(
      stayGuestStageDetail('confirmed', 'awaiting_check_in', { reschedulePending: true }),
    ).toBe('reschedule_pending');
  });
});
