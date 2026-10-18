import { NextResponse } from 'next/server';
import {
  canManageAccounting,
  canReadAccounting,
  createExpenseGl,
  listExpensesGl,
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
      { expenses: await listExpensesGl(claims) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/expenses');
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
      category?: string;
      description?: string;
      amountMinor?: string;
      taxMinor?: string;
      currency?: string;
      issuedOn?: string;
      dueOn?: string;
      propertyId?: string;
      unitId?: string;
      partyId?: string;
      notes?: string;
    } | null;
    if (!body?.category || !body.description || !body.amountMinor || !body.issuedOn) {
      return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
    }
    const expense = await createExpenseGl(claims, {
      category: body.category,
      description: body.description,
      amountMinor: body.amountMinor,
      currency: body.currency ?? 'OMR',
      issuedOn: body.issuedOn,
      ...(body.taxMinor ? { taxMinor: body.taxMinor } : {}),
      ...(body.dueOn ? { dueOn: body.dueOn } : {}),
      ...(body.propertyId ? { propertyId: body.propertyId } : {}),
      ...(body.unitId ? { unitId: body.unitId } : {}),
      ...(body.partyId ? { partyId: body.partyId } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
    });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/expenses');
  }
}
