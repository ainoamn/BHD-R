import { NextResponse } from 'next/server';
import { canManageAccounting } from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { createOpsEntry, type OpsEntryKind } from '@/lib/accounting-ops-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const KINDS = new Set<OpsEntryKind>(['income', 'purchase', 'sale']);

/** POST income / purchase / sale → balanced journal with optional property/unit. */
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
      kind?: string;
      description?: string;
      amountMinor?: string;
      currency?: string;
      occurredOn?: string;
      method?: string;
      propertyId?: string;
      unitId?: string;
      partyId?: string;
    } | null;
    if (
      !body?.kind ||
      !KINDS.has(body.kind as OpsEntryKind) ||
      !body.description ||
      !body.amountMinor ||
      !body.occurredOn
    ) {
      return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
    }
    const result = await createOpsEntry(claims, {
      kind: body.kind as OpsEntryKind,
      description: body.description,
      amountMinor: body.amountMinor,
      occurredOn: body.occurredOn,
      ...(body.currency ? { currency: body.currency } : {}),
      ...(body.method ? { method: body.method } : {}),
      ...(body.propertyId ? { propertyId: body.propertyId } : {}),
      ...(body.unitId ? { unitId: body.unitId } : {}),
      ...(body.partyId ? { partyId: body.partyId } : {}),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/ops');
  }
}
