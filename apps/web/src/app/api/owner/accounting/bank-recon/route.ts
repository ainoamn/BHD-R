import { NextResponse } from 'next/server';
import { canManageAccounting, canReadAccounting } from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import {
  completeBankReconciliation,
  listBankReconciliations,
  listUnreconciledBankLines,
} from '@/lib/accounting-standards-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 25;

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
    const currency = url.searchParams.get('currency') ?? 'OMR';
    const accountCode = url.searchParams.get('accountCode') ?? '1100';
    const [sessions, open] = await Promise.all([
      listBankReconciliations(claims),
      listUnreconciledBankLines(claims, accountCode, currency),
    ]);
    return NextResponse.json(
      { sessions, open },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/bank-recon');
  }
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    if (!canManageAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    const body = (await request.json().catch(() => null)) as {
      statementOn?: string;
      statementBalanceMinor?: string;
      currency?: string;
      accountCode?: string;
      lineIds?: string[];
      notes?: string;
    } | null;
    if (!body?.statementOn || !body.statementBalanceMinor || !Array.isArray(body.lineIds)) {
      return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
    }
    return NextResponse.json({
      reconciliation: await completeBankReconciliation(claims, {
        statementOn: body.statementOn,
        statementBalanceMinor: body.statementBalanceMinor,
        lineIds: body.lineIds,
        ...(body.currency ? { currency: body.currency } : {}),
        ...(body.accountCode ? { accountCode: body.accountCode } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
      }),
    });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/bank-recon');
  }
}
