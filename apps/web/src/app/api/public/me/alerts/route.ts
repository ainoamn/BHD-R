import { NextResponse } from 'next/server';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { loadMyTenancy } from '@/lib/tenancy-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/public/me/alerts — the account's own bookings, contracts and dues (header bell). */
export async function GET(request: Request) {
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  try {
    const tenancy = await loadMyTenancy(claims.sub);
    const liveLeases = tenancy.leases.filter((lease) => !lease.fromStay);
    return NextResponse.json(
      {
        alerts: tenancy.alerts.slice(0, 12),
        stays: tenancy.stays.slice(0, 8),
        contracts: tenancy.contracts.slice(0, 6),
        counts: {
          contracts: tenancy.contracts.length,
          leases: liveLeases.length,
          invoices: tenancy.invoices.length,
          reservations: tenancy.reservations.length,
          stays: tenancy.stays.length,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('me alerts failed', error);
    return NextResponse.json({ error: { code: 'unavailable' } }, { status: 503 });
  }
}
