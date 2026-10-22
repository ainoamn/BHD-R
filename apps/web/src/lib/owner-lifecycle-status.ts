/**
 * One owner-facing lifecycle for stay bookings, daily contracts, and stay-linked leases:
 * ساري / منتهي / ملغي / معلق — so /owner/bookings, /leasing, and /contracts?kind=daily agree.
 */

import {
  CONTRACT_STATE_LABELS,
  contractState,
  type ContractState,
} from '@/lib/contract-list-facets';

export type OwnerLifecycleState = ContractState;

export const OWNER_LIFECYCLE_LABELS = CONTRACT_STATE_LABELS;

export const OWNER_LIFECYCLE_TONE: Record<OwnerLifecycleState, string> = {
  active: 'ready',
  ended: 'muted',
  cancelled: 'danger',
  pending: 'warn',
};

/** Shared resolver used by bookings, leasing, and contracts lists. */
export function ownerLifecycleState(input: {
  /** contracts.status when known; for leases without a contract row, pass null. */
  contractStatus: string | null | undefined;
  /**
   * Authoritative ops status: stay_bookings.status for daily stays, else leases.status.
   */
  linkedStatus: string | null | undefined;
  endsOn: string | null | undefined;
  today: string;
}): OwnerLifecycleState {
  return contractState({
    status: input.contractStatus,
    linkedStatus: input.linkedStatus,
    endsOn: input.endsOn,
    today: input.today,
  });
}

/**
 * Long-term lease rows (not stay_booking): map lease enum onto the same four states
 * so /owner/leasing never mixes “نشط” with contract “ساري” wording.
 */
export function leaseOwnerLifecycleState(input: {
  leaseStatus: string | null | undefined;
  endsOn: string | null | undefined;
  today: string;
  sourceType?: string | null;
  contractStatus?: string | null;
  linkedBookingStatus?: string | null;
}): OwnerLifecycleState {
  if (input.sourceType === 'stay_booking') {
    const contractStatus =
      input.contractStatus ??
      (input.leaseStatus === 'active' ||
      input.leaseStatus === 'ended' ||
      input.leaseStatus === 'cancelled'
        ? 'signed'
        : input.leaseStatus === 'draft'
          ? 'draft'
          : 'signed');
    return ownerLifecycleState({
      contractStatus,
      linkedStatus: input.linkedBookingStatus ?? input.leaseStatus,
      endsOn: input.endsOn,
      today: input.today,
    });
  }
  const status = input.leaseStatus ?? '';
  if (status === 'cancelled' || status === 'terminated') return 'cancelled';
  if (status === 'ended') return 'ended';
  if (status === 'active') {
    const endsOn = input.endsOn?.slice(0, 10);
    if (endsOn && endsOn < input.today) return 'ended';
    return 'active';
  }
  return 'pending';
}

export function ownerLifecycleLabel(
  state: OwnerLifecycleState,
  locale: 'ar' | 'en',
): string {
  const hit = OWNER_LIFECYCLE_LABELS[state];
  return locale === 'ar' ? hit.ar : hit.en;
}

/** Guest-journey subtitle under the shared lifecycle badge (optional). */
export function stayGuestStageDetail(
  bookingStatus: string | null | undefined,
  stage: string | null | undefined,
  options?: { reschedulePending?: boolean },
): string | null {
  if (options?.reschedulePending) return 'reschedule_pending';
  const key = stage ?? bookingStatus ?? null;
  if (!key) return null;
  // Already covered by the lifecycle badge — skip repeating.
  if (
    key === 'closed' ||
    key === 'checked_out' ||
    key === 'cancelled' ||
    key === 'expired' ||
    key === 'no_show' ||
    key === 'payment_failed' ||
    key === 'active' ||
    key === 'ended' ||
    key === 'pending'
  ) {
    return null;
  }
  return key;
}
