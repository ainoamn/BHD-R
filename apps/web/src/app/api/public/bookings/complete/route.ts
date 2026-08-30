import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { completePublicBookingPayment } from '@/lib/public-booking-neon';
import { isBookingSandboxAllowed } from '@/lib/runtime-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  sessionReference: z.string().min(16).max(80),
});

/**
 * POST /api/public/bookings/complete — sandbox-only deposit confirmation.
 * Disabled in production (P0-01). Real confirmations must come from signed payment webhooks.
 */
export async function POST(request: Request) {
  if (!isBookingSandboxAllowed()) {
    return NextResponse.json(
      {
        error: {
          code: 'sandbox_disabled',
          message: 'Booking sandbox completion is disabled outside ALLOW_BOOKING_SANDBOX.',
        },
      },
      { status: 403 },
    );
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const result = await completePublicBookingPayment(claims, body.sessionReference);
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'complete_failed';
    const status = code === 'not_found' ? 404 : code === 'forbidden' ? 403 : 500;
    return NextResponse.json({ error: { code } }, { status });
  }
}
