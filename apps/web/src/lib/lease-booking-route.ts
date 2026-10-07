import 'server-only';
import { NextResponse } from 'next/server';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { RouteGuardError, guardErrorResponse } from '@/lib/next-route-guard';
import { LeaseBookingError } from '@/lib/public-lease-booking-neon';

function postgresCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function leaseBookingJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('cache-control', 'no-store');
  return response;
}

export function leaseBookingErrorResponse(error: unknown, fallback = 'booking_failed') {
  if (error instanceof LeaseBookingError) {
    return leaseBookingJson(
      { error: { code: error.code, message: error.message, messageAr: error.messageAr } },
      { status: error.status },
    );
  }
  if (error instanceof RouteGuardError) {
    const mapped = guardErrorResponse(error);
    return leaseBookingJson(mapped.body, { status: mapped.status });
  }
  if (postgresCode(error) === '23505') {
    return leaseBookingJson(
      {
        error: {
          code: 'unit_unavailable',
          message: 'This unit was just reserved by someone else.',
          messageAr: 'تم حجز هذه الوحدة للتو من شخص آخر.',
        },
      },
      { status: 409 },
    );
  }
  const code = clientSafeErrorCode(error, fallback);
  if (code === fallback) console.error('lease booking route failed', error);
  return leaseBookingJson({ error: { code } }, { status: statusForSafeCode(code) });
}
