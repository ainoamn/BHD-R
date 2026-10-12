import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import {
  ADJUSTMENT_KINDS,
  ADJUSTMENT_RECURRENCES,
  ADJUSTMENT_SCOPES,
  CONTRACT_USES,
  DEPOSIT_METHODS,
  MAX_SCHEDULE_ROWS,
  PAYMENT_FREQUENCIES,
  PAYMENT_METHODS,
  VAT_MODES,
} from '@/lib/lease-terms';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import {
  approveContractOnNeon,
  approveStayBookingOnNeon,
  createManualLeaseContractOnNeon,
  createManualSaleContractOnNeon,
  rejectStayBookingOnNeon,
} from '@/lib/property-contracts-neon';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { recordStayStampOnNeon } from '@/lib/stay-arrival-neon';
import {
  REFUND_NOTE_MAX,
  REFUND_PAYOUT_METHODS,
  REFUND_RECEIPT_DATA_URL,
  REFUND_RECEIPT_MAX,
} from '@/lib/stay-deposit-refund';
import {
  decideDepositRefundOnNeon,
  recordDepositRefundPayoutOnNeon,
} from '@/lib/stay-deposit-refund-neon';
import {
  HANDOVER_DOCUMENT_KEYS,
  HANDOVER_DOCUMENT_MAX,
  HANDOVER_PHOTOS_MAX,
  HANDOVER_PHOTO_MAX,
  HANDOVER_PHOTO_SOURCES,
} from '@/lib/stay-handover';

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

const short = (max: number) => z.string().max(max).optional();
const money = z.string().max(24);

