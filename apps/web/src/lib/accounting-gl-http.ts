import { NextResponse } from 'next/server';
import { guardErrorResponse } from '@/lib/next-route-guard';

const CODE_STATUS: Record<string, number> = {
  forbidden: 403,
  not_found: 404,
  unbalanced: 409,
  not_draft: 409,
  not_posted: 409,
  already_reversed: 409,
  already_void: 409,
  has_payments: 409,
  period_locked: 409,
  account_missing: 404,
  unpost_forbidden: 409,
  refund_confirm_required: 409,
  reason_required: 400,
  approval_required: 409,
  approval_pending: 409,
  must_reverse_first: 409,
  invalid_date: 400,
  invalid_code: 400,
  invalid_name: 400,
  invalid_description: 400,
  invalid_amount: 400,
  invalid_input: 400,
};

const CODE_AR: Record<string, string> = {
  forbidden: 'ليست لديك صلاحية المحاسبة',
  not_found: 'السجل غير موجود',
  unbalanced: 'القيد غير متوازن — مجموع المدين يجب أن يساوي مجموع الدائن',
  not_draft: 'لا يُرحَّل إلا قيد مسودة',
  not_posted: 'لا يُعكس إلا قيد مرحّل',
  already_reversed: 'هذا القيد معكوس مسبقاً',
  already_void: 'هذا السجل ملغى مسبقاً',
  has_payments: 'لا يُلغى سجل عليه مدفوعات — اعكس القيد أو سجّل استرداداً',
  period_locked: 'الفترة المالية مقفلة — لا يمكن الترحيل فيها',
  account_missing: 'أحد الحسابات غير موجود في الدليل',
  unpost_forbidden:
    'لا يُحذف ترحيل معاملة مربوطة أو إلكترونية — استخدم «تراجع» (قيد عكسي) بعد التحقق',
  refund_confirm_required:
    'المعاملات الإلكترونية لا تُعكس إلا بعد تأكيد الاسترداد أو فشل التحصيل من بوابة الدفع',
  reason_required: 'أدخل سبب العكس أو الاسترداد (ثمانية أحرف على الأقل)',
  approval_required: 'يلزم اعتماد ثانٍ قبل عكس المعاملة الإلكترونية',
  approval_pending: 'طلب الاعتماد ما زال قيد الانتظار',
  must_reverse_first: 'اعكس القيد المرحّل المرتبط أولاً ثم ألغِ السجل',
  invalid_date: 'تاريخ غير صالح',
  invalid_code: 'رمز الحساب غير صالح',
  invalid_name: 'اسم الحساب قصير جداً',
  invalid_description: 'وصف القيد قصير جداً',
  invalid_amount: 'المبلغ غير صالح',
  invalid_input: 'بيانات غير مكتملة',
};

export function accountingErrorResponse(error: unknown, label: string) {
  if (error instanceof Error) {
    let code = error.message;
    let approvalId: string | undefined;
    if (code.startsWith('account_missing:')) code = 'account_missing';
    if (code.startsWith('approval_required:')) {
      approvalId = code.slice('approval_required:'.length);
      code = 'approval_required';
    }
    if (CODE_STATUS[code]) {
      return NextResponse.json(
        {
          error: {
            code,
            message: code,
            messageAr: CODE_AR[code] ?? code,
            ...(approvalId ? { approvalId } : {}),
          },
        },
        { status: CODE_STATUS[code]! },
      );
    }
  }
  const mapped = guardErrorResponse(error);
  if (mapped.status >= 500) console.error(label, error);
  return NextResponse.json(mapped.body, { status: mapped.status });
}
