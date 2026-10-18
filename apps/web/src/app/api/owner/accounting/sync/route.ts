import { NextResponse } from 'next/server';
import { canManageAccounting, canPostAccounting, syncOperationalGl } from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/owner/accounting/sync — bootstrap CoA and post historical stay/reservation
 * money into balanced journals (idempotent).
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!canManageAccounting(claims) && !canPostAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    return NextResponse.json(await syncOperationalGl(claims), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/sync');
  }
}
