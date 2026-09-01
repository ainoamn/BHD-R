import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createStayProfilesSchema,
  createStayUnitTypeSchema,
  updateStayProfileSchema,
  upsertStayPublicListingSchema,
  upsertStayRatePlanSchema,
  uuidSchema,
} from '@bhd-r/contracts';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import {
  createStayProfilesOnNeon,
  createStayUnitTypeOnNeon,
  publishStayProfileOnNeon,
  updateStayProfileOnNeon,
  upsertStayListingOnNeon,
  upsertStayRatePlanOnNeon,
} from '@/lib/stay-setup-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Drizzle returns bigint for money columns — JSON.stringify throws without this. */
function setupJson(data: unknown, init?: ResponseInit) {
  return new NextResponse(
    JSON.stringify(data, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    },
  );
}

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_unit_type'), payload: createStayUnitTypeSchema }),
  z.object({ action: z.literal('create_profiles'), payload: createStayProfilesSchema }),
  z
    .object({
      action: z.literal('update_profile'),
      profileId: uuidSchema,
      payload: updateStayProfileSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('upsert_rate_plan'),
      profileId: uuidSchema,
      payload: upsertStayRatePlanSchema,
    })
    .strict(),
  z.object({ action: z.literal('upsert_listing'), payload: upsertStayPublicListingSchema }),
  z.object({ action: z.literal('publish_profile'), profileId: uuidSchema }).strict(),
]);

const errorMap: Record<string, { ar: string; en: string; status: number }> = {
  organization_required: { ar: 'اختر مؤسسة أولاً', en: 'Organization required', status: 400 },
  property_not_found: { ar: 'العقار غير موجود', en: 'Property not found', status: 404 },
  stay_unit_type_not_found: {
    ar: 'نوع الوحدة غير موجود',
    en: 'Stay unit type not found',
    status: 404,
  },
  stay_profile_not_found: { ar: 'ملف الإقامة غير موجود', en: 'Stay profile not found', status: 404 },
  invalid_units_for_property: {
    ar: 'واحدة أو أكثر من الوحدات غير صالحة لهذا العقار',
    en: 'One or more units are invalid for this property',
    status: 409,
  },
  rate_plan_currency_mismatch: {
    ar: 'عملة السعر يجب أن تطابق عملة ملف الإقامة',
    en: 'Rate plan currency must match stay profile currency',
    status: 409,
  },
  rate_plan_required_before_publish: {
    ar: 'أضف سعراً ليلياً قبل النشر',
    en: 'Add a nightly rate before publishing',
    status: 409,
  },
  listing_required_before_publish: {
    ar: 'أضف محتوى الإعلان قبل النشر',
    en: 'Add public listing content before publishing',
    status: 409,
  },
  unit_not_found: { ar: 'الوحدة غير موجودة', en: 'Unit not found', status: 404 },
};

function mapError(error: unknown) {
  const code = error instanceof Error ? error.message : 'setup_failed';
  const known = errorMap[code];
  if (known) {
    return NextResponse.json(
      { error: { code, message: known.en, messageAr: known.ar } },
      { status: known.status },
    );
  }
  console.error('stay setup mutation failed', error);
  return NextResponse.json(
    {
      error: {
        code: 'setup_failed',
        message: 'Stay setup action failed',
        messageAr: 'تعذر تنفيذ إجراء الإعداد',
      },
    },
    { status: 500 },
  );
}

/** POST /api/owner/stays/setup — Neon writes with Vercel CSRF. */
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

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-stays-setup', claims.sub, clientIp(request)]),
    limit: 40,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Invalid stay setup payload',
          messageAr: 'بيانات الإعداد غير صالحة',
        },
      },
      { status: 400 },
    );
  }

  try {
    switch (body.action) {
      case 'create_unit_type':
        return setupJson(await createStayUnitTypeOnNeon(claims, body.payload));
      case 'create_profiles':
        return setupJson(await createStayProfilesOnNeon(claims, body.payload));
      case 'update_profile':
        return setupJson(await updateStayProfileOnNeon(claims, body.profileId, body.payload));
      case 'upsert_rate_plan':
        return setupJson(await upsertStayRatePlanOnNeon(claims, body.profileId, body.payload));
      case 'upsert_listing':
        return setupJson(await upsertStayListingOnNeon(claims, body.payload));
      case 'publish_profile':
        return setupJson(await publishStayProfileOnNeon(claims, body.profileId));
      default:
        return NextResponse.json(
          { error: { code: 'unknown_action', message: 'Unknown action' } },
          { status: 400 },
        );
    }
  } catch (error) {
    return mapError(error);
  }
}
