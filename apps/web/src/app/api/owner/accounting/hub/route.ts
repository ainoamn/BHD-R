import { NextResponse } from 'next/server';
import { accountingDashboard, canReadAccounting } from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/** GET /api/owner/accounting/hub — KPIs for the accounting dashboard. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!canReadAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    return NextResponse.json(await accountingDashboard(claims), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/hub');
  }
}
