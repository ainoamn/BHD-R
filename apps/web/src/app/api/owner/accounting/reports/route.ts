import { NextResponse } from 'next/server';
import {
  agingReceivables,
  balanceSheet,
  canReadAccounting,
  cashFlowReport,
  incomeStatement,
  trialBalance,
} from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 25;

/** GET /api/owner/accounting/reports?report=trial|income|balance|cashflow|aging */
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
    const report = url.searchParams.get('report') ?? 'trial';
    const currency = url.searchParams.get('currency') ?? 'OMR';
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = url.searchParams.get('fromDate') ?? `${today.slice(0, 4)}-01-01`;
    const toDate = url.searchParams.get('toDate') ?? today;
    const asOfDate = url.searchParams.get('asOfDate') ?? toDate;

    if (report === 'income') {
      return NextResponse.json(await incomeStatement(claims, fromDate, toDate, currency), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    if (report === 'balance') {
      return NextResponse.json(await balanceSheet(claims, asOfDate, currency), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    if (report === 'cashflow') {
      return NextResponse.json(await cashFlowReport(claims, fromDate, toDate, currency), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    if (report === 'aging') {
      return NextResponse.json(await agingReceivables(claims, asOfDate, currency), {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }
    return NextResponse.json(
      {
        report: 'trial',
        fromDate,
        toDate: asOfDate,
        rows: await trialBalance(claims, { fromDate, toDate: asOfDate }),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/reports');
  }
}
