import { z } from 'zod';
import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { LAB_RESET_CATEGORIES } from '@/lib/lab-reset-shared';
import { labResetCounts, labResetPurge } from '@/lib/lab-reset-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const purgeSchema = z
  .object({
    categories: z.array(z.enum(LAB_RESET_CATEGORIES)).min(1).max(LAB_RESET_CATEGORIES.length),
    confirm: z.string().trim().min(4).max(40),
  })
  .strict();

function errorJson(error: unknown, fallback: string) {
  const mapped = guardErrorResponse(error);
  if (mapped.status !== 500) {
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const code = clientSafeErrorCode(error, fallback);
  const status =
    code === 'forbidden' ? 403 : code === 'invalid_body' ? 400 : code === 'rate_limited' ? 429 : 500;
  return NextResponse.json({ error: { code } }, { status });
}

/** GET /api/owner/lab-reset — counts of wipeable test data (properties kept). */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request, { anyPermission: ['organization.write'] });
    return NextResponse.json({ counts: await labResetCounts(claims) });
  } catch (error) {
    return errorJson(error, 'load_failed');
  }
}

/** POST /api/owner/lab-reset — permanently delete selected categories for this org. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['organization.write'],
    });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['lab-reset', claims.organizationId ?? claims.sub]),
      limit: 5,
      windowMs: 60_000,
    });
    if (!limited.ok) {
      return NextResponse.json({ error: { code: 'rate_limited' } }, { status: 429 });
    }
    const parsed = purgeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
    }
    return NextResponse.json(await labResetPurge(claims, parsed.data));
  } catch (error) {
    return errorJson(error, 'update_failed');
  }
}
