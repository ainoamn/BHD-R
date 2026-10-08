import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import {
  approveContractOnNeon,
  approveStayBookingOnNeon,
  createManualLeaseContractOnNeon,
  createManualSaleContractOnNeon,
  rejectStayBookingOnNeon,
} from '@/lib/property-contracts-neon';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/);
const party = {
  unitId: uuid,
  partyName: z.string().trim().min(2).max(200),
  partyEmail: z
    .string()
    .trim()
    .email()
    .max(320)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  partyPhone: z.string().trim().max(40).optional(),
  amount,
  notes: z.string().max(2000).optional(),
};

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve_booking'), bookingId: uuid }).strict(),
  z.object({ action: z.literal('reject_booking'), bookingId: uuid }).strict(),
  z.object({ action: z.literal('approve_contract'), contractId: uuid }).strict(),
  z
    .object({
      action: z.literal('create_lease'),
      ...party,
      startsOn: isoDate,
      endsOn: isoDate,
      deposit: amount.optional().or(z.literal('').transform(() => undefined)),
    })
    .strict(),
  z.object({ action: z.literal('create_sale'), ...party, signedOn: isoDate }).strict(),
]);

/**
 * POST /api/owner/properties/:propertyId/records
 * Workflow actions of the property hub tabs: approve/reject a booking (approval issues the
 * contract and lease), approve a pending contract, and manual lease / sale contracts.
 */
export async function POST(request: Request, context: { params: Promise<{ propertyId: string }> }) {
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
    key: hashRateKey(['owner-property-records', claims.sub, clientIp(request)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const { propertyId } = await context.params;
  if (!uuid.safeParse(propertyId).success) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'approve_booking':
        return NextResponse.json(
          await approveStayBookingOnNeon(claims, propertyId, body.bookingId),
        );
      case 'reject_booking':
        return NextResponse.json(await rejectStayBookingOnNeon(claims, propertyId, body.bookingId));
      case 'approve_contract':
        return NextResponse.json(await approveContractOnNeon(claims, propertyId, body.contractId));
      case 'create_lease':
        return NextResponse.json(await createManualLeaseContractOnNeon(claims, propertyId, body));
      case 'create_sale':
        return NextResponse.json(await createManualSaleContractOnNeon(claims, propertyId, body));
    }
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('POST /api/owner/properties/records', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
