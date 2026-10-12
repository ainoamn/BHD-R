import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { claimErrorBody } from '@/lib/stay-deposit-claims';
import { listDepositComplaints } from '@/lib/stay-deposit-claims-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/site-admin/complaints — guests' deposit complaints escalated to the site administration. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    return NextResponse.json(
      { complaints: await listDepositComplaints(claims) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'forbidden') {
      const failed = claimErrorBody('forbidden');
      return NextResponse.json(failed.body, { status: failed.status });
    }
    const mapped = guardErrorResponse(error);
    if (mapped.status >= 500) console.error('GET /api/site-admin/complaints', error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
