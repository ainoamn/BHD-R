import { NextResponse } from 'next/server';
import type { LedgerAccountType } from '@/lib/accounting-gl';
import {
  canManageAccounting,
  canReadAccounting,
  createLedgerAccount,
  listLedgerAccounts,
} from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const TYPES = new Set<LedgerAccountType>(['asset', 'liability', 'equity', 'revenue', 'expense']);

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
      { accounts: await listLedgerAccounts(claims) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/accounts');
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
      code?: string;
      nameAr?: string;
      nameEn?: string;
      type?: string;
      parentId?: string;
      currency?: string;
    } | null;
    if (!body?.code || !body.nameAr || !body.nameEn || !TYPES.has(body.type as LedgerAccountType)) {
      return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
    }
    const account = await createLedgerAccount(claims, {
      code: body.code,
      nameAr: body.nameAr,
      nameEn: body.nameEn,
      type: body.type as LedgerAccountType,
      ...(body.parentId ? { parentId: body.parentId } : {}),
      ...(body.currency ? { currency: body.currency } : {}),
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/accounts');
  }
}
