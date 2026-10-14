import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { leaseBookingErrorResponse, leaseBookingJson } from '@/lib/lease-booking-route';
import {
  offerHandover,
  previewHandover,
  type HandoverKey,
} from '@/lib/lease-reservation-lifecycle-neon';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { HANDOVER_PHOTOS_MAX, HANDOVER_PHOTO_MAX } from '@/lib/stay-handover';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const keySchema = z.union([
  z.object({ token: z.string().min(40).max(120) }).strict(),
  z
    .object({
      reference: z.string().trim().min(4).max(40),
      code: z
        .string()
        .trim()
        .regex(/^\d{6}$/),
    })
    .strict(),
]);

const photoSchema = z
  .object({
    data: z.string().startsWith('data:image/').max(HANDOVER_PHOTO_MAX),
    takenAt: z.string().max(40),
    source: z.enum(['camera', 'device']),
  })
  .strict();

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), key: keySchema, poll: z.boolean().optional() }).strict(),
  z
    .object({
      action: z.literal('offer'),
      key: keySchema,
      recipientName: z.string().trim().min(2).max(120),
      keys: z.string().max(200).optional(),
      electricityReading: z.string().max(40).optional(),
      waterReading: z.string().max(40).optional(),
      notes: z.string().max(1000).optional(),
      photos: z.array(photoSchema).max(HANDOVER_PHOTOS_MAX),
    })
    .strict(),
]);

/**
 * POST /api/handover — a staff member with `reservation.handover` reads whose pass they scanned
 * (`preview`, which asks the tenant's phone for a selfie; `poll` only re-reads), then records
 * the handover (`offer`).
 */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return leaseBookingJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    return leaseBookingErrorResponse(error);
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['lease-handover-staff', claims.sub, clientIp(request)]),
    limit: 30,
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

  try {
    const body = parsed.data;
    const key: HandoverKey = body.key;
    if (body.action === 'preview') {
      return leaseBookingJson(await previewHandover(claims, key, { requestSelfie: !body.poll }));
    }
    return leaseBookingJson(
      await offerHandover(claims, key, {
        recipientName: body.recipientName,
        keys: body.keys,
        electricityReading: body.electricityReading,
        waterReading: body.waterReading,
        notes: body.notes,
        photos: body.photos,
      }),
    );
  } catch (error) {
    return leaseBookingErrorResponse(error, 'request_failed');
  }
}
