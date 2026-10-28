import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { createLeaseRenewalOnNeon } from '@/lib/lease-renewal-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimitAsync, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const moneySchema = z.object({
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const bodySchema = z
  .object({
    templateVersionId: z.uuid(),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rent: moneySchema.optional(),
    additionalTerms: z.string().trim().max(10_000).optional(),
    graceDays: z.number().int().min(0).max(90).optional().default(0),
    graceAsDiscount: z.boolean().optional().default(true),
    graceAmount: moneySchema.optional(),
    adjustments: z
      .array(
        z.object({
          kind: z.enum(['add', 'discount']),
          title: z.string().trim().min(1).max(160),
          amount: moneySchema,
        }),
      )
      .max(40)
      .optional()
      .default([]),
    paymentMethod: z.enum(['cheque', 'cash', 'bank_transfer']).optional(),
    paymentFrequency: z
      .enum(['monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual'])
      .optional(),
    months: z.number().int().min(0).max(120).optional(),
    cheques: z
      .array(
        z.object({
          bankName: z.string().trim().min(1).max(160),
          chequeNumber: z.string().trim().min(1).max(80),
          amount: moneySchema,
          dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
      .max(48)
      .optional()
      .default([]),
    leaseTerms: z.record(z.string(), z.unknown()).nullish(),
    chequeAccountName: z.string().trim().max(160).nullish(),
    chequeBankName: z.string().trim().max(160).nullish(),
    rentBankAccountId: z.string().trim().max(64).nullish(),
    requirements: z
      .array(
        z.object({
          code: z.string().trim().min(2).max(40),
          labelAr: z.string().trim().min(1).max(120),
          labelEn: z.string().trim().min(1).max(120),
        }),
      )
      .max(20)
      .optional()
      .default([]),
  })
  .strip();

type RouteContext = { params: Promise<{ leaseId: string }> };

/**
 * POST /api/owner/leasing/:leaseId/renewals — create renewal addendum on Neon
 * (no Nest/Render dependency for owner save).
 */
export async function POST(request: Request, context: RouteContext) {
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

  const { leaseId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(leaseId)) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const limited = await assertRouteRateLimitAsync({
    key: hashRateKey(['lease-renewal-create', claims.sub, leaseId, clientIp(request)]),
    limit: 12,
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
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Invalid renewal payload',
          messageAr: 'بيانات ملحق التجديد غير صالحة',
          details: { issues: parsed.error.issues.slice(0, 6) },
        },
      },
      { status: 400 },
    );
  }

  try {
    const created = await createLeaseRenewalOnNeon(claims, leaseId, parsed.data);
    return NextResponse.json(created);
  } catch (error) {
    const code = clientSafeErrorCode(error, 'create_failed');
    const status = statusForSafeCode(code);
    const messageAr =
      code === 'renewal_pending'
        ? 'يوجد ملحق تجديد غير مكتمل لهذا العقد — أكمله أو ألغِه أولاً.'
        : code === 'lease_not_renewable'
          ? 'يمكن تجديد العقود النشطة فقط.'
          : code === 'renewal_date_invalid'
            ? 'تاريخ النهاية الجديد يجب أن يكون بعد نهاية العقد الحالي.'
            : code === 'forbidden'
              ? 'ليست لديك صلاحية إنشاء ملحق التجديد.'
              : code === 'renewal_duplicate'
                ? 'تعذّر الحفظ بسبب تكرار المرجع — حدّث الصفحة وأعد المحاولة.'
                : code === 'renewal_template_missing'
                  ? 'قالب ملحق التجديد غير موجود.'
                  : 'تعذّر حفظ ملحق التجديد.';
    return NextResponse.json({ error: { code, message: code, messageAr } }, { status });
  }
}
