import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import {
  archivePropertyOnNeon,
  purgePropertyOnNeon,
  restorePropertyOnNeon,
} from '@/lib/property-lifecycle-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ propertyId: string }> };

const bodySchema = z.object({
  action: z.enum(['archive', 'restore', 'purge']),
});

const errorMap: Record<string, { ar: string; en: string; status: number }> = {
  organization_required: { ar: 'اختر مؤسسة أولاً', en: 'Organization required', status: 400 },
  property_not_found: { ar: 'العقار غير موجود', en: 'Property not found', status: 404 },
  archived_property_not_found: {
    ar: 'لا يوجد عقار مؤرشف بهذا المعرف',
    en: 'Archived property not found',
    status: 404,
  },
  property_not_archived: {
    ar: 'احذف نهائياً العقارات المؤرشفة فقط',
    en: 'Only archived properties can be purged',
    status: 409,
  },
  property_has_active_lease: {
    ar: 'لا يمكن أرشفة عقار عليه عقد نشط أو مسودة',
    en: 'Property with an active or draft lease cannot be archived',
    status: 409,
  },
  property_has_lease_history: {
    ar: 'لا يمكن الحذف النهائي لوجود سجل عقود مرتبط',
    en: 'Cannot purge property with lease history',
    status: 409,
  },
  property_has_stay_profile: {
    ar: 'لا يمكن الحذف النهائي لوجود ملف إقامة يومية',
    en: 'Cannot purge property with a stay profile',
    status: 409,
  },
};

function mapLifecycleError(error: unknown) {
  const code = error instanceof Error ? error.message : 'lifecycle_failed';
  const known = errorMap[code];
  if (known) {
    return NextResponse.json(
      { error: { code, message: known.en, messageAr: known.ar } },
      { status: known.status },
    );
  }
  console.error('property lifecycle failed', error);
  return NextResponse.json(
    {
      error: {
        code: 'lifecycle_failed',
        message: 'Property lifecycle action failed',
        messageAr: 'تعذر تنفيذ إجراء العقار',
      },
    },
    { status: 500 },
  );
}

/** POST /api/owner/properties/:id/lifecycle — archive | restore | purge (Neon, Next CSRF). */
export async function POST(request: Request, context: Ctx) {
  const { propertyId } = await context.params;

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

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-property-lifecycle', claims.sub, clientIp(request)]),
    limit: 20,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  let action: z.infer<typeof bodySchema>['action'];
  try {
    action = bodySchema.parse(await request.json()).action;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'action must be archive, restore, or purge',
          messageAr: 'الإجراء يجب أن يكون أرشفة أو استعادة أو حذف نهائي',
        },
      },
      { status: 400 },
    );
  }

  try {
    if (action === 'archive') {
      return NextResponse.json(await archivePropertyOnNeon(claims, propertyId));
    }
    if (action === 'restore') {
      return NextResponse.json(await restorePropertyOnNeon(claims, propertyId));
    }
    return NextResponse.json(await purgePropertyOnNeon(claims, propertyId));
  } catch (error) {
    return mapLifecycleError(error);
  }
}
