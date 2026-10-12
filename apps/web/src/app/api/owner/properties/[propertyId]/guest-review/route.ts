import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { refreshReviewProfile, submitHostReview } from '@/lib/booking-reviews-neon';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { reviewFields } from '@/lib/review-route';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const uuid = z.string().uuid();
const bodySchema = z.object({ bookingId: uuid, ...reviewFields }).strict();

/** POST /api/owner/properties/:propertyId/guest-review — the host rates the guest after check-out. */
export async function POST(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-guest-review', claims.sub, clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const { propertyId } = await context.params;
  if (!uuid.safeParse(propertyId).success) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  const ai = { oidcToken: request.headers.get('x-vercel-oidc-token') };
  try {
    const saved = await submitHostReview(claims, propertyId, body.bookingId, body, ai);
    after(async () => {
      for (const [subject, key] of saved.subjects) {
        await refreshReviewProfile(subject, key, ai).catch((error: unknown) =>
          console.error('review profile refresh', subject, error),
        );
      }
    });
    return NextResponse.json({
      review: { id: saved.id, score: saved.score, criteriaScore: saved.criteriaScore },
    });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('POST /api/owner/properties/guest-review', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
