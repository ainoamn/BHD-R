import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { uploadRenewalDocumentOnNeon } from '@/lib/lease-renewal-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimitAsync, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { tenantClaimsForContract } from '@/lib/tenancy-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteContext = { params: Promise<{ contractId: string }> };

/** POST multipart: code + file — tenant attaches a required renewal document. */
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
    key: hashRateKey(['renewal-doc-upload', claims.sub, contractId, clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const tenantClaims = await tenantClaimsForContract(claims, contractId);
  if (!tenantClaims) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const code = String(form?.get('code') ?? '').trim();
  const file = form?.get('file');
  if (!code || !(file instanceof File)) {
    return NextResponse.json({ error: { code: 'validation_failed' } }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await uploadRenewalDocumentOnNeon(tenantClaims, contractId, {
      code,
      fileName: file.name || code,
      bytes,
    });
    return NextResponse.json(result);
  } catch (error) {
    const mapped = clientSafeErrorCode(error, 'upload_failed');
    return NextResponse.json(
      {
        error: {
          code: mapped,
          message: mapped,
          messageAr:
            mapped === 'renewal_document_invalid'
              ? 'الملف غير صالح — استخدم صورة أو PDF بحجم مناسب.'
              : mapped === 'renewal_document_code'
                ? 'هذا المستند غير مطلوب في ملحق التجديد.'
                : mapped === 'renewal_document_storage'
                  ? 'تعذّر حفظ الملف الآن — أعد المحاولة لاحقاً.'
                  : 'تعذّر رفع مستند التجديد.',
        },
      },
      { status: statusForSafeCode(mapped) },
    );
  }
}
