import { NextResponse } from 'next/server';
import { canManageAccounting, canReadAccounting } from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { parseChequeImportCsv } from '@/lib/accounting-ops';
import {
  applyChequeOperation,
  confirmChequeCollected,
  importAccountingCheques,
  listAccountingCheques,
} from '@/lib/accounting-ops-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET tenant cheques with PDC register status, dates, and recent operations. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!canReadAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    const payload = await listAccountingCheques(claims);
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/cheques');
  }
}

/**
 * POST { id, operation, occurredOn?, dueOn?, bounceReason?, notes?, bankChargeMinor? }
 * runs a strict register step, or CSV import { csv } / { rows }.
 * Legacy { confirmId } still maps to collect.
 */
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
      confirmId?: string;
      id?: string;
      operation?: string;
      occurredOn?: string;
      dueOn?: string;
      bounceReason?: string;
      notes?: string;
      bankChargeMinor?: string;
      csv?: string;
      rows?: Array<{
        chequeNumber: string;
        bankName: string;
        amountMinor: string;
        currency?: string;
        dueOn: string;
        leaseId?: string;
        tenantPartyId?: string;
      }>;
    } | null;
    if (body?.id && body.operation) {
      return NextResponse.json(
        await applyChequeOperation(claims, body.id, body.operation, {
          ...(body.occurredOn !== undefined ? { occurredOn: body.occurredOn } : {}),
          ...(body.dueOn !== undefined ? { dueOn: body.dueOn } : {}),
          ...(body.bounceReason !== undefined ? { bounceReason: body.bounceReason } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.bankChargeMinor !== undefined
            ? { bankChargeMinor: body.bankChargeMinor }
            : {}),
        }),
      );
    }
    if (body?.confirmId) {
      return NextResponse.json(await confirmChequeCollected(claims, body.confirmId));
    }
    const rows = body?.rows?.length
      ? body.rows
      : typeof body?.csv === 'string'
        ? parseChequeImportCsv(body.csv)
        : [];
    if (!rows.length) {
      return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
    }
    const result = await importAccountingCheques(claims, rows);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/cheques');
  }
}
