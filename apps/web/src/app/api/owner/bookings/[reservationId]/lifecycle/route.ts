import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { isoDateSchema, leaseTenantSchema, leaseTermsSchema } from '@/lib/lease-contract-schema';
import { reservationOwnerAction } from '@/lib/lease-reservation-lifecycle-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { HANDOVER_PHOTO_MAX } from '@/lib/stay-handover';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const uuid = z.string().uuid();
const requirementCode = z.string().regex(/^[a-z0-9_]{2,40}$/);

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm_payment') }).strict(),
  z
    .object({ action: z.literal('reject_payment'), note: z.string().trim().min(2).max(500) })
    .strict(),
  z.object({ action: z.literal('approve') }).strict(),
  z
    .object({
      action: z.literal('verify_document'),
      code: requirementCode,
      decision: z.enum(['verified', 'rejected', 'cancel_booking']),
      note: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('save_contract'),
      lease: z
        .object({ unitId: uuid, tenant: leaseTenantSchema, terms: leaseTermsSchema })
        .strict()
        .optional(),
      sale: z
        .object({
          signedOn: isoDateSchema,
          amount: z
            .string()
            .trim()
            .regex(/^\d{1,12}(\.\d{1,3})?$/),
          notes: z.string().max(2000).optional(),
        })
        .strict()
        .optional(),
      requirements: z
        .array(
          z
            .object({
              code: requirementCode,
              labelAr: z.string().trim().min(2).max(120),
              labelEn: z.string().trim().max(120),
            })
            .strict(),
        )
        .max(12),
    })
    .strict(),
  z
    .object({
      action: z.literal('review_document'),
      code: requirementCode,
      decision: z.enum(['approved', 'rejected']),
      note: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('add_requirements'),
      requirements: z
        .array(
          z
            .object({
              code: requirementCode,
              labelAr: z.string().trim().min(2).max(120),
              labelEn: z.string().trim().max(120),
            })
            .strict(),
        )
        .min(1)
        .max(12),
    })
    .strict(),
  z
    .object({
      action: z.literal('review_cheque'),
      key: z.string().regex(/^(rent|vat|deposit)-\d{1,3}$/),
      decision: z.enum(['approved', 'rejected']),
      note: z.string().max(500).optional(),
    })
    .strict(),
  z.object({ action: z.literal('issue_contract') }).strict(),
  z
    .object({
      action: z.literal('record_handover'),
      on: isoDateSchema,
      recipientName: z.string().trim().min(2).max(120),
      keys: z.string().max(200).optional(),
      electricityReading: z.string().max(40).optional(),
      waterReading: z.string().max(40).optional(),
      notes: z.string().max(1000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('save_municipal_registration'),
      formNo: z.string().trim().min(1).max(80),
      contractNo: z.string().trim().min(1).max(80),
      electricityReading: z.string().trim().min(1).max(40),
      waterReading: z.string().trim().min(1).max(40),
      electricityReadingPhoto: z.string().startsWith('data:image/').max(HANDOVER_PHOTO_MAX),
      waterReadingPhoto: z.string().startsWith('data:image/').max(HANDOVER_PHOTO_MAX),
    })
    .strict(),
  z
    .object({
      action: z.literal('restore_reservation'),
      note: z.string().trim().min(2).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal('return_booking_docs'),
      note: z.string().trim().min(2).max(500),
      rejected: z
        .array(
          z.enum([
            'id-front',
            'id-back',
            'selfie',
            'signature',
            'civil_id_copy',
            'passport_copy',
            'cr_copy',
          ]),
        )
        .min(1)
        .max(12),
    })
    .strict(),
  z
    .object({
      action: z.literal('cancel_reservation'),
      note: z.string().trim().min(2).max(500),
    })
    .strict(),
]);

/**
 * POST /api/owner/bookings/:reservationId/lifecycle
 * A website rent / purchase booking after its deposit: owner approval, contract and required
 * documents, document review, contract approval (awaits the tenant's signature), handover.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ reservationId: string }> },
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  if (!claims.organizationId) {
    return NextResponse.json({ error: { code: 'organization_required' } }, { status: 400 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-reservation-lifecycle', claims.sub, clientIp(request)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const { reservationId } = await context.params;
  if (!uuid.safeParse(reservationId).success) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const result = await reservationOwnerAction(claims, reservationId, body, {
      defer: (task) => after(task),
    });
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('POST /api/owner/bookings/lifecycle', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
