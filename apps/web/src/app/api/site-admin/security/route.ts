import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { loadPlatformSecurity } from '@/lib/platform-admin-neon';
import { readJson, siteAdminRoute } from '@/lib/site-admin-route';
import { siteAdminAccess } from '@/lib/site-admin-neon';
import {
  hashIpAddress,
  lockUserAccount,
  quarantineIp,
  releaseIpQuarantine,
  unlockUserAccount,
} from '@/lib/security-protection';
import { SECURITY_THRESHOLDS } from '@/lib/security-protection-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/site-admin/security — audit / sessions / threats for site owners. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    const access = await siteAdminAccess(claims);
    if (!access) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    const security = await loadPlatformSecurity(claims);
    return NextResponse.json(security);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    if (mapped.status >= 500) console.error('GET /api/site-admin/security', error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('quarantine_ip'),
    ipAddress: z.string().min(3).max(64),
    reason: z.string().min(3).max(160).optional(),
    hours: z.number().int().min(1).max(168).optional(),
  }),
  z.object({
    action: z.literal('release_quarantine'),
    quarantineId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('lock_user'),
    userId: z.string().uuid(),
    reason: z.string().min(3).max(160).optional(),
  }),
  z.object({
    action: z.literal('unlock_user'),
    userId: z.string().uuid(),
    lockId: z.string().uuid().optional(),
  }),
]);

/** POST /api/site-admin/security — quarantine / lock / unlock actions. */
export async function POST(request: Request) {
  return siteAdminRoute('POST /api/site-admin/security', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const access = await siteAdminAccess(claims);
    if (!access) throw Object.assign(new Error('forbidden'), { status: 403 });

    const body = await readJson(request, (value) => actionSchema.parse(value));

    if (body.action === 'quarantine_ip') {
      const hours = body.hours ?? Math.round(SECURITY_THRESHOLDS.ipQuarantineMs / 3_600_000);
      const result = await quarantineIp({
        ipAddress: body.ipAddress,
        ipHash: hashIpAddress(body.ipAddress),
        reason: body.reason ?? 'manual_admin_quarantine',
        untilAt: new Date(Date.now() + hours * 3_600_000),
        createdByUserId: claims.sub,
      });
      return { ok: true as const, quarantine: result };
    }

    if (body.action === 'release_quarantine') {
      await releaseIpQuarantine({ quarantineId: body.quarantineId, actorUserId: claims.sub });
      return { ok: true as const };
    }

    if (body.action === 'lock_user') {
      const result = await lockUserAccount({
        userId: body.userId,
        reason: body.reason ?? 'manual_admin_lock',
      });
      return { ok: true as const, lock: result };
    }

    await unlockUserAccount({
      userId: body.userId,
      unlockedBy: 'admin',
      lockId: body.lockId ?? null,
    });
    return { ok: true as const };
  });
}
