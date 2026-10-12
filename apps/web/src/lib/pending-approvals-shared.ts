import { formatMoney } from '@/lib/format';
import type { LeaseJourneyPhase } from '@/lib/lease-reservation-lifecycle';

/**
 * One thing waiting for the viewer: a contract to sign, a stay booking request, a paid rent or
 * purchase booking awaiting its final contract, a deposit refund to decide (host), an approved
 * deposit refund to transfer (accountant), a guest's deposit request or objection (host), or a
 * guest complaint (site administration).
 */
export type PendingApprovalItem = {
  kind:
    | 'contract'
    | 'stay_booking'
    | 'lease_reservation'
    | 'deposit_refund'
    | 'refund_transfer'
    | 'deposit_claim'
    | 'deposit_complaint'
    | 'sale_decision';
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
  /** Deposit still to transfer for `refund_transfer`; deposit paid for `lease_reservation`. */
  amountMinor?: string | null;
  currency?: string | null;
  /** Where a `lease_reservation` stands: which owner step is due. */
  phase?: LeaseJourneyPhase | null;
};

export type PendingApprovals = {
  items: PendingApprovalItem[];
  contracts: number;
  bookings: number;
  /** Paid rent or purchase bookings awaiting their final contract. */
  reservations: number;
  refunds: number;
  total: number;
};

export const EMPTY_PENDING_APPROVALS: PendingApprovals = {
  items: [],
  contracts: 0,
  bookings: 0,
  reservations: 0,
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
  if (item.kind === 'lease_reservation' && portal === 'owner') {
    return `/owner/bookings/${encodeURIComponent(item.id)}`;
  }
  if (item.kind === 'deposit_refund' || item.kind === 'lease_reservation') {
    return `${base}?section=bookings&focus=${encodeURIComponent(item.id)}`;
  }
  if (item.kind === 'refund_transfer' || item.kind === 'deposit_claim') {
    return `/${portal}/accounting?focus=${encodeURIComponent(item.id)}#deposits`;
  }
  if (item.kind === 'deposit_complaint') return '/site-admin';
  if (item.kind === 'sale_decision') return `${base}?unit=${encodeURIComponent(item.id)}`;
  return `${base}?section=bookings`;
}

/**
 * "To transfer: 60.000 OMR" for a deposit transfer, "Deposit paid: 100.000 OMR" for a paid
 * rent or purchase booking; null for other items.
 */
export function pendingApprovalAmount(
  item: PendingApprovalItem,
  locale: 'ar' | 'en',
): string | null {
  if (item.kind !== 'refund_transfer' && item.kind !== 'lease_reservation') return null;
  if (!item.amountMinor || !/^\d+$/.test(item.amountMinor)) return null;
  const amount = formatMoney(item.amountMinor, item.currency || 'OMR', locale);
  if (item.kind === 'lease_reservation') {
    return locale === 'ar' ? `عربون مدفوع: ${amount}` : `Deposit paid: ${amount}`;
  }
  return locale === 'ar' ? `للتحويل: ${amount}` : `To transfer: ${amount}`;
}

export function pendingApprovalTitle(item: PendingApprovalItem, ar: boolean): string {
  if (item.kind === 'stay_booking') {
    return ar ? 'طلب حجز بانتظار الاعتماد' : 'Booking request awaiting approval';
  }
  if (item.kind === 'lease_reservation') {
    const sale = item.contractType === 'sale';
    const kind = sale ? (ar ? 'حجز شراء' : 'Purchase booking') : ar ? 'حجز إيجار' : 'Rent booking';
    switch (item.phase) {
      case 'awaiting_owner_approval':
        return ar ? `${kind} مدفوع — بانتظار اعتمادك` : `Paid ${kind.toLowerCase()} — approve it`;
      case 'awaiting_contract_draft':
        return ar
          ? `${kind} معتمد — جهّز ${sale ? 'عقد البيع' : 'العقد'} والمستندات`
          : `${kind} approved — prepare the contract`;
      case 'awaiting_documents_review':
        return ar ? `${kind} — مستندات بانتظار مراجعتك` : `${kind} — documents to review`;
      case 'awaiting_contract_approval':
        return ar ? `${kind} — العقد جاهز لاعتمادك` : `${kind} — contract ready to approve`;
      case 'awaiting_handover':
        return ar ? `${kind} — العقد موقّع، سجّل التسليم` : `${kind} — signed, record handover`;
      default:
        return sale
          ? ar
            ? 'حجز شراء مدفوع — جهّز عقد البيع'
            : 'Paid purchase booking — prepare the sale'
          : ar
            ? 'حجز إيجار مدفوع — جهّز العقد'
            : 'Paid rent booking — prepare the lease';
    }
  }
  if (item.kind === 'deposit_refund') {
    return ar ? 'استرداد تأمين بانتظار قرارك' : 'Deposit refund awaiting your decision';
  }
  if (item.kind === 'refund_transfer') {
    return ar ? 'معاملة تحويل تأمين (الحسابات)' : 'Deposit transfer to make (Accounting)';
  }
  if (item.kind === 'deposit_claim') {
    return ar ? 'طلب أو اعتراض من الضيف على التأمين' : 'Guest deposit request or objection';
  }
  if (item.kind === 'deposit_complaint') {
    return ar ? 'شكوى تأمين لدى إدارة الموقع' : 'Deposit complaint for the site administration';
  }
  if (item.kind === 'sale_decision') {
    return ar
      ? 'تم تأجير الوحدة — هل ما زلت تريد بيعها؟'
      : 'Unit leased — do you still want to sell it?';
  }
  if (item.contractType === 'sale') {
    return ar ? 'عقد بيع بانتظار اعتمادك' : 'Sale contract awaiting your approval';
  }
  return ar ? 'عقد إيجار بانتظار اعتمادك' : 'Lease contract awaiting your approval';
}
