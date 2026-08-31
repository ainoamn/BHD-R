import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { uploadUnitMediaNestOrNeon } from '@/lib/nest-or-neon-write';
import { guardErrorResponse, requireLiveSession, RouteGuardError } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type JsonUploadBody = {
  unitId?: string;
  purpose?: string;
  position?: number;
  fileName?: string;
  mimeType?: string;
  dataBase64?: string;
};

type UploadPayload = {
  unitId: string;
  purpose: 'property_image' | 'attachment';
  position: number;
  mimeType: string;
  fileName?: string;
  bytes: Buffer;
};

async function readUploadPayload(request: Request): Promise<UploadPayload> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await request.json()) as JsonUploadBody;
    const unitId = String(body.unitId ?? '');
    const purpose =
      body.purpose === 'attachment' ? ('attachment' as const) : ('property_image' as const);
    const raw = String(body.dataBase64 ?? '').replace(/^data:[^;]+;base64,/, '');
    if (!unitId || !raw) throw new Error('validation_failed');
    const bytes = Buffer.from(raw, 'base64');
    if (bytes.byteLength < 1 || bytes.byteLength > 8 * 1024 * 1024) {
      throw new Error('invalid_file');
    }
    const fileName = typeof body.fileName === 'string' && body.fileName ? body.fileName : undefined;
    return {
      unitId,
      purpose,
      position: Number.isFinite(Number(body.position)) ? Number(body.position) : 0,
      mimeType: body.mimeType || 'application/octet-stream',
      bytes,
      ...(fileName ? { fileName } : {}),
    };
  }

  const form = await request.formData();
  const file = form.get('file');
  const unitId = String(form.get('unitId') ?? '');
  const purposeRaw = String(form.get('purpose') ?? 'property_image');
  const purpose =
    purposeRaw === 'attachment' ? ('attachment' as const) : ('property_image' as const);
  const position = Number(form.get('position') ?? 0);
  if (!(file instanceof Blob) || !unitId) throw new Error('validation_failed');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error('invalid_file');
  }
  const fileName = file instanceof File && file.name ? file.name : undefined;
  return {
    unitId,
    purpose,
    position: Number.isFinite(position) ? position : 0,
    mimeType: file.type || 'application/octet-stream',
    bytes,
    ...(fileName ? { fileName } : {}),
  };
}

/** POST /api/owner/media — Neon/R2 first, Nest server-side fallback. Accepts multipart or JSON base64. */
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
    const payload = await readUploadPayload(request);
    const idempotencyKey = request.headers.get('idempotency-key');
    const result = await uploadUnitMediaNestOrNeon(
      claims,
      {
        unitId: payload.unitId,
        purpose: payload.purpose,
        position: payload.position,
        mimeType: payload.mimeType,
        bytes: payload.bytes,
        ...(payload.fileName ? { fileName: payload.fileName } : {}),
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
      validation_failed: {
        ar: 'الملف ومعرّف الوحدة مطلوبان',
        en: 'file and unitId are required',
      },
      storage_unavailable: {
        ar: 'تخزين الصور غير متاح حالياً. صغّر الصورة أو أعد المحاولة لاحقاً.',
        en: 'Photo storage is temporarily unavailable. Use a smaller image or try again later.',
      },
      s3_unconfigured: {
        ar: 'تخزين الصور غير مضبوط على الخادم',
        en: 'Media storage is not configured on the server',
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
