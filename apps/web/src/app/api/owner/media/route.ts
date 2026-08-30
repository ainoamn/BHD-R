import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession, RouteGuardError } from '@/lib/next-route-guard';
import { uploadUnitMediaOnNeon } from '@/lib/upload-property-media-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/owner/media — property image/doc upload via Vercel→R2→Neon. */
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
    const result = await uploadUnitMediaOnNeon(claims, {
      unitId,
      purpose,
      position: Number.isFinite(position) ? position : 0,
      mimeType: file.type || 'application/octet-stream',
      bytes,
      fileName: file.name,
    });
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
