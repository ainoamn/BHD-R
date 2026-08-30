import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createPropertyBundleOnNeon } from '@/lib/create-property-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/owner/properties — create via Neon on Vercel (does not depend on Nest/Render). */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      {
        error: {
          code: 'db_unconfigured',
          message: 'DATABASE_URL is not set on Vercel',
          messageAr: 'قاعدة البيانات غير مضبوطة على Vercel',
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
    const body = await request.json();
    const idempotencyKey = request.headers.get('idempotency-key');
    const created = await createPropertyBundleOnNeon(claims, body, { idempotencyKey });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Invalid property payload',
            messageAr: 'بيانات العقار غير مكتملة أو غير صالحة',
            details: error.flatten(),
          },
        },
        { status: 400 },
      );
    }
    const code = clientSafeErrorCode(error, 'create_failed');
    const map: Record<string, { ar: string; en: string }> = {
      forbidden: { ar: 'ليست لديك صلاحية إنشاء عقار', en: 'Forbidden' },
      organization_required: { ar: 'اختر مؤسسة أولاً', en: 'Organization required' },
      owner_not_found: { ar: 'المالك غير موجود في هذه المؤسسة', en: 'Owner not found' },
      single_unit_requires_one_unit: {
        ar: 'عقار بوحدة واحدة يحتاج وحدة واحدة فقط',
        en: 'Single-unit property needs exactly one unit',
      },
      multi_unit_requires_units: {
        ar: 'عقار متعدد الوحدات يحتاج وحدة واحدة على الأقل',
        en: 'Multi-unit property needs units',
      },
      duplicate_property: {
        ar: 'عقار بنفس الاسم والعنوان موجود مسبقاً — لا يُسمح بالتكرار',
        en: 'A property with the same name and address already exists',
      },
      idempotency_payload_mismatch: {
        ar: 'طلب مكرر بمفتاح مختلف — حدّث الصفحة وأعد المحاولة',
        en: 'Idempotency key reused with a different payload',
      },
      create_failed: { ar: 'تعذر حفظ العقار في قاعدة البيانات', en: 'Create failed' },
    };
    const known = map[code];
    if (!known) console.error('POST /api/owner/properties failed', error);
    return NextResponse.json(
      {
        error: {
          code,
          message: known?.en ?? 'Create failed',
          messageAr: known?.ar ?? 'تعذر حفظ العقار في قاعدة البيانات',
        },
      },
      { status: statusForSafeCode(code) },
    );
  }
}
