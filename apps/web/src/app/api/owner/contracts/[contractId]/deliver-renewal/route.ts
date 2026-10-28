import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { deliverDraftRenewalOnNeon } from '@/lib/lease-renewal-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimitAsync, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteContext = { params: Promise<{ contractId: string }> };

/** POST — send a draft renewal addendum to the tenant for e-sign + documents. */
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

  const limited = await assertRouteRateLimitAsync({
    key: hashRateKey(['renewal-deliver', claims.sub, contractId, clientIp(request)]),
    limit: 12,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  try {
    const result = await deliverDraftRenewalOnNeon(claims, contractId);
    return NextResponse.json(result);
  } catch (error) {
    const code = clientSafeErrorCode(error, 'deliver_failed');
    return NextResponse.json(
      {
        error: {
          code,
          message: code,
          messageAr:
            code === 'forbidden'
              ? 'ليست لديك صلاحية إرسال الملحق للمستأجر.'
              : code === 'renewal_not_deliverable'
                ? 'لا يمكن إرسال هذا الملحق للمستأجر بحالته الحالية.'
                : 'تعذّر إرسال ملحق التجديد للمستأجر.',
        },
      },
      { status: statusForSafeCode(code) },
    );
  }
}
