import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { grantBadge } from '@/lib/badges-neon';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    badgeId: z.string().uuid(),
    subjectId: z.string().uuid(),
    note: z.string().trim().min(3).max(400),
  })
  .strict();

/** POST /api/portal/badges/awards — grant a badge by hand, with the reason on the certificate. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['organization.members.write'],
      orgWide: true,
    });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['badge-grant', claims.sub]),
      limit: 30,
      windowMs: 60_000,
    });
    if (!limited.ok) return contactJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return contactJson({ error: { code: 'badge_invalid' } }, { status: 400 });
    const { badgeId, subjectId, note } = parsed.data;
    return contactJson(await grantBadge(claims, badgeId, subjectId, note), { status: 201 });
  } catch (error) {
    return contactErrorResponse(error, 'create_failed');
  }
}
