/**
 * One thing waiting for the viewer: a contract to sign, a stay booking request, a deposit
 * refund to decide (host), or an approved deposit refund to transfer (accountant).
 */
export type PendingApprovalItem = {
  kind: 'contract' | 'stay_booking' | 'deposit_refund' | 'refund_transfer';
  id: string;
  reference: string;
  propertyId: string;
  propertyNameAr: string;
  propertyNameEn: string | null;
  unitCode: string | null;
  party: string | null;
  contractType: 'lease' | 'sale' | null;
  fromOn: string | null;
  requestedAt: string;
};

export type PendingApprovals = {
  items: PendingApprovalItem[];
  contracts: number;
  bookings: number;
  refunds: number;
  total: number;
};

export const EMPTY_PENDING_APPROVALS: PendingApprovals = {
  items: [],
  contracts: 0,
  bookings: 0,
  refunds: 0,
  total: 0,
};

/** Fired after an approval action so the header bell refetches its count. */
export const PENDING_APPROVALS_CHANGED_EVENT = 'bhd-r-pending-approvals-changed';

/** Where the viewer approves the item: the property hub tab that holds the approve button. */
export function pendingApprovalHref(portal: string, item: PendingApprovalItem): string {
  const base = `/${portal}/properties/${encodeURIComponent(item.propertyId)}`;
  if (item.kind === 'contract') {
    return `${base}?section=contracts&focus=${encodeURIComponent(item.id)}`;
  }
  if (item.kind === 'deposit_refund') {
    return `${base}?section=bookings&focus=${encodeURIComponent(item.id)}`;
  }
  if (item.kind === 'refund_transfer') {
    return `${base}?section=accounting&focus=${encodeURIComponent(item.id)}`;
  }
  return `${base}?section=bookings`;
}

export function pendingApprovalTitle(item: PendingApprovalItem, ar: boolean): string {
  if (item.kind === 'stay_booking') {
    return ar ? 'طلب حجز بانتظار الاعتماد' : 'Booking request awaiting approval';
  }
  if (item.kind === 'deposit_refund') {
    return ar ? 'استرداد تأمين بانتظار قرارك' : 'Deposit refund awaiting your decision';
  }
  if (item.kind === 'refund_transfer') {
    return ar
      ? 'تأمين معتمد بانتظار تحويلك (الحسابات)'
      : 'Approved deposit awaiting your transfer (Accounting)';
  }
  if (item.contractType === 'sale') {
    return ar ? 'عقد بيع بانتظار اعتمادك' : 'Sale contract awaiting your approval';
  }
  return ar ? 'عقد إيجار بانتظار اعتمادك' : 'Lease contract awaiting your approval';
}
