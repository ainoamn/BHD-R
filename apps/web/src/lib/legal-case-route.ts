import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { RouteGuardError, guardErrorResponse } from '@/lib/next-route-guard';

export function legalJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('cache-control', 'private, no-store');
  return response;
}

export function legalErrorResponse(error: unknown, fallback = 'request_failed') {
  if (error instanceof RouteGuardError) {
    const mapped = guardErrorResponse(error);
    return legalJson(mapped.body, { status: mapped.status });
  }
  const code = clientSafeErrorCode(error, fallback);
  if (code === fallback) console.error('legal case route failed', error);
  return legalJson({ error: { code } }, { status: statusForSafeCode(code) });
}

export async function legalCaseId(params: Promise<{ caseId: string }>): Promise<string | null> {
  const { caseId } = await params;
  return z.string().uuid().safeParse(caseId).success ? caseId : null;
}
