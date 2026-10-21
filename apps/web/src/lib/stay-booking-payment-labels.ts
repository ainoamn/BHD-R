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
