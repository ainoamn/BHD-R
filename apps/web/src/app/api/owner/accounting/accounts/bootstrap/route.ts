import { NextResponse } from 'next/server';
import { bootstrapChartOfAccounts, canManageAccounting } from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/** POST /api/owner/accounting/accounts/bootstrap — seed the IFRS property chart. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!canManageAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    const accounts = await bootstrapChartOfAccounts(claims);
    return NextResponse.json({ accounts });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/accounts/bootstrap');
  }
}
