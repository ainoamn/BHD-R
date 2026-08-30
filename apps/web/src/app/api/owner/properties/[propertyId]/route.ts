import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { verifySessionToken } from '@bhd-r/authz';
import { updatePropertyBundleOnNeon } from '@/lib/create-property-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireSessionSecret } from '@/lib/runtime-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

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
          messageAr: 'انتهت الجلسة — سجّل الدخول مجدداً',
        },
      },
      { status: 401 },
    );
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
    const code = error instanceof Error ? error.message : 'update_failed';
    const map: Record<string, { status: number; ar: string; en: string }> = {
      forbidden: { status: 403, ar: 'ليست لديك صلاحية تعديل العقار', en: 'Forbidden' },
      organization_required: {
        status: 400,
        ar: 'اختر مؤسسة أولاً',
        en: 'Organization required',
      },
      owner_not_found: {
        status: 404,
        ar: 'المالك غير موجود في هذه المؤسسة',
        en: 'Owner not found',
      },
      property_not_found: {
        status: 404,
        ar: 'العقار غير موجود',
        en: 'Property not found',
      },
      property_archived: {
        status: 409,
        ar: 'لا يمكن تعديل عقار مؤرشف',
        en: 'Archived properties cannot be edited',
      },
      duplicate_property: {
        status: 409,
        ar: 'عقار بنفس الاسم والعنوان موجود مسبقاً — لا يُسمح بالتكرار',
        en: 'A property with the same name and address already exists',
      },
    };
    const known = map[code];
    if (known) {
      return NextResponse.json(
        { error: { code, message: known.en, messageAr: known.ar } },
        { status: known.status },
      );
    }
    console.error('PATCH /api/owner/properties failed', error);
    return NextResponse.json(
      {
        error: {
          code: 'update_failed',
          message: error instanceof Error ? error.message : 'Update failed',
          messageAr: 'تعذر تحديث العقار في قاعدة البيانات',
        },
      },
      { status: 500 },
    );
  }
}
