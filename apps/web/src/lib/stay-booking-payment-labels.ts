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

/** Broad bucket for tenant payments UI: rent/booking vs security deposit. */
export function tenantPaymentCategory(
  stayKind: StayBookingPaymentKind | null | undefined,
): 'rent' | 'deposit' {
  return stayKind === 'deposit' ? 'deposit' : 'rent';
}

export function tenantPaymentCategoryLabel(
  stayKind: StayBookingPaymentKind | null | undefined,
  ar: boolean,
): string {
  if (stayKind === 'deposit') return ar ? 'ضمان' : 'Deposit';
  if (stayKind === 'booking') return ar ? 'إيجار / حجز' : 'Rent / booking';
  if (stayKind === 'reschedule_topup') return ar ? 'إيجار (تعديل)' : 'Rent (date change)';
  return ar ? 'إيجار' : 'Rent';
}

export function tenantPaymentHoldStatus(
  input: {
    stayKind?: StayBookingPaymentKind | null;
    amountMinor: string;
    refundedMinor: string;
    depositRefund?: {
      status: DepositRefundStatus;
      amountMinor: string;
      paidMinor: string;
      guestReceipt?: 'confirmed' | 'not_received' | null;
    } | null;
  },
  ar: boolean,
): { label: string; tone: 'action' | 'good' | 'danger' | 'info' | 'quiet' } {
  const amount = BigInt(input.amountMinor || '0');
  const refunded = BigInt(input.refundedMinor || '0');
  if (input.stayKind === 'deposit') {
    if (input.depositRefund) {
      const phase = tenantDepositRefundPhase(input.depositRefund);
      if (phase === 'transferred') {
        return { label: ar ? 'ضمان · تم الإرجاع' : 'Deposit · refunded', tone: 'good' };
      }
      if (phase === 'partial') {
        return { label: ar ? 'ضمان · إرجاع جزئي' : 'Deposit · partial refund', tone: 'action' };
      }
      if (phase === 'rejected') {
        return { label: ar ? 'ضمان · محجوز' : 'Deposit · held', tone: 'info' };
      }
      if (phase === 'not_received') {
        return {
          label: ar ? 'ضمان · لم يصل الإرجاع' : 'Deposit · refund not received',
          tone: 'danger',
        };
      }
      return { label: ar ? 'ضمان · قيد الإرجاع' : 'Deposit · refund in progress', tone: 'action' };
    }
    if (refunded > 0n && refunded < amount) {
      return { label: ar ? 'ضمان · إرجاع جزئي' : 'Deposit · partial refund', tone: 'action' };
    }
    if (refunded >= amount && amount > 0n) {
      return { label: ar ? 'ضمان · تم الإرجاع' : 'Deposit · refunded', tone: 'good' };
    }
    return { label: ar ? 'ضمان · محجوز' : 'Deposit · held', tone: 'info' };
  }
  if (refunded >= amount && amount > 0n) {
    return { label: ar ? 'إيجار · تم الإرجاع' : 'Rent · refunded', tone: 'good' };
  }
  if (refunded > 0n) {
    return { label: ar ? 'إيجار · إرجاع جزئي' : 'Rent · partially refunded', tone: 'action' };
  }
  return { label: ar ? 'إيجار · مدفوع' : 'Rent · paid', tone: 'good' };
}

/** Tenant-facing phase of a stay deposit refund (partial / dispute are derived). */
export type TenantDepositRefundPhase =
  | 'requested'
  | 'approved_processing'
  | 'partial'
  | 'transferred'
  | 'not_received'
  | 'rejected';

export function tenantDepositRefundPhase(refund: {
  status: DepositRefundStatus;
  amountMinor: string;
  paidMinor: string;
  guestReceipt?: 'confirmed' | 'not_received' | null;
}): TenantDepositRefundPhase {
  if (refund.status === 'rejected') return 'rejected';
  if (refund.status === 'executed' && refund.guestReceipt === 'not_received') return 'not_received';
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
    case 'not_received':
      return ar ? 'مهمة: لم يصل مبلغ التأمين · قيد المتابعة' : 'Task: deposit not received · in progress';
    case 'rejected':
      return ar ? 'رفض التحويل' : 'Transfer declined';
  }
}

export function tenantDepositRefundStatusTone(
  phase: TenantDepositRefundPhase,
): 'action' | 'good' | 'danger' | undefined {
  switch (phase) {
    case 'rejected':
    case 'not_received':
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
