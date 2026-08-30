import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { updatePropertyBundleOnNeon } from '@/lib/create-property-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** PATCH /api/owner/properties/:id — update via Neon (no Nest/Render). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ propertyId: string }> },
) {
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

  const { propertyId } = await context.params;
  if (!propertyId || propertyId.length < 32) {
    return NextResponse.json(
      {
        error: {
          code: 'not_found',
          message: 'Property not found',
          messageAr: 'العقار غير موجود',
        },
      },
      { status: 404 },
    );
  }

  try {
    const body = await request.json();
    const updated = await updatePropertyBundleOnNeon(claims, propertyId, body);
    return NextResponse.json(updated, { status: 200 });
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
    const code = clientSafeErrorCode(error, 'update_failed');
    const map: Record<string, { ar: string; en: string }> = {
      forbidden: { ar: 'ليست لديك صلاحية تعديل العقار', en: 'Forbidden' },
      organization_required: { ar: 'اختر مؤسسة أولاً', en: 'Organization required' },
      owner_not_found: { ar: 'المالك غير موجود في هذه المؤسسة', en: 'Owner not found' },
      property_not_found: { ar: 'العقار غير موجود', en: 'Property not found' },
      property_archived: { ar: 'لا يمكن تعديل عقار مؤرشف', en: 'Archived properties cannot be edited' },
      duplicate_property: {
        ar: 'عقار بنفس الاسم والعنوان موجود مسبقاً — لا يُسمح بالتكرار',
        en: 'A property with the same name and address already exists',
      },
      update_failed: { ar: 'تعذر تحديث العقار في قاعدة البيانات', en: 'Update failed' },
    };
    const known = map[code];
    if (!known) console.error('PATCH /api/owner/properties failed', error);
    return NextResponse.json(
      {
        error: {
          code,
          message: known?.en ?? 'Update failed',
          messageAr: known?.ar ?? 'تعذر تحديث العقار في قاعدة البيانات',
        },
      },
      { status: statusForSafeCode(code) },
    );
  }
}
