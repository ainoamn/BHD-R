import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { verifySessionToken } from '@bhd-r/authz';
import { createPropertyBundleOnNeon } from '@/lib/create-property-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function sessionSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.BHD_R_SESSION_SECRET ?? 'development-session-secret-at-least-32-characters',
  );
}

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

  try {
    const body = await request.json();
    const created = await createPropertyBundleOnNeon(claims, body);
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
    const code = error instanceof Error ? error.message : 'create_failed';
    const map: Record<string, { status: number; ar: string; en: string }> = {
      forbidden: { status: 403, ar: 'ليست لديك صلاحية إنشاء عقار', en: 'Forbidden' },
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
      single_unit_requires_one_unit: {
        status: 409,
        ar: 'عقار بوحدة واحدة يحتاج وحدة واحدة فقط',
        en: 'Single-unit property needs exactly one unit',
      },
      multi_unit_requires_units: {
        status: 409,
        ar: 'عقار متعدد الوحدات يحتاج وحدة واحدة على الأقل',
        en: 'Multi-unit property needs units',
      },
    };
    const known = map[code];
    if (known) {
      return NextResponse.json(
        { error: { code, message: known.en, messageAr: known.ar } },
        { status: known.status },
      );
    }
    console.error('POST /api/owner/properties failed', error);
    return NextResponse.json(
      {
        error: {
          code: 'create_failed',
          message: error instanceof Error ? error.message : 'Create failed',
          messageAr: 'تعذر حفظ العقار في قاعدة البيانات',
        },
      },
      { status: 500 },
    );
  }
}
