import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { LeaseBookingError } from '@/lib/public-lease-booking-neon';
import { cancelOwnerBookingInvite } from '@/lib/owner-booking-invite-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z
  .object({
    note: z.string().trim().max(500).nullable().optional(),
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
      key: `owner-booking-invite-cancel:${hashRateKey([claims.sub, clientIp(request)])}`,
      limit: 40,
      windowMs: 60 * 60 * 1000,
    });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  let note: string | null = null;
  try {
    const json = (await request.json().catch(() => ({}))) as unknown;
    const parsed = bodySchema.safeParse(json ?? {});
    if (parsed.success) note = parsed.data.note ?? null;
  } catch {
    /* ignore */
  }

  try {
    const result = await cancelOwnerBookingInvite(claims, reservationId, note);
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
