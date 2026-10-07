import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { TERMS_MAX_BLOCKS, TERMS_MAX_CLAUSE } from '@/lib/booking-terms';
import { saveOwnerBookingTerms } from '@/lib/booking-terms-neon';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    mode: z.enum(['sale', 'rent', 'daily']),
    blocks: z
      .array(
        z
          .object({
            kind: z.enum(['heading', 'clause']),
            ar: z.string().max(TERMS_MAX_CLAUSE),
            en: z.string().max(TERMS_MAX_CLAUSE),
          })
          .strict(),
      )
      .max(TERMS_MAX_BLOCKS),
  })
  .strict();

const uuidSchema = z.string().uuid();

/** PUT owner booking terms (sale / monthly rent / daily) for one property. */
export async function PUT(request: Request, context: { params: Promise<{ propertyId: string }> }) {
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
  if (!claims.organizationId || !claims.permissions.includes('property.update')) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-booking-terms', claims.sub, clientIp(request)]),
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
  if (!uuidSchema.safeParse(propertyId).success) {
    return NextResponse.json({ error: { code: 'property_not_found' } }, { status: 404 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const result = await saveOwnerBookingTerms(claims, propertyId, body.mode, {
      blocks: body.blocks,
    });
    return NextResponse.json(result);
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
