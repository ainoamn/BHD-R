import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadBadgeHolders, updateBadgeDefinition } from '@/lib/badges-neon';
import { updateDefinitionSchema } from '@/lib/badges-schemas';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ badgeId: string }> };

/** GET /api/portal/badges/definitions/:id — the badge and everyone who holds or held it. */
export async function GET(request: Request, context: Context) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, {
      anyPermission: ['party.read', 'property.read', 'organization.members.read'],
      orgWide: true,
    });
    const { badgeId } = await context.params;
    const locale = new URL(request.url).searchParams.get('locale') === 'en' ? 'en' : 'ar';
    return contactJson(await loadBadgeHolders(claims, badgeId, locale));
  } catch (error) {
    return contactErrorResponse(error, 'load_failed');
  }
}

/** PATCH /api/portal/badges/definitions/:id — edit, pause or archive a badge. */
export async function PATCH(request: Request, context: Context) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['organization.members.write'],
      orgWide: true,
    });
    const parsed = updateDefinitionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return contactJson({ error: { code: 'badge_invalid' } }, { status: 400 });
    const { badgeId } = await context.params;
    return contactJson(await updateBadgeDefinition(claims, badgeId, parsed.data));
  } catch (error) {
    return contactErrorResponse(error, 'update_failed');
  }
}
