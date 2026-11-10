import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { LeaseBookingError } from '@/lib/public-lease-booking-neon';
import { updateOwnerBookingInviteTerms } from '@/lib/owner-booking-invite-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorAmount = z.string().regex(/^[1-9]\d*$/);

const bodySchema = z
  .object({
    rentMinor: minorAmount.nullable().optional(),
    depositMinor: minorAmount.nullable().optional(),
    leaseStartsOn: isoDate.nullable().optional(),
    handoverOn: isoDate.nullable().optional(),
  })
  .strict();

type RouteContext = { params: Promise<{ reservationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'database_unavailable' } }, { status: 503 });
  }
  const { reservationId } = await context.params;
  if (!z.string().uuid().safeParse(reservationId).success) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  try {
    assertRouteRateLimit({
      key: `owner-booking-invite-update:${hashRateKey([claims.sub, clientIp(request)])}`,
      limit: 60,
      windowMs: 60 * 60 * 1000,
    });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const result = await updateOwnerBookingInviteTerms(claims, reservationId, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LeaseBookingError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, messageAr: error.messageAr } },
        { status: error.status },
      );
    }
    const code = clientSafeErrorCode(error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
