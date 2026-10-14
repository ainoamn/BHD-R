import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadBadgesCenter } from '@/lib/badges-neon';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/portal/badges — the organization's badges, awards awaiting approval and recent ones. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, {
      anyPermission: ['party.read', 'property.read', 'organization.members.read'],
      orgWide: true,
    });
    const locale = new URL(request.url).searchParams.get('locale') === 'en' ? 'en' : 'ar';
    return contactJson(await loadBadgesCenter(claims, locale));
  } catch (error) {
    return contactErrorResponse(error, 'load_failed');
  }
}
