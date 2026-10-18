import { NextResponse } from 'next/server';
import { canPostAccounting, reverseJournal } from '@/lib/accounting-gl-neon';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!canPostAccounting(claims)) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    const body = (await request.json().catch(() => null)) as {
      occurredOn?: string;
      note?: string;
    } | null;
    if (!body?.occurredOn) {
      return NextResponse.json({ error: { code: 'invalid_date' } }, { status: 400 });
    }
    const { id } = await params;
    return NextResponse.json({
      journal: await reverseJournal(claims, id, body.occurredOn, body.note),
    });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/journals/[id]/reverse');
  }
}
