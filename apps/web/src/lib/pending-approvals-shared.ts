import { formatMoney } from '@/lib/format';
import type { LeaseJourneyPhase } from '@/lib/lease-reservation-lifecycle';
import { isTenantRequestType, tenantRequestTypeLabel } from '@/lib/tenant-requests-shared';

/**
 * One thing waiting for the viewer: a contract to sign, a stay booking request, a paid rent or
 * purchase booking awaiting its final contract, a deposit refund to decide (host), an approved
 * deposit refund to transfer (accountant), a guest's deposit request or objection (host), a
 * departed guest still to rate (host), or a guest complaint (site administration).
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
    | 'sale_decision'
    | 'guest_review'
    | 'legal_message'
    | 'tenant_request'
    | 'viewing_request';
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
  /** A `lease_reservation` whose documents the system accepted and the team still has to verify. */
  verifyDocuments?: boolean;
  /** For `sale_decision`: keep selling a leased rent-and-sale unit, or hide a leased or sold one. */
  decision?: 'keep_selling' | 'hide_leased' | 'hide_sold' | null;
  /** For `legal_message`: unread messages and updates on the case. */
  unread?: number;
  /** For `tenant_request`: what the tenant asked for. */
  requestType?: string;
  /** For `stay_booking`: request queue, newly confirmed, or guest reschedule awaiting owner. */
  stayPhase?: 'request' | 'confirmed' | 'reschedule';
};

export type PendingApprovals = {
  items: PendingApprovalItem[];
  contracts: number;
  bookings: number;
  /** Open viewing requests awaiting a scheduled slot from the host. */
  viewings: number;
  /** Paid rent or purchase bookings awaiting their final contract. */
  reservations: number;
  refunds: number;
  /** Departed stay guests the host has not rated yet. */
  reviews: number;
  total: number;
};

export const EMPTY_PENDING_APPROVALS: PendingApprovals = {
  items: [],
  contracts: 0,
  bookings: 0,
  viewings: 0,
  reservations: 0,
  refunds: 0,
  reviews: 0,
  total: 0,
};

/** Fired after an approval action so the header bell refetches its count. */
export const PENDING_APPROVALS_CHANGED_EVENT = 'bhd-r-pending-approvals-changed';

/** Where the viewer approves the item: the property hub tab that holds the approve button. */
export function pendingApprovalHref(portal: string, item: PendingApprovalItem): string {
  if (item.kind === 'legal_message') return `/${portal}/legal/${encodeURIComponent(item.id)}`;
  if (item.kind === 'tenant_request') {
    return `/owner/tenant-requests?focus=${encodeURIComponent(item.id)}`;
  }
  if (item.kind === 'viewing_request') {
    return `/${portal}/bookings/viewings/${encodeURIComponent(item.id)}`;
  }
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
  if (item.kind === 'guest_review') {
    return `${base}?section=bookings&focus=${encodeURIComponent(item.id)}&review=1`;
  }
  if (item.kind === 'refund_transfer' || item.kind === 'deposit_claim') {
    return `/${portal}/accounting?focus=${encodeURIComponent(item.id)}#deposits`;
  }
  if (item.kind === 'deposit_complaint') return '/admin/complaints';
  if (item.kind === 'sale_decision') return `${base}?unit=${encodeURIComponent(item.id)}`;
  if (item.kind === 'stay_booking' && item.stayPhase === 'reschedule' && portal === 'owner') {
    return `/owner/bookings?tab=daily&focus=${encodeURIComponent(item.id)}`;
  }
  if (item.kind === 'stay_booking') {
    return `${base}?section=bookings&focus=${encodeURIComponent(item.id)}`;
  }
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
  if (item.kind === 'legal_message') {
    const count = item.unread ?? 1;
    if (ar)
      return count > 1 ? `قضية — ${count} رسائل وتحديثات جديدة` : 'قضية — رسالة أو تحديث جديد';
    return count > 1
      ? `Legal case — ${count} new messages and updates`
      : 'Legal case — new message';
  }
  if (item.kind === 'tenant_request') {
    const type = isTenantRequestType(item.requestType) ? item.requestType : 'other';
    const label = tenantRequestTypeLabel(type, ar);
    return ar ? `طلب من المستأجر — ${label}` : `Tenant request — ${label}`;
  }
  if (item.kind === 'viewing_request') {
    return ar ? 'طلب معاينة بانتظار تحديد الموعد' : 'Viewing request awaiting a schedule';
  }
  if (item.kind === 'stay_booking') {
    if (item.stayPhase === 'reschedule') {
      return ar ? 'تعديل تواريخ بانتظار اعتمادك' : 'Date change awaiting your approval';
    }
    if (item.stayPhase === 'confirmed') {
      return ar ? 'حجز إقامة جديد مؤكد' : 'New stay booking confirmed';
    }
    return ar ? 'طلب حجز بانتظار الاعتماد' : 'Booking request awaiting approval';
  }
  if (item.kind === 'lease_reservation') {
    const sale = item.contractType === 'sale';
    const kind = sale ? (ar ? 'حجز شراء' : 'Purchase booking') : ar ? 'حجز إيجار' : 'Rent booking';
    if (item.verifyDocuments) {
      return ar
        ? `${kind} — مستندات قُبلت إلكترونياً، تحقّق منها`
        : `${kind} — documents accepted electronically, verify them`;
    }
    switch (item.phase) {
      case 'awaiting_payment_review':
        return ar ? `${kind} — أكّد استلام العربون` : `${kind} — confirm the deposit arrived`;
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
    return ar
      ? 'معاملة تحويل استرداد (الحسابات)'
      : 'Refund transfer to make (Accounting)';
  }
  if (item.kind === 'deposit_claim') {
    return ar
      ? 'بلاغ ضيف: لم يصل مبلغ التأمين (تحقق المحاسب في الحسابات)'
      : 'Guest report: deposit not received (accountant check in Accounting)';
  }
  if (item.kind === 'deposit_complaint') {
    return ar ? 'شكوى تأمين لدى إدارة الموقع' : 'Deposit complaint for the site administration';
  }
  if (item.kind === 'guest_review') {
    return ar ? 'غادر الضيف — قيّم الضيف الآن' : 'Guest departed — rate the guest';
  }
  if (item.kind === 'sale_decision') {
    if (item.decision === 'hide_sold') {
      return ar ? 'بيعت الوحدة — هل تخفيها من العقارات؟' : 'Unit sold — hide it from the listings?';
    }
    if (item.decision === 'hide_leased') {
      return ar
        ? 'أُجّرت الوحدة بعقد طويل — هل تخفيها من العقارات؟'
        : 'Unit leased — hide it from the listings?';
    }
    return ar
      ? 'تم تأجير الوحدة — هل ما زلت تريد بيعها؟'
      : 'Unit leased — do you still want to sell it?';
  }
  if (item.contractType === 'sale') {
    return ar ? 'عقد بيع بانتظار اعتمادك' : 'Sale contract awaiting your approval';
  }
  return ar ? 'عقد إيجار بانتظار اعتمادك' : 'Lease contract awaiting your approval';
}
