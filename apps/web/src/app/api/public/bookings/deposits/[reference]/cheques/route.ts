import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { leaseBookingErrorResponse, leaseBookingJson } from '@/lib/lease-booking-route';
import { REQUIREMENT_FILE_MAX_CHARS } from '@/lib/lease-reservation-lifecycle';
import { submitReservationCheque } from '@/lib/lease-reservation-lifecycle-neon';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    key: z.string().regex(/^(rent|vat|deposit)-\d{1,3}$/),
    bankName: z.string().trim().min(2).max(160),
    accountHolderName: z.string().trim().min(2).max(160),
    chequeNumber: z.string().trim().min(1).max(80),
    fileName: z.string().max(200),
    dataUrl: z.string().startsWith('data:').max(REQUIREMENT_FILE_MAX_CHARS),
  })
  .strict();

/** POST — tenant sends one cheque (number + image/PDF) required for a cheque-payment lease. */
export async function POST(request: Request, context: { params: Promise<{ reference: string }> }) {
  if (!hasDatabaseUrl()) {
    return leaseBookingJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    return leaseBookingErrorResponse(error);
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['lease-cheques', claims.sub, clientIp(request)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return leaseBookingJson(
      { error: { code: 'rate_limited', messageAr: 'محاولات كثيرة.' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return leaseBookingJson(
      {
        error: {
          code: 'invalid_body',
          messageAr: 'أكمل بيانات الشيك وارفق صورة أو PDF أصغر من الحد المسموح.',
        },
      },
      { status: 400 },
    );
  }

  const { reference } = await context.params;
  try {
    return leaseBookingJson(await submitReservationCheque(claims, reference, parsed.data));
  } catch (error) {
    return leaseBookingErrorResponse(error, 'request_failed');
  }
}
