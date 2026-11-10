import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { LeaseBookingError } from '@/lib/public-lease-booking-neon';
import { resendOwnerBookingInvite } from '@/lib/owner-booking-invite-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const bodySchema = z
  .object({
    locale: z.enum(['ar', 'en']).default('ar'),
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
      key: `owner-booking-invite-resend:${hashRateKey([claims.sub, clientIp(request)])}`,
      limit: 30,
      windowMs: 60 * 60 * 1000,
    });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  let locale: 'ar' | 'en' = 'ar';
  try {
    const json = (await request.json().catch(() => ({}))) as unknown;
    const parsed = bodySchema.safeParse(json ?? {});
    if (parsed.success) locale = parsed.data.locale;
  } catch {
    /* default ar */
  }

  try {
    const result = await resendOwnerBookingInvite(claims, reservationId, locale);
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
