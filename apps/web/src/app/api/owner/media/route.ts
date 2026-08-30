import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { verifySessionToken } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { s3Configured, uploadUnitMediaOnNeon } from '@/lib/upload-property-media-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function sessionSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.BHD_R_SESSION_SECRET ?? 'development-session-secret-at-least-32-characters',
  );
}

/** POST /api/owner/media — compress-friendly property image/doc upload via Vercel→R2→Neon. */
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
  if (!s3Configured()) {
    return NextResponse.json(
      {
        error: {
          code: 's3_unconfigured',
          message: 'Object storage is not configured on Vercel',
          messageAr: 'تخزين الصور غير مضبوط على Vercel (S3/R2)',
        },
      },
      { status: 503 },
    );
  }

  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) {
    return NextResponse.json(
      {
        error: {
          code: 'unauthorized',
          message: 'Authentication is required',
          messageAr: 'يلزم تسجيل الدخول',
        },
      },
      { status: 401 },
    );
  }

  let claims: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    claims = await verifySessionToken(token, sessionSecret());
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'unauthorized',
          message: 'Invalid or expired session',
          messageAr: 'انتهت الجلسة',
        },
      },
      { status: 401 },
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
    const code = error instanceof Error ? error.message : 'upload_failed';
    const map: Record<string, { status: number; ar: string; en: string }> = {
      forbidden: { status: 403, ar: 'ليست لديك صلاحية رفع الملفات', en: 'Forbidden' },
      organization_required: { status: 400, ar: 'اختر مؤسسة أولاً', en: 'Organization required' },
      unit_not_found: { status: 404, ar: 'الوحدة غير موجودة', en: 'Unit not found' },
      invalid_file: { status: 400, ar: 'نوع أو حجم الملف غير مسموح', en: 'Invalid file' },
      s3_unconfigured: {
        status: 503,
        ar: 'تخزين الصور غير مضبوط',
        en: 'Object storage unconfigured',
      },
    };
    const known = map[code];
    if (known) {
      return NextResponse.json(
        { error: { code, message: known.en, messageAr: known.ar } },
        { status: known.status },
      );
    }
    console.error('POST /api/owner/media failed', error);
    return NextResponse.json(
      {
        error: {
          code: 'upload_failed',
          message: error instanceof Error ? error.message : 'Upload failed',
          messageAr: 'تعذر رفع الملف',
        },
      },
      { status: 500 },
    );
  }
}
