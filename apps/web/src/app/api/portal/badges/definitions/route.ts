import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { createBadgeDefinition } from '@/lib/badges-neon';
import { createDefinitionSchema } from '@/lib/badges-schemas';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/portal/badges/definitions — a new badge, shield, certificate or medal. */
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
      key: hashRateKey(['badge-define', claims.sub]),
      limit: 20,
      windowMs: 60_000,
    });
    if (!limited.ok) return contactJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const parsed = createDefinitionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return contactJson({ error: { code: 'badge_invalid' } }, { status: 400 });
    return contactJson(await createBadgeDefinition(claims, parsed.data), { status: 201 });
  } catch (error) {
    return contactErrorResponse(error, 'create_failed');
  }
}
