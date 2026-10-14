import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { dispatchQueuedEmails } from '@/lib/email-outbox';
import { assertCronAuthorized } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Safety net: emails are sent right after they are queued; this retries what is still due. */
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
    const result = await dispatchQueuedEmails({ budgetMs: 45_000 });
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - started });
  } catch (error) {
    console.error('cron send-emails', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
