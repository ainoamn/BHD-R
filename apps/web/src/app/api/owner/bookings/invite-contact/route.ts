import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { LeaseBookingError } from '@/lib/public-lease-booking-neon';
import { saveOwnerInviteContact } from '@/lib/owner-booking-invite-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { reservationPartySchema } from '@/lib/reservation-party';
import { clearOpsContextDbCache } from '@/lib/portal-ops-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    mode: z.enum(['rent', 'sale']),
    party: reservationPartySchema,
  })
  .strict();

/** POST /api/owner/bookings/invite-contact — save invitee to the address book before send. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'database_unavailable' } }, { status: 503 });
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
      key: `owner-invite-contact:${hashRateKey([claims.sub, clientIp(request)])}`,
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
    const saved = await saveOwnerInviteContact(claims, parsed.data);
    clearOpsContextDbCache();
    return NextResponse.json({ ok: true, contact: saved });
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
