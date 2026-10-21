import type { DepositRefundStatus } from '@/lib/stay-deposit-refund';

export type StayBookingPaymentKind = 'booking' | 'reschedule_topup' | 'deposit' | 'other';

export function stayPaymentKindLabel(kind: StayBookingPaymentKind, ar: boolean): string {
  switch (kind) {
    case 'reschedule_topup':
      return ar ? 'فرق تعديل التواريخ' : 'Date-change top-up';
    case 'deposit':
      return ar ? 'مبلغ التأمين' : 'Security deposit';
    case 'booking':
      return ar ? 'دفعة الحجز' : 'Booking payment';
    default:
      return ar ? 'دفعة' : 'Payment';
  }
}

/** Tenant-facing phase of a stay deposit refund (partial is derived, not a DB status). */
export type TenantDepositRefundPhase =
  | 'requested'
  | 'approved_processing'
  | 'partial'
  | 'transferred'
  | 'rejected';

export function tenantDepositRefundPhase(refund: {
  status: DepositRefundStatus;
  amountMinor: string;
  paidMinor: string;
}): TenantDepositRefundPhase {
  if (refund.status === 'rejected') return 'rejected';
  if (refund.status === 'executed') return 'transferred';
  if (refund.status === 'requested') return 'requested';
  const paid = BigInt(refund.paidMinor || '0');
  const amount = BigInt(refund.amountMinor || '0');
  if (paid > 0n && paid < amount) return 'partial';
  if (paid > 0n && paid >= amount) return 'transferred';
  return 'approved_processing';
}

export function tenantDepositRefundStatusLabel(phase: TenantDepositRefundPhase, ar: boolean): string {
  switch (phase) {
    case 'requested':
      return ar ? 'طلب استرداد التأمين قيد المراجعة' : 'Deposit refund under review';
    case 'approved_processing':
      return ar
        ? 'تمت الموافقة على استرجاع مبلغ التأمين · جاري تخليص الإجراءات'
        : 'Deposit refund approved · processing transfer';
    case 'partial':
      return ar ? 'تم التحويل الجزئي' : 'Partially transferred';
    case 'transferred':
      return ar ? 'تم التحويل' : 'Transferred';
    case 'rejected':
      return ar ? 'رفض التحويل' : 'Transfer declined';
  }
}

export function tenantDepositRefundStatusTone(
  phase: TenantDepositRefundPhase,
): 'action' | 'good' | 'danger' | undefined {
  switch (phase) {
    case 'rejected':
      return 'danger';
    case 'transferred':
      return 'good';
    case 'requested':
    case 'approved_processing':
    case 'partial':
      return 'action';
  }
}

export function stayPaymentMethodLabel(provider: string, ar: boolean): string {
  switch (provider) {
    case 'sandbox':
    case 'sandbox_card':
      return ar ? 'بطاقة تجريبية (Sandbox)' : 'Sandbox card';
    case 'card':
      return ar ? 'بطاقة بنكية' : 'Bank card';
    case 'offline':
      return ar ? 'خارج المنصة' : 'Offline';
    default:
      return provider || (ar ? 'غير محدد' : 'Unknown');
  }
}
