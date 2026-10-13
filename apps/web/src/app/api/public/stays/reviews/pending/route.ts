import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { listPendingGuestReviews } from '@/lib/booking-reviews-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/public/stays/reviews/pending — the account's departed stays awaiting its review. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: 'db_unconfigured', data: [] }, { status: 503 });
  }
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  try {
    const data = await listPendingGuestReviews(claims.sub);
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[stay-reviews] pending failed', error);
    return NextResponse.json({ error: 'pending_failed', data: [] }, { status: 500 });
  }
}
