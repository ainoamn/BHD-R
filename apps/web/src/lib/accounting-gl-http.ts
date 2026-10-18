import { NextResponse } from 'next/server';
import { guardErrorResponse } from '@/lib/next-route-guard';

const CODE_STATUS: Record<string, number> = {
  forbidden: 403,
  not_found: 404,
  unbalanced: 409,
  not_draft: 409,
  not_posted: 409,
  already_reversed: 409,
  period_locked: 409,
  account_missing: 404,
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
  period_locked: 'الفترة المالية مقفلة — لا يمكن الترحيل فيها',
  account_missing: 'أحد الحسابات غير موجود في الدليل',
  invalid_date: 'تاريخ غير صالح',
  invalid_code: 'رمز الحساب غير صالح',
  invalid_name: 'اسم الحساب قصير جداً',
  invalid_description: 'وصف القيد قصير جداً',
  invalid_amount: 'المبلغ غير صالح',
  invalid_input: 'بيانات غير مكتملة',
};

export function accountingErrorResponse(error: unknown, label: string) {
  if (error instanceof Error) {
    const code = error.message.startsWith('account_missing:') ? 'account_missing' : error.message;
    if (CODE_STATUS[code]) {
      return NextResponse.json(
        { error: { code, message: code, messageAr: CODE_AR[code] ?? code } },
        { status: CODE_STATUS[code]! },
      );
    }
  }
  const mapped = guardErrorResponse(error);
  if (mapped.status >= 500) console.error(label, error);
  return NextResponse.json(mapped.body, { status: mapped.status });
}
