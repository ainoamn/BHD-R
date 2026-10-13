import { NextResponse, after } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadReputation, refreshReviewProfile } from '@/lib/booking-reviews-neon';
import type { ReputationSubject } from '@/lib/review-rubric';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUBJECTS = new Set<ReputationSubject>(['property', 'unit', 'host', 'guest']);

/** GET /api/public/reputation?subject=property|unit|host|guest&key=… — public verified reviews. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['public-reputation', clientIp(request)]),
    limit: 60,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json({ error: { code: 'rate_limited' } }, { status: 429 });
  }
  const url = new URL(request.url);
  const subject = url.searchParams.get('subject') as ReputationSubject | null;
  const key = url.searchParams.get('key')?.trim() ?? '';
  if (!subject || !SUBJECTS.has(subject) || !key) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }
  try {
    const loaded = await loadReputation(subject, key, subject === 'unit' ? 100 : undefined);
    if (!loaded) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    if (loaded.stale) {
      const context = { oidcToken: request.headers.get('x-vercel-oidc-token') };
      after(() =>
        refreshReviewProfile(subject, key, context).catch((error: unknown) =>
          console.error('review profile refresh', subject, error),
        ),
      );
    }
    return NextResponse.json(
      { reputation: loaded.reputation },
      { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=120' } },
    );
  } catch (error) {
    console.error('GET /api/public/reputation', error);
    return NextResponse.json({ error: { code: 'request_failed' } }, { status: 500 });
  }
}
