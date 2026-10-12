import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { canReadDepositLedger, loadDepositLedgerForViewer } from '@/lib/stay-deposit-ledger-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/**
 * GET /api/owner/accounting/deposits
 * Stay deposits held in trust, their refunds and the kept deductions (property income), for the
 * accountant page. Accountants, refund approvers and booking managers; owners see their own.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!claims.organizationId || !canReadDepositLedger(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    return NextResponse.json(await loadDepositLedgerForViewer(claims), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    if (mapped.status >= 500) console.error('GET /api/owner/accounting/deposits', error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
