/**
 * Display order and colour of booking rows (daily stays, lease reservations, viewings, holds):
 * what needs the owner's approval first, then what needs action, in-house, upcoming, finished,
 * and cancelled last.
 */

export type BookingStatusTone =
  'approval' | 'warning' | 'positive' | 'info' | 'neutral' | 'negative';

const NEEDS_APPROVAL = new Set([
  'request_pending',
  'pending_manager_approval',
  'awaiting_approval',
]);
const NEEDS_ACTION = new Set(['requested', 'payment_pending']);
const IN_PROGRESS = new Set(['checked_in']);
const UPCOMING = new Set(['confirmed', 'paid', 'pre_arrival', 'scheduled']);
const FINISHED = new Set(['checked_out', 'closed', 'converted', 'completed']);
const CANCELLED = new Set([
  'cancelled',
  'expired',
  'no_show',
  'payment_failed',
  'rejected',
  'released',
  'void',
]);

/** A lease reservation in `pending` waits for the deposit to be confirmed. */
export function bookingNeedsApproval(status: string, recordKind?: string): boolean {
  return NEEDS_APPROVAL.has(status) || (recordKind === 'reservation' && status === 'pending');
}

/** 0 = needs approval … 5 = cancelled. Unknown statuses sit with upcoming rows. */
export function bookingPriority(status: string, recordKind?: string): number {
  if (bookingNeedsApproval(status, recordKind)) return 0;
  if (NEEDS_ACTION.has(status)) return 1;
  if (IN_PROGRESS.has(status) || (recordKind === 'hold' && status === 'active')) return 2;
  if (UPCOMING.has(status)) return 3;
  if (FINISHED.has(status)) return 4;
  if (CANCELLED.has(status)) return 5;
  return 3;
}

export function bookingStatusTone(status: string, recordKind?: string): BookingStatusTone {
  if (bookingNeedsApproval(status, recordKind)) return 'approval';
  if (NEEDS_ACTION.has(status) || status === 'pending') return 'warning';
  if (status === 'scheduled' || (recordKind === 'hold' && status === 'active')) return 'info';
  if (IN_PROGRESS.has(status) || UPCOMING.has(status) || status === 'converted') {
    return 'positive';
  }
  if (CANCELLED.has(status)) return 'negative';
  return 'neutral';
}

export type BookingSortKey = { status: string; recordKind?: string; date?: string | null };

/**
 * Higher priority first. Open rows show the nearest date first; finished and cancelled rows
 * show the most recent first.
 */
export function compareBookingPriority(a: BookingSortKey, b: BookingSortKey): number {
  const rankA = bookingPriority(a.status, a.recordKind);
  const rankB = bookingPriority(b.status, b.recordKind);
  if (rankA !== rankB) return rankA - rankB;
  const dateA = a.date ?? '';
  const dateB = b.date ?? '';
  if (dateA === dateB) return 0;
  if (!dateA) return 1;
  if (!dateB) return -1;
  return rankA >= 4 ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
}
