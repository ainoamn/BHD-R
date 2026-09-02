import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { listPendingStayReviewsForUser } from '@/lib/stay-reviews-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/public/stays/reviews/pending — bookings awaiting guest review. */
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
    const data = await listPendingStayReviewsForUser(claims.sub);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('[stay-reviews] pending failed', error);
    return NextResponse.json({ error: 'pending_failed', data: [] }, { status: 500 });
  }
}
