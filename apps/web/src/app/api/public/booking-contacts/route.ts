import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { saveBookingContact } from '@/lib/booking-contacts-neon';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { isValidGuestPhone } from '@/lib/stay-booking-dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    bookingFor: z.enum(['self', 'other']),
    fullName: z.string().trim().min(2).max(160),
    phone: z.string().trim().max(32).refine(isValidGuestPhone),
    email: z.union([z.string().trim().email().max(320), z.literal('')]).optional(),
    savedContactId: z.string().uuid().optional(),
  })
  .strict();

/** POST /api/public/booking-contacts — save the booker's phone or a person they book for. */
export async function POST(request: Request) {
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

  const limited = assertRouteRateLimit({
    key: hashRateKey(['booking-contact-save', claims.sub, clientIp(request)]),
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const result = await saveBookingContact(claims, {
      bookingFor: parsed.data.bookingFor,
      contactId: parsed.data.savedContactId ?? null,
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      email: parsed.data.email || null,
    });
    return NextResponse.json({ ok: true, saved: result.saved });
  } catch (error) {
    console.error('booking contact save failed', error);
    const code = clientSafeErrorCode(error, 'update_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
