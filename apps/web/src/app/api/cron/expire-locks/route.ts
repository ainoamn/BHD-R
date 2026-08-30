import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { createDatabase } from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Vercel Cron: expire timed-out holds and reservations globally.
 * Requires CRON_SECRET (fail-closed) — Vercel sends Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) {
    return NextResponse.json({ ok: false, error: 'cron_unconfigured' }, { status: 503 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ ok: false, error: 'db_unconfigured' }, { status: 503 });
  }

  const started = Date.now();
  try {
    const { db } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
    const result = await db.transaction(async (transaction) => {
      await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
      await transaction.execute(sql`
        update holds
        set status = 'expired', updated_at = now()
        where status = 'active' and expires_at <= now()
      `);
      await transaction.execute(sql`
        update reservations
        set status = 'expired', updated_at = now()
        where status in ('pending', 'confirmed') and expires_at <= now()
      `);
      return { expired: true as const };
    });
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - started });
  } catch (error) {
    console.error('[cron/expire-locks]', error);
    return NextResponse.json(
      { ok: false, error: 'expire_failed', ms: Date.now() - started },
      { status: 503 },
    );
  }
}
