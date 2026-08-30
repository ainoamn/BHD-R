import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { uploadUnitMediaNestOrNeon } from '@/lib/nest-or-neon-write';
import { guardErrorResponse, requireLiveSession, RouteGuardError } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/owner/media — Nest-first upload (intent→ingress→complete) with Neon fallback. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      {
        error: {
          code: 'db_unconfigured',
          message: 'DATABASE_URL is not set',
          messageAr: 'قاعدة البيانات غير مضبوطة',
        },
      },
      { status: 503 },
    );
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-media-upload', claims.sub, clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many uploads', messageAr: 'طلبات رفع كثيرة' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    const unitId = String(form.get('unitId') ?? '');
    const purposeRaw = String(form.get('purpose') ?? 'property_image');
    const purpose =
      purposeRaw === 'attachment' ? ('attachment' as const) : ('property_image' as const);
    const position = Number(form.get('position') ?? 0);
    if (!(file instanceof File) || !unitId) {
      return NextResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'file and unitId are required',
            messageAr: 'الملف ومعرّف الوحدة مطلوبان',
          },
        },
        { status: 400 },
      );
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const idempotencyKey = request.headers.get('idempotency-key');
    const result = await uploadUnitMediaNestOrNeon(
      claims,
      {
        unitId,
        purpose,
        position: Number.isFinite(position) ? position : 0,
        mimeType: file.type || 'application/octet-stream',
        bytes,
        fileName: file.name,
      },
      request.headers.get('x-csrf-token'),
      { idempotencyKey },
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof RouteGuardError) {
      const mapped = guardErrorResponse(error);
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    const code = clientSafeErrorCode(error, 'upload_failed');
    const map: Record<string, { ar: string; en: string }> = {
      forbidden: { ar: 'ليست لديك صلاحية رفع الملفات', en: 'Forbidden' },
      organization_required: { ar: 'اختر مؤسسة أولاً', en: 'Organization required' },
      unit_not_found: { ar: 'الوحدة غير موجودة', en: 'Unit not found' },
      invalid_file: { ar: 'نوع أو حجم الملف غير مسموح', en: 'Invalid file' },
      storage_unavailable: {
        ar: 'تخزين الصور غير متاح — اضبط S3_BUCKET_PRIVATE',
        en: 'Object storage unavailable — configure S3_BUCKET_PRIVATE',
      },
      s3_unconfigured: {
        ar: 'تخزين الصور غير مضبوط',
        en: 'Media storage is not configured',
      },
      inline_too_large: {
        ar: 'الملف كبير للتخزين المؤقت',
        en: 'File too large for temporary storage',
      },
      upload_failed: { ar: 'فشل رفع الملف', en: 'Upload failed' },
      rate_limited: { ar: 'طلبات رفع كثيرة', en: 'Too many uploads' },
    };
    const hit = map[code];
    return NextResponse.json(
      {
        error: {
          code,
          message: hit?.en ?? 'Upload failed',
          messageAr: hit?.ar ?? 'فشل رفع الملف',
        },
      },
      { status: statusForSafeCode(code) },
    );
  }
}
