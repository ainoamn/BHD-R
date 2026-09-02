import { NextResponse } from 'next/server';
import { z } from 'zod';
import { upsertStayInventoryDaySchema, uuidSchema } from '@bhd-r/contracts';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { upsertStayInventoryDayOnNeon } from '@/lib/stay-day-override-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    unitId: uuidSchema,
    payload: upsertStayInventoryDaySchema,
  })
  .strict();

const errorMap: Record<string, { ar: string; en: string; status: number }> = {
  organization_required: { ar: 'اختر مؤسسة أولاً', en: 'Organization required', status: 400 },
  unit_not_found: { ar: 'الوحدة غير موجودة', en: 'Unit not found', status: 404 },
  invalid_rate: { ar: 'مبلغ الإيجار غير صالح', en: 'Invalid rate amount', status: 400 },
};

/** POST /api/owner/stays/day-override — set per-day rate / public note / block. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-stay-day', claims.sub, clientIp(request)]),
    limit: 60,
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
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
  }

  try {
    const day = await upsertStayInventoryDayOnNeon(claims, body.unitId, body.payload);
    return NextResponse.json({ day });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'day_override_failed';
    const known = errorMap[code];
    if (known) {
      return NextResponse.json(
        { error: { code, message: known.en, messageAr: known.ar } },
        { status: known.status },
      );
    }
    console.error('[stay-day-override]', error);
    return NextResponse.json(
      {
        error: {
          code: 'day_override_failed',
          message: 'Could not save day override',
          messageAr: 'تعذّر حفظ سعر/ملاحظة اليوم',
        },
      },
      { status: 500 },
    );
  }
}
