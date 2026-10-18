import { NextResponse } from 'next/server';
import { canReadAccounting, loadDimensionLedger } from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 25;

/**
 * GET /api/owner/accounting/ledgers?propertyId=|unitId=|partyId=
 * Analytical GL lines for a building, unit or person (tenant/owner/vendor).
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!canReadAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    const url = new URL(request.url);
    const propertyId = url.searchParams.get('propertyId') ?? undefined;
    const unitId = url.searchParams.get('unitId') ?? undefined;
    const partyId = url.searchParams.get('partyId') ?? undefined;
    const fromDate = url.searchParams.get('fromDate') ?? undefined;
    const toDate = url.searchParams.get('toDate') ?? undefined;
    if (!propertyId && !unitId && !partyId) {
      return NextResponse.json(
        { error: { code: 'invalid_input', messageAr: 'حدّد عقاراً أو وحدة أو طرفاً' } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await loadDimensionLedger(claims, {
        ...(propertyId ? { propertyId } : {}),
        ...(unitId ? { unitId } : {}),
        ...(partyId ? { partyId } : {}),
        ...(fromDate ? { fromDate } : {}),
        ...(toDate ? { toDate } : {}),
      }),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/ledgers');
  }
}
