import { NextResponse } from 'next/server';
import { canPostAccounting, postJournal } from '@/lib/accounting-gl-neon';
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
    const { id } = await params;
    return NextResponse.json({ journal: await postJournal(claims, id) });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/journals/[id]/post');
  }
}
