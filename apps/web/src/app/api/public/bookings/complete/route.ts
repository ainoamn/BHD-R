import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifySessionToken } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { completePublicBookingPayment } from '@/lib/public-booking-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  sessionReference: z.string().min(16).max(80),
});

function sessionSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.BHD_R_SESSION_SECRET ?? 'development-session-secret-at-least-32-characters',
  );
}

/** POST /api/public/bookings/complete — sandbox confirm booking deposit. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
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
    const result = await completePublicBookingPayment(claims, body.sessionReference);
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'complete_failed';
    const status = code === 'not_found' ? 404 : code === 'forbidden' ? 403 : 500;
    return NextResponse.json({ error: { code } }, { status });
  }
}
