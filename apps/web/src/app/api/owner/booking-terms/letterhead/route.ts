import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { TERMS_LOGO_MAX_CHARS, TERMS_LOGO_PATTERN } from '@/lib/booking-terms';
import { saveTermsLetterhead } from '@/lib/booking-terms-neon';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    nameAr: z.string().max(160),
    nameEn: z.string().max(160),
    logoDataUrl: z.string().max(TERMS_LOGO_MAX_CHARS).regex(TERMS_LOGO_PATTERN).nullable(),
    addressAr: z.string().max(400),
    addressEn: z.string().max(400),
    phone: z.string().max(40),
    email: z.string().max(160),
    registrationNumber: z.string().max(60),
  })
  .strict();

/** PUT the company letterhead (logo, name, address) printed with the terms and conditions. */
export async function PUT(request: Request) {
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
    key: hashRateKey(['owner-terms-letterhead', claims.sub, clientIp(request)]),
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    return NextResponse.json(await saveTermsLetterhead(claims, body));
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
