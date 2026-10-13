import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contractQrSvg } from '@/lib/contract-verify';
import { leaseBookingErrorResponse, leaseBookingJson } from '@/lib/lease-booking-route';
import {
  acceptHandover,
  reportHandoverDefects,
  tenantHandoverPass,
} from '@/lib/lease-reservation-lifecycle-neon';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { publicWebOrigin } from '@/lib/seo';
import { HANDOVER_PHOTOS_MAX, HANDOVER_PHOTO_MAX } from '@/lib/stay-handover';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const photoSchema = z
  .object({
    data: z.string().startsWith('data:image/').max(HANDOVER_PHOTO_MAX),
    takenAt: z.string().max(40),
    source: z.enum(['camera', 'device']),
  })
  .strict();

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }).strict(),
  z
    .object({
      action: z.literal('defects'),
      note: z.string().max(1000).optional(),
      photos: z.array(photoSchema).min(1).max(HANDOVER_PHOTOS_MAX),
    })
    .strict(),
]);

/**
 * GET — the tenant's handover pass while the keys are due: a sealed QR (and a six-digit code)
 * that rotates every five minutes, or where the handover stands once it was recorded.
 */
export async function GET(request: Request, context: { params: Promise<{ reference: string }> }) {
  if (!hasDatabaseUrl()) {
    return leaseBookingJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    return leaseBookingErrorResponse(error);
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['lease-handover-pass', claims.sub, clientIp(request)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return leaseBookingJson(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const { reference } = await context.params;
  const locale = new URL(request.url).searchParams.get('locale') === 'en' ? 'en' : 'ar';
  try {
    const result = await tenantHandoverPass(claims, reference);
    if (result.state !== 'pass') return leaseBookingJson(result);
    const { token, ...pass } = result;
    const url = `${publicWebOrigin()}/${locale}/handover?t=${encodeURIComponent(token)}`;
    return leaseBookingJson({ ...pass, qrSvg: await contractQrSvg(url) });
  } catch (error) {
    return leaseBookingErrorResponse(error, 'request_failed');
  }
}

/** POST — the tenant accepts the premises, or reports defects with photos within three hours. */
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
    key: hashRateKey(['lease-handover-tenant', claims.sub, clientIp(request)]),
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return leaseBookingJson(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return leaseBookingJson(
      { error: { code: 'invalid_body', messageAr: 'البيانات غير مكتملة.' } },
      { status: 400 },
    );
  }

  const { reference } = await context.params;
  try {
    const body = parsed.data;
    return leaseBookingJson(
      body.action === 'accept'
        ? await acceptHandover(claims, reference)
        : await reportHandoverDefects(claims, reference, { note: body.note, photos: body.photos }),
    );
  } catch (error) {
    return leaseBookingErrorResponse(error, 'request_failed');
  }
}
