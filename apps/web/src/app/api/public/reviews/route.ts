import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import {
  getReviewSummary,
  listPublishedReviews,
  upsertReview,
  type ReviewTargetType,
} from '@/lib/reviews';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const targetTypeSchema = z.enum(['property', 'party', 'organization']);

export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: 'db_unconfigured' }, { status: 503 });
  }
  const url = new URL(request.url);
  const targetType = targetTypeSchema.safeParse(url.searchParams.get('targetType'));
  const targetId = url.searchParams.get('targetId');
  if (!targetType.success || !targetId || !z.string().uuid().safeParse(targetId).success) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }

  try {
    const [summary, items] = await Promise.all([
      getReviewSummary(targetType.data, targetId),
      listPublishedReviews(targetType.data, targetId),
    ]);
    return NextResponse.json({ summary, data: items });
  } catch (error) {
    console.error('[reviews] GET failed', error);
    return NextResponse.json({ error: 'reviews_failed', summary: { avgRating: null, reviewCount: 0, verifiedCount: 0 }, data: [] }, { status: 500 });
  }
}

const postSchema = z.object({
  targetType: targetTypeSchema,
  targetId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(2000).optional().nullable(),
});

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['review', claims.sub, clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const review = await upsertReview({
      targetType: body.targetType as ReviewTargetType,
      targetId: body.targetId,
      authorUserId: claims.sub,
      authorPartyId: claims.partyId ?? null,
      rating: body.rating,
      body: body.body ?? null,
    });
    const summary = await getReviewSummary(body.targetType, body.targetId);
    return NextResponse.json({ review, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'review_failed';
    const code = message === 'target_not_found' ? 'target_not_found' : 'review_failed';
    return NextResponse.json({ error: { code } }, { status: code === 'target_not_found' ? 404 : 500 });
  }
}
