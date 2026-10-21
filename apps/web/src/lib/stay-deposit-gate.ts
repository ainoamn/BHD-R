/** Idempotency key for the refundable stay security deposit intent. */
export function stayDepositIdempotencyKey(bookingId: string): string {
  return `stay_deposit:${bookingId}`;
}

export type StayDepositGateStatus = 'none' | 'unpaid' | 'paid' | 'waived';

export type StayDepositGate = {
  /** Profile requires a positive deposit before check-in. */
  required: boolean;
  status: StayDepositGateStatus;
  amountMinor: string | null;
  currency: string;
};

export type StayDepositWaiveMeta = {
  at: string;
  byUserId: string;
  byName: string | null;
};

export function readDepositWaived(snapshot: unknown): StayDepositWaiveMeta | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const row = (snapshot as { depositWaived?: unknown }).depositWaived;
  if (!row || typeof row !== 'object') return null;
  const meta = row as Record<string, unknown>;
  if (typeof meta.at !== 'string' || typeof meta.byUserId !== 'string') return null;
  return {
    at: meta.at,
    byUserId: meta.byUserId,
    byName: typeof meta.byName === 'string' ? meta.byName : null,
  };
}
