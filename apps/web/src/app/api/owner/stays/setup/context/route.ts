import { NextResponse } from 'next/server';
import { z } from 'zod';
import { staySetupContextQuerySchema } from '@bhd-r/contracts';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { loadStaySetupContextOnNeon } from '@/lib/stay-setup-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const errorMap: Record<string, { ar: string; en: string; status: number }> = {
  organization_required: { ar: 'اختر مؤسسة أولاً', en: 'Organization required', status: 400 },
  property_not_found: { ar: 'العقار غير موجود', en: 'Property not found', status: 404 },
};

function mapError(error: unknown) {
  const code = error instanceof Error ? error.message : 'load_failed';
  const known = errorMap[code];
  if (known) {
    return NextResponse.json(
      { error: { code, message: known.en, messageAr: known.ar } },
      { status: known.status },
    );
  }
  console.error('stay setup context failed', error);
  return NextResponse.json(
    {
      error: {
        code: 'load_failed',
        message: 'Could not load stay setup context',
        messageAr: 'تعذر تحميل بيانات الإعداد',
      },
    },
    { status: 500 },
  );
}

/** GET /api/owner/stays/setup/context?propertyId=… */
export async function GET(request: Request) {
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
    claims = await requireLiveSession(request);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  let propertyId: string;
  try {
    const parsed = staySetupContextQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    propertyId = parsed.propertyId;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'propertyId is required',
          messageAr: 'معرف العقار مطلوب',
        },
      },
      { status: 400 },
    );
  }

  try {
    const loaded = await loadStaySetupContextOnNeon(claims, propertyId);
    return NextResponse.json(loaded);
  } catch (error) {
    return mapError(error);
  }
}