const leaseTenantSchema = z
  .object({
    partyId: uuid.optional(),
    entityType: z.enum(['person', 'company']),
    nameAr: z.string().trim().min(2).max(200),
    nameEn: short(200),
    civilId: short(40),
    passport: short(40),
    nationality: short(80),
    crNumber: short(40),
    crExpiry: isoDate.optional().or(z.literal('').transform(() => undefined)),
    signatoryName: short(200),
    signatoryCivilId: short(40),
    phone: short(40),
    email: z
      .string()
      .trim()
      .email()
      .max(320)
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .strict();

const leaseTermsSchema = z
  .object({
    contractType: z.enum(CONTRACT_USES),
    usageType: z.enum(CONTRACT_USES),
    municipalFormNo: short(80),
    municipalContractNo: short(80),
    rentCalcMode: z.enum(['full', 'per_meter']),
    monthlyRent: money,
    rentAreaSqm: short(16),
    rentPerSqm: short(24),
    handoverOn: short(10),
    startsOn: isoDate,
    endsOn: isoDate,
    paymentDay: z.string().max(4),
    paymentMethod: z.enum(PAYMENT_METHODS),
    paymentFrequency: z.enum(PAYMENT_FREQUENCIES),
    vatEnabled: z.boolean(),
    vatRate: z.string().max(8),
    vatMode: z.enum(VAT_MODES),
    vatChequeCount: z.string().max(4),
    municipalityFeeEnabled: z.boolean(),
    registrationFee: money,
    otherTaxName: short(80),
    otherTaxRate: short(8),
    graceAsDiscount: z.boolean(),
    deposit: money,
    depositItems: z
      .array(
        z
          .object({
            method: z.enum(DEPOSIT_METHODS),
            amount: money,
            reference: short(80),
            bankName: short(160),
            dueOn: short(10),
          })
          .strict(),
      )
      .max(20),
    chequeBankName: short(160),
    chequeAccountName: short(160),
    schedule: z
      .array(
        z
          .object({
            dueOn: isoDate,
            rent: money,
            chequeNumber: short(80),
            bankName: short(160),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_SCHEDULE_ROWS),
    vatChequeNumbers: z.array(z.string().max(80)).max(24),
    adjustments: z
      .array(
        z
          .object({
            kind: z.enum(ADJUSTMENT_KINDS),
            title: z.string().max(120),
            amount: money,
            recurrence: z.enum(ADJUSTMENT_RECURRENCES),
            scope: z.enum(ADJUSTMENT_SCOPES),
            months: short(4),
          })
          .strict(),
      )
      .max(50),
    electricityReading: short(40),
    waterReading: short(40),
    notes: short(2000),
  })
  .strict();

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve_booking'), bookingId: uuid }).strict(),
  z.object({ action: z.literal('reject_booking'), bookingId: uuid }).strict(),
  z.object({ action: z.literal('approve_contract'), contractId: uuid }).strict(),
  z
    .object({
      action: z.enum(['check_in', 'check_out']),
      bookingId: uuid,
      at: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
        .optional(),
      notes: z.string().max(1000).optional(),
      noteKeys: z.array(z.string().max(40)).max(20).optional(),
      important: z.boolean().optional(),
      recipient: z
        .object({
          name: z.string().max(120).optional(),
          phone: z.string().max(32),
          documentKind: z.enum(HANDOVER_DOCUMENT_KEYS),
          document: z
            .string()
            .regex(/^data:image\/(?:png|jpeg|webp);base64,/)
            .max(HANDOVER_DOCUMENT_MAX),
        })
        .strict()
        .optional(),
      photos: z
        .array(
          z
            .object({
              data: z
                .string()
                .regex(/^data:image\/(?:png|jpeg|webp);base64,/)
                .max(HANDOVER_PHOTO_MAX),
              source: z.enum(HANDOVER_PHOTO_SOURCES),
              takenAt: z.string().max(40).optional(),
            })
            .strict(),
        )
        .max(HANDOVER_PHOTOS_MAX)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('create_lease'),
      unitId: uuid,
      tenant: leaseTenantSchema,
      terms: leaseTermsSchema,
    })
    .strict(),
  z.object({ action: z.literal('create_sale'), ...party, signedOn: isoDate }).strict(),
  z
    .object({
      action: z.literal('refund_decide'),
      bookingId: uuid,
      decision: z.enum(['approve', 'reject']),
      amount: amount.optional(),
      note: z.string().max(REFUND_NOTE_MAX).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('refund_payout'),
      bookingId: uuid,
      method: z.enum(REFUND_PAYOUT_METHODS),
      account: z.string().trim().min(4).max(64),
      bank: z.string().trim().min(2).max(120),
      holder: z.string().max(120).optional(),
      reference: z.string().max(80).optional(),
      at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      receipt: z.string().max(REFUND_RECEIPT_MAX).regex(REFUND_RECEIPT_DATA_URL),
    })
    .strict(),
]);

/**
 * POST /api/owner/properties/:propertyId/records
 * Workflow actions of the property hub tabs: approve/reject a booking (approval issues the
 * contract and lease), record a stay's check-in / check-out, approve a pending contract,
 * manual lease / sale contracts, and the deposit refund (host decision, accountant transfer).
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
      case 'check_in':
      case 'check_out':
        return NextResponse.json(
          await recordStayStampOnNeon(claims, propertyId, body.bookingId, {
            kind: body.action,
            at: body.at,
            notes: body.notes,
            noteKeys: body.noteKeys,
            important: body.important,
            recipient: body.recipient,
            photos: body.photos,
          }),
        );
      case 'create_lease':
        return NextResponse.json(await createManualLeaseContractOnNeon(claims, propertyId, body));
      case 'create_sale':
        return NextResponse.json(await createManualSaleContractOnNeon(claims, propertyId, body));
      case 'refund_decide':
        return NextResponse.json(
          await decideDepositRefundOnNeon(claims, propertyId, body.bookingId, {
            decision: body.decision,
            amount: body.amount,
            note: body.note,
          }),
        );
      case 'refund_payout':
        return NextResponse.json(
          await recordDepositRefundPayoutOnNeon(claims, propertyId, body.bookingId, {
            method: body.method,
            account: body.account,
            bank: body.bank,
            holder: body.holder,
            reference: body.reference,
            at: body.at,
            receipt: body.receipt,
          }),
        );
    }
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    if (code === 'update_failed') console.error('POST /api/owner/properties/records', error);
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
