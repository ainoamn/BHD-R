import { NextResponse } from 'next/server';
import { canReadAccounting } from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { listAccountingDimensions } from '@/lib/accounting-ops-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/** GET properties + units for expense/income/trading dimension pickers. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!canReadAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    return NextResponse.json(await listAccountingDimensions(claims), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/dimensions');
  }
}
