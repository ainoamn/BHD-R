import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { proposeRenewalTermOnNeon } from '@/lib/lease-renewal-automation-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { tenantClaimsForContract } from '@/lib/tenancy-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ contractId: string }> };

const bodySchema = z.object({
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** POST — tenant proposes a different renewal end date. */
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
    const result = await proposeRenewalTermOnNeon(
      tenantClaims,
      contractId,
      parsed.data.endsOn,
    );
    return NextResponse.json(result);
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    return NextResponse.json(
      {
        error: {
          code,
          message: code,
          messageAr:
            code === 'renewal_term_too_short'
              ? 'المدة المقترحة أقصر من الحد الأدنى الذي ضبطه المالك.'
              : code === 'renewal_date_invalid'
                ? 'تاريخ النهاية غير صالح.'
                : 'تعذّر إرسال اقتراح المدة.',
        },
      },
      { status: statusForSafeCode(code) },
    );
  }
}
