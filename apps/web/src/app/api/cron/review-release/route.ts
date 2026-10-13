import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { announceReleasedReviews } from '@/lib/review-release-neon';
import { assertCronAuthorized } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vercel Cron: announce reviews released with time — the deposit counted as received after a
 * day without an answer, or 14 days without the other side's review.
 * Requires CRON_SECRET (fail-closed) — Vercel sends Authorization: Bearer <CRON_SECRET>.
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
    const announced = await announceReleasedReviews(
      { oidcToken: request.headers.get('x-vercel-oidc-token') },
      { limit: 15 },
    );
    return NextResponse.json({ ok: true, announced, ms: Date.now() - started });
  } catch (error) {
    console.error('[cron/review-release]', error);
    return NextResponse.json(
      { ok: false, error: 'release_failed', ms: Date.now() - started },
      { status: 503 },
    );
  }
}
