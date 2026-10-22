import { z } from 'zod';
import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { LAB_RESET_CATEGORIES } from '@/lib/lab-reset-shared';
import { labResetCounts, labResetPurge } from '@/lib/lab-reset-neon';
import {
  guardErrorResponse,
  requireLiveSession,
  RouteGuardError,
} from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';
import { siteAdminAccess } from '@/lib/site-admin-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Keep at 60 so this route shares the existing Hobby function bucket (120 would add a 13th). */
export const maxDuration = 60;

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

async function requireSiteLabReset(request: Request, opts?: { requireCsrf?: boolean }) {
  const claims = await requireLiveSession(request, {
    requireCsrf: opts?.requireCsrf,
  });
  if (!(await siteAdminAccess(claims))) {
    throw new RouteGuardError(403, 'forbidden');
  }
  return claims;
}

/** GET /api/site-admin/lab-reset — wipeable test-data counts (site console only). */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireSiteLabReset(request);
    return NextResponse.json({ counts: await labResetCounts(claims) });
  } catch (error) {
    return errorJson(error, 'load_failed');
  }
}

/** POST /api/site-admin/lab-reset — purge selected categories for the active org. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireSiteLabReset(request, { requireCsrf: true });
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
