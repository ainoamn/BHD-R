import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { sendDailyReminders } from '@/lib/email-reminders-neon';
import { assertCronAuthorized } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Daily: rent, bill and lease reminders, and the Sunday vacancy and arrears digest
 * (`?digest=1` sends the digest on another day).
 */
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
    const result = await sendDailyReminders(started + 50_000, {
      digest: new URL(request.url).searchParams.get('digest') === '1',
    });
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - started });
  } catch (error) {
    console.error('cron tenant-reminders', error);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
