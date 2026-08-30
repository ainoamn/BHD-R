import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifySessionToken } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireSessionSecret } from '@/lib/runtime-env';
import { createPublicBookingCheckout } from '@/lib/public-booking-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  unitId: z.string().uuid(),
});

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

/** POST /api/public/bookings — start booking checkout for the unit deposit. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) {
    return NextResponse.json(
      {
        error: {
          code: 'unauthorized',
          message: 'Sign in is required',
          messageAr: 'يلزم تسجيل الدخول',
        },
      },
      { status: 401 },
    );
  }

  let claims: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    claims = await verifySessionToken(token, sessionSecret());
  } catch {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const result = await createPublicBookingCheckout(claims, body.unitId);
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'booking_failed';
    const status =
      code === 'unit_unavailable' || code === 'not_found'
        ? 404
        : code === 'deposit_not_set'
          ? 409
          : code === 'unauthorized'
            ? 401
            : 500;
    return NextResponse.json({ error: { code } }, { status });
  }
}
