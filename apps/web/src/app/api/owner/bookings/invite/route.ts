import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { LeaseBookingError } from '@/lib/public-lease-booking-neon';
import { createOwnerBookingInvite } from '@/lib/owner-booking-invite-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { reservationPartySchema } from '@/lib/reservation-party';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const bodySchema = z
  .object({
    unitId: z.string().uuid(),
    mode: z.enum(['rent', 'sale']),
    locale: z.enum(['ar', 'en']).default('ar'),
    fullName: z.string().trim().min(2).max(200),
    phone: z.string().trim().min(8).max(40),
    email: z.string().trim().email().max(320),
    contractPreference: z.enum(['electronic', 'manual']),
    party: reservationPartySchema,
  })
  .strict();

export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'database_unavailable' } }, { status: 503 });
  }
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    return guardErrorResponse(error);
  }

  try {
    assertRouteRateLimit({
      key: `owner-booking-invite:${hashRateKey([claims.sub, clientIp(request)])}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });
  } catch (error) {
    return guardErrorResponse(error);
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
    const result = await createOwnerBookingInvite(claims, parsed.data);
    after(() => undefined);
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
