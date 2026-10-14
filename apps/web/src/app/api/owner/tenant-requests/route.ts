import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { canRecordTenantPayments } from '@/lib/tenant-charges-neon';
import { canHandleTenantRequests, listOwnerTenantRequests } from '@/lib/tenant-requests-neon';
import { isTenantRequestType } from '@/lib/tenant-requests-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/owner/tenant-requests?type=maintenance — requests tenants sent the organization (one
 * type when asked), for the maintenance board and other owner pages that load on the client.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  if (!canHandleTenantRequests(claims)) {
    return NextResponse.json(
      { requests: [], allowed: false, canRecordPayments: false },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  }
  const type = new URL(request.url).searchParams.get('type');
  try {
    const requests = await listOwnerTenantRequests(
      claims,
      isTenantRequestType(type) ? { type } : {},
    );
    return NextResponse.json(
      { requests, allowed: true, canRecordPayments: canRecordTenantPayments(claims) },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    const code = clientSafeErrorCode(error, 'load_failed');
    if (code === 'load_failed') console.error('GET /api/owner/tenant-requests', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
