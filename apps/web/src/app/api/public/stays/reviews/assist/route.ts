import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { draftStayReviewCopy } from '@/lib/stay-reviews-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  locale: z.enum(['ar', 'en']).default('ar'),
  rating: z.number().int().min(1).max(5),
  propertyName: z.string().trim().min(1).max(200),
  cleanliness: z.number().int().min(1).max(5).optional().nullable(),
  locationScore: z.number().int().min(1).max(5).optional().nullable(),
  valueScore: z.number().int().min(1).max(5).optional().nullable(),
  communication: z.number().int().min(1).max(5).optional().nullable(),
  keywords: z.string().trim().max(400).optional(),
});

/** POST /api/public/stays/reviews/assist — AI-style draft from scores + keywords. */
export async function POST(request: Request) {
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  try {
    assertRouteRateLimit({
      key: hashRateKey(['stay-review-assist', claims.sub, clientIp(request)]),
      limit: 30,
      windowMs: 60_000,
    });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const json = await request.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  return NextResponse.json(
    draftStayReviewCopy({
      locale: parsed.data.locale,
      rating: parsed.data.rating,
      propertyName: parsed.data.propertyName,
      cleanliness: parsed.data.cleanliness ?? null,
      locationScore: parsed.data.locationScore ?? null,
      valueScore: parsed.data.valueScore ?? null,
      communication: parsed.data.communication ?? null,
      ...(parsed.data.keywords ? { keywords: parsed.data.keywords } : {}),
    }),
  );
}
