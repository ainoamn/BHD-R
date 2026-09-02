import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { getOwnerStayInventoryDaysOnNeon } from '@/lib/owner-stays-ops-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const querySchema = z
  .object({
    unitId: z.string().uuid(),
    fromOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();

/** GET /api/owner/stays/inventory-days?unitId=&fromOn=&toOn= */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: { code: 'db_unconfigured', message: 'DATABASE_URL is not set' } },
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

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'unitId, fromOn, toOn required' } },
      { status: 400 },
    );
  }

  try {
    const calendar = await getOwnerStayInventoryDaysOnNeon(
      claims,
      parsed.data.unitId,
      parsed.data.fromOn,
      parsed.data.toOn,
    );
    return NextResponse.json(calendar);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'load_failed';
    if (code === 'organization_required') {
      return NextResponse.json(
        { error: { code, message: 'Organization required', messageAr: 'اختر مؤسسة أولاً' } },
        { status: 400 },
      );
    }
    if (code === 'stay_unit_not_found') {
      return NextResponse.json(
        { error: { code, message: 'Stay unit not found', messageAr: 'وحدة الإقامة غير موجودة' } },
        { status: 404 },
      );
    }
    console.error('owner stay inventory-days failed', error);
    return NextResponse.json(
      { error: { code: 'load_failed', message: 'Could not load inventory days' } },
      { status: 500 },
    );
  }
}
