import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { runLeaseAutoRenewals } from '@/lib/lease-renewal-automation-neon';
import { assertCronAuthorized } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Daily: create & deliver renewal addenda for leases inside the automation lead window. */
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
    const result = await runLeaseAutoRenewals(started + 50_000);
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - started });
  } catch (error) {
    console.error('cron lease-auto-renewals', error);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
