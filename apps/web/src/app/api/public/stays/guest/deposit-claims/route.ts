import { after } from 'next/server';
import { z } from 'zod';
import { stayBookingDbGuard, stayBookingJson } from '@/lib/public-stays-booking-route';
import { announceReleasedReviews } from '@/lib/review-release-neon';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { CLAIM_MESSAGE_MAX, claimErrorBody } from '@/lib/stay-deposit-claims';
import { guestDepositClaimAction } from '@/lib/stay-deposit-claims-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reference = z.string().trim().min(4).max(40);
const message = z.string().max(CLAIM_MESSAGE_MAX * 2);

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm_receipt'), referenceCode: reference }).strict(),
  z
    .object({
      action: z.literal('not_received'),
      referenceCode: reference,
      message: message.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('open'),
      referenceCode: reference,
      kind: z.enum(['deduction', 'other']),
      amount: z.string().max(24).optional(),
      message,
    })
    .strict(),
  z
    .object({
      action: z.literal('open_track'),
      referenceCode: reference,
      kind: z.enum(['property_complaint', 'appeal', 'site_complaint']),
      message,
    })
    .strict(),
]);

/**
 * POST /api/public/stays/guest/deposit-claims — confirm receipt, open a request (max 2),
 * or open the property-complaint → appeal → site-complaint track.
 */
export async function POST(request: Request) {
  const blocked = stayBookingDbGuard();
  if (blocked) return blocked;

  const limited = assertRouteRateLimit({
    key: hashRateKey(['stay-deposit-claim', clientIp(request)]),
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    const { body } = claimErrorBody('rate_limited');
    return stayBookingJson(body, {
      status: 429,
      headers: { 'retry-after': String(limited.retryAfterSec) },
    });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    const failed = claimErrorBody('invalid_body');
    return stayBookingJson(failed.body, { status: failed.status });
  }

  try {
    const { referenceCode, ...action } = body;
    const result = await guestDepositClaimAction(referenceCode, action);
    if (action.action === 'confirm_receipt') {
      const ai = { oidcToken: request.headers.get('x-vercel-oidc-token') };
      after(() =>
        announceReleasedReviews(ai, { referenceCode }).catch((error: unknown) =>
          console.error('review release', error),
        ),
      );
    }
    return stayBookingJson({ ok: true, whatsapp: result.whatsapp });
  } catch (error) {
    const failed = claimErrorBody(error instanceof Error ? error.message : '');
    if (failed.status === 500) console.error('POST /api/public/stays/guest/deposit-claims', error);
    return stayBookingJson(failed.body, { status: failed.status });
  }
}
