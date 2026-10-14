import 'server-only';
import { NextResponse } from 'next/server';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { RouteGuardError, guardErrorResponse } from '@/lib/next-route-guard';

export function contactJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('cache-control', 'private, no-store');
  return response;
}

export function contactErrorResponse(error: unknown, fallback = 'request_failed') {
  if (error instanceof RouteGuardError) {
    const mapped = guardErrorResponse(error);
    return contactJson(mapped.body, { status: mapped.status });
  }
  const code = clientSafeErrorCode(error, fallback);
  if (code === fallback) console.error('contact route failed', error);
  return contactJson({ error: { code } }, { status: statusForSafeCode(code) });
}
