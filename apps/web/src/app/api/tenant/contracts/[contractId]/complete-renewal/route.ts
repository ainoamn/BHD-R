import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { completeTenantRenewalPackageOnNeon } from '@/lib/lease-renewal-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { tenantClaimsForContract } from '@/lib/tenancy-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteContext = { params: Promise<{ contractId: string }> };

const bodySchema = z.object({
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  consentAccepted: z.literal(true),
});

/** POST — tenant finishes renewal package; system e-documents the addendum. */
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

  const { contractId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(contractId)) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const tenantClaims = await tenantClaimsForContract(claims, contractId);
  if (!tenantClaims) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'validation_failed' } }, { status: 400 });
  }

  try {
    const result = await completeTenantRenewalPackageOnNeon(tenantClaims, contractId, {
      endsOn: parsed.data.endsOn,
      consentAccepted: parsed.data.consentAccepted,
    });
    return NextResponse.json(result);
  } catch (error) {
    const code = clientSafeErrorCode(error, 'complete_failed');
    return NextResponse.json(
      {
        error: {
          code,
          message: code,
          messageAr:
            code === 'renewal_documents_incomplete'
              ? 'ارفع كل المستندات المطلوبة قبل الإرسال.'
              : code === 'renewal_consent_required'
                ? 'يجب الموافقة على إقرار التوثيق الإلكتروني.'
                : code === 'renewal_term_pending'
                  ? 'طلب تعديل المدة قيد مراجعة المؤجر — انتظر القرار قبل التوثيق.'
                  : 'تعذّر إكمال حزمة التجديد.',
        },
      },
      { status: statusForSafeCode(code) },
    );
  }
}
