import { NextResponse } from 'next/server';
import type { JournalLineInput } from '@/lib/accounting-gl';
import {
  canManageAccounting,
  canReadAccounting,
  createJournal,
  listJournals,
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
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? '100');
    return NextResponse.json(
      { journals: await listJournals(claims, limit) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/journals');
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
      occurredOn?: string;
      description?: string;
      sourceType?: string;
      sourceId?: string;
      post?: boolean;
      lines?: JournalLineInput[];
    } | null;
    if (!body?.occurredOn || !body.description || !Array.isArray(body.lines)) {
      return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
    }
    const journal = await createJournal(claims, {
      occurredOn: body.occurredOn,
      description: body.description,
      lines: body.lines,
      ...(body.sourceType ? { sourceType: body.sourceType } : {}),
      ...(body.sourceId ? { sourceId: body.sourceId } : {}),
      ...(typeof body.post === 'boolean' ? { post: body.post } : {}),
    });
    return NextResponse.json({ journal }, { status: 201 });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/journals');
  }
}
