import { NextResponse } from 'next/server';
import {
  canManageAccounting,
  canReadAccounting,
  listFiscalPeriods,
  setFiscalPeriodLock,
} from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!canReadAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    return NextResponse.json(
      { periods: await listFiscalPeriods(claims) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/periods');
  }
}

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!canManageAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    const body = (await request.json().catch(() => null)) as {
      from?: string;
      to?: string;
      lock?: boolean;
      note?: string;
    } | null;
    if (!body?.from || !body.to || typeof body.lock !== 'boolean') {
      return NextResponse.json({ error: { code: 'invalid_date' } }, { status: 400 });
    }
    return NextResponse.json({
      period: await setFiscalPeriodLock(claims, {
        from: body.from,
        to: body.to,
        lock: body.lock,
        ...(body.note ? { note: body.note } : {}),
      }),
    });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/periods');
  }
}
