import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { listPublishedStayReviewsForProperty } from '@/lib/stay-reviews-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/public/stays/reviews?propertyId= */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: 'db_unconfigured', data: [] }, { status: 503 });
  }
  const propertyId = new URL(request.url).searchParams.get('propertyId');
  if (!propertyId || !z.string().uuid().safeParse(propertyId).success) {
    return NextResponse.json({ error: 'invalid_query', data: [] }, { status: 400 });
  }
  try {
    const data = await listPublishedStayReviewsForProperty(propertyId);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('[stay-reviews] GET failed', error);
    return NextResponse.json({ error: 'stay_reviews_failed', data: [] }, { status: 500 });
  }
}

const postSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(200).optional().nullable(),
  body: z.string().trim().max(4000).optional().nullable(),
  prosText: z.string().trim().max(4000).optional().nullable(),
  consText: z.string().trim().max(4000).optional().nullable(),
  cleanliness: z.number().int().min(1).max(5).optional().nullable(),
  locationScore: z.number().int().min(1).max(5).optional().nullable(),
  valueScore: z.number().int().min(1).max(5).optional().nullable(),
  communication: z.number().int().min(1).max(5).optional().nullable(),
  accuracy: z.number().int().min(1).max(5).optional().nullable(),
  checkInScore: z.number().int().min(1).max(5).optional().nullable(),
});

/** POST /api/public/stays/reviews — verified guest review after checkout. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  const { guardErrorResponse, requireLiveSession } = await import('@/lib/next-route-guard');
  const { assertRouteRateLimit, clientIp, hashRateKey } = await import('@/lib/route-rate-limit');
  const { submitStayReview } = await import('@/lib/stay-reviews-neon');

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  try {
    assertRouteRateLimit({
      key: hashRateKey(['stay-review', claims.sub, clientIp(request)]),
      limit: 20,
      windowMs: 60_000,
    });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const created = await submitStayReview(claims.sub, {
      bookingId: parsed.data.bookingId,
      rating: parsed.data.rating,
      title: parsed.data.title ?? null,
      body: parsed.data.body ?? null,
      prosText: parsed.data.prosText ?? null,
      consText: parsed.data.consText ?? null,
      cleanliness: parsed.data.cleanliness ?? null,
      locationScore: parsed.data.locationScore ?? null,
      valueScore: parsed.data.valueScore ?? null,
      communication: parsed.data.communication ?? null,
      accuracy: parsed.data.accuracy ?? null,
      checkInScore: parsed.data.checkInScore ?? null,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'stay_review_failed';
    const status =
      code === 'stay_review_forbidden'
        ? 403
        : code === 'stay_review_not_eligible'
          ? 409
          : code === 'stay_review_exists'
            ? 409
            : 500;
    return NextResponse.json(
      {
        error: {
          code,
          message:
            code === 'stay_review_not_eligible'
              ? 'Stay is not eligible for review yet'
              : code === 'stay_review_exists'
                ? 'Review already submitted'
                : 'Could not save review',
          messageAr:
            code === 'stay_review_not_eligible'
              ? 'الإقامة غير مؤهلة للتقييم بعد'
              : code === 'stay_review_exists'
                ? 'تم إرسال تقييم لهذا الحجز مسبقاً'
                : 'تعذّر حفظ التقييم',
        },
      },
      { status },
    );
  }
}
