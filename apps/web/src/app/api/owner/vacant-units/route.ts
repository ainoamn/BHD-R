import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { loadOpsContextFromDb } from '@/lib/portal-ops-data';
import { guardErrorResponse, requireLiveSession, RouteGuardError } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/owner/vacant-units — fresh vacant unit list for owner invite / convert forms.
 * Uses the tab-bound product session when present so multi-account tabs do not see an empty list.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!claims.organizationId) {
      throw new RouteGuardError(403, 'forbidden');
    }
    const context = await loadOpsContextFromDb('owner', claims);
    return NextResponse.json(
      {
        vacantUnits: Array.isArray(context?.vacantUnits) ? context.vacantUnits : [],
        units: Array.isArray(context?.units) ? context.units : [],
        tenants: Array.isArray(context?.tenants)
          ? context.tenants
          : Array.isArray(context?.parties)
            ? context.parties
            : [],
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const mapped = guardErrorResponse(error);
    if (mapped.status !== 500) {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    return NextResponse.json(
      { error: { code: clientSafeErrorCode(error, 'load_failed') } },
      { status: 500 },
    );
  }
}
