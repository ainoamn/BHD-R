import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { leaseBookingErrorResponse, leaseBookingJson } from '@/lib/lease-booking-route';
import { REQUIREMENT_FILE_MAX_CHARS } from '@/lib/lease-reservation-lifecycle';
import { replaceReturnedBookingIdentityDoc } from '@/lib/lease-reservation-lifecycle-neon';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    code: z.enum([
      'id-front',
      'id-back',
      'selfie',
      'signature',
      'civil_id_copy',
      'passport_copy',
      'cr_copy',
    ]),
    fileName: z.string().max(200),
    dataUrl: z.string().startsWith('data:').max(REQUIREMENT_FILE_MAX_CHARS),
  })
  .strict();

/** POST — tenant replaces one booking identity document the owner returned for a fix. */
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
    key: hashRateKey(['lease-identity-docs', claims.sub, clientIp(request)]),
    limit: 20,
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
          messageAr: 'الملف غير مكتمل أو كبير جداً — أرسل صورة أو PDF أصغر.',
        },
      },
      { status: 400 },
    );
  }

  const { reference } = await context.params;
  try {
    return leaseBookingJson(await replaceReturnedBookingIdentityDoc(claims, reference, parsed.data));
  } catch (error) {
    return leaseBookingErrorResponse(error, 'request_failed');
  }
}
