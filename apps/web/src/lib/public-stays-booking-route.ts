import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { PublicStayBookingError } from '@/lib/public-stays-booking-neon';

export function stayBookingJson(data: unknown, init?: ResponseInit) {
  return new NextResponse(
    JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json; charset=utf-8', ...(init?.headers ?? {}) },
    },
  );
}

export function stayBookingDbGuard() {
  if (!hasDatabaseUrl()) {
    return stayBookingJson(
      {
        error: {
          code: 'db_unconfigured',
          messageAr: 'قاعدة البيانات غير مهيّأة.',
          message: 'Database is not configured.',
        },
      },
      { status: 503 },
    );
  }
  return null;
}

export function stayBookingErrorResponse(error: unknown) {
  if (error instanceof PublicStayBookingError) {
    const arMessages: Record<string, string> = {
      not_found: 'مسار الإقامات غير متاح.',
      guests_exceed_max: 'عدد الضيوف يتجاوز الحد الأقصى.',
      nights_out_of_range: 'مدة الإقامة خارج النطاق المسموح.',
      dates_unavailable: 'التواريخ غير متاحة — جرّب تواريخاً أخرى.',
      quote_not_found: 'عرض السعر غير موجود.',
      quote_expired: 'انتهت صلاحية عرض السعر.',
      hold_not_found: 'الحجز المؤقت غير موجود.',
      hold_inactive: 'انتهت صلاحية الحجز المؤقت.',
      lock_failed: 'تعذّر حجز التواريخ مؤقتاً.',
    };
    return stayBookingJson(
      {
        error: {
          code: error.code,
          message: error.message,
          messageAr: arMessages[error.code] ?? 'تعذّر إكمال الحجز.',
        },
      },
      { status: error.status },
    );
  }
  console.error('[public-stays-booking]', error);
  return stayBookingJson(
    {
      error: {
        code: 'booking_failed',
        message: 'Stay booking failed',
        messageAr: 'تعذّر إكمال الحجز. أعد المحاولة.',
      },
    },
    { status: 500 },
  );
}
