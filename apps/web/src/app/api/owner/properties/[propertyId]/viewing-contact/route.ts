import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import {
  loadPropertyViewingContact,
  setPropertyViewingContact,
} from '@/lib/property-viewing-contact-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    contactUserId: z.string().uuid().nullable(),
    /** Required when setting a contact — saved on the staff member’s party card. */
    phone: z.string().trim().min(8).max(24).nullable().optional(),
  })
  .strict();

/** GET — current viewing contact + staff candidates for this property. */
export async function GET(request: Request, context: { params: Promise<{ propertyId: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const { propertyId } = await context.params;
  if (!z.string().uuid().safeParse(propertyId).success) {
    return NextResponse.json({ error: { code: 'invalid_id' } }, { status: 400 });
  }
  try {
    const detail = await loadPropertyViewingContact(claims, propertyId);
    if (!detail) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    return NextResponse.json(detail, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'load_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}

/** PATCH — set or clear the building viewing contact (guard / responsible). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ propertyId: string }> },
) {
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
    key: hashRateKey(['property-viewing-contact', claims.sub, clientIp(request)]),
    limit: 40,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const { propertyId } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(propertyId).success) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }
  try {
    const detail = await setPropertyViewingContact(
      claims,
      propertyId,
      parsed.data.contactUserId,
      parsed.data.phone ?? null,
    );
    return NextResponse.json(detail, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
