import { NextResponse } from 'next/server';
import { canReadAccounting } from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { loadAccountingIntegrityBoard } from '@/lib/accounting-integrity-board-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/owner/accounting/integrity — GL gaps: unposted sources and AR variance. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!canReadAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    return NextResponse.json(await loadAccountingIntegrityBoard(claims), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/integrity');
  }
}
