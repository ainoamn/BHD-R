import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadPartyBadges } from '@/lib/badges-neon';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/portal/badges/party/:partyId — the party's badges as owner, tenant and worker. */
export async function GET(request: Request, context: { params: Promise<{ partyId: string }> }) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, {
      anyPermission: ['party.read'],
      orgWide: true,
    });
    const { partyId } = await context.params;
    if (!z.string().uuid().safeParse(partyId).success)
      return contactJson({ error: { code: 'not_found' } }, { status: 404 });
    const locale = new URL(request.url).searchParams.get('locale') === 'en' ? 'en' : 'ar';
    return contactJson({ subjects: await loadPartyBadges(claims, partyId, locale) });
  } catch (error) {
    return contactErrorResponse(error, 'load_failed');
  }
}
