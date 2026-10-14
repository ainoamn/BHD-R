import { NextResponse } from 'next/server';
import { loadApprovalsHub } from '@/lib/approvals-hub-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { RouteGuardError, guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const NO_STORE = { 'cache-control': 'private, no-store' };

/**
 * GET /api/portal/approvals — the approvals hub: everything awaiting the viewer's decision,
 * approval requests, and the register of online signatures with their serials.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request, { anyPermission: ['approval.read'] });
    return NextResponse.json(await loadApprovalsHub(claims), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RouteGuardError) {
      const mapped = guardErrorResponse(error);
      return NextResponse.json(mapped.body, { status: mapped.status, headers: NO_STORE });
    }
    console.error('GET /api/portal/approvals failed', error);
    return NextResponse.json(
      { error: { code: 'load_failed' } },
      { status: 500, headers: NO_STORE },
    );
  }
}
