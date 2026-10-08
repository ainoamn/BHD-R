import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { getOwnerStayCalendarOverviewOnNeon } from '@/lib/owner-stays-ops-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z
  .object({
    fromOn: z.iso.date(),
    toOn: z.iso.date(),
    unitId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => {
    const span =
      (Date.parse(`${value.toOn}T00:00:00Z`) - Date.parse(`${value.fromOn}T00:00:00Z`)) /
      86_400_000;
    return span > 0 && span <= 93;
  });

/** GET /api/owner/stays/calendar-overview?fromOn=&toOn=[&unitId=] — bookings across all stay units. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'validation_failed' } }, { status: 400 });
  }

  try {
    const overview = await getOwnerStayCalendarOverviewOnNeon(claims, {
      fromOn: parsed.data.fromOn,
      toOn: parsed.data.toOn,
      unitId: parsed.data.unitId ?? null,
    });
    return NextResponse.json(overview, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'organization_required') {
      return NextResponse.json(
        { error: { code: 'organization_required', messageAr: 'اختر مؤسسة أولاً' } },
        { status: 400 },
      );
    }
    console.error('owner stay calendar overview failed', error);
    return NextResponse.json({ error: { code: 'load_failed' } }, { status: 500 });
  }
}
