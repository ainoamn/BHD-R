import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { assertCronAuthorized } from '@/lib/route-rate-limit';
import { autoEscalateOverdueDepositTracks } from '@/lib/stay-deposit-claims-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Daily: unanswered property complaints / appeals past 7 working days → site administration. */
export async function GET(request: Request) {
  const auth = assertCronAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ ok: false, error: 'db_unconfigured' }, { status: 503 });
  }
  const started = Date.now();
  try {
    const moved = await autoEscalateOverdueDepositTracks(80);
    return NextResponse.json({ ok: true, moved, ms: Date.now() - started });
  } catch (error) {
    console.error('cron deposit-claim-escalate', error);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
