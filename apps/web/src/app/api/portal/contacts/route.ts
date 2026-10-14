import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { listContacts } from '@/lib/contacts-neon';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/** GET /api/portal/contacts — the address book with each party's roles and links. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, { anyPermission: ['party.read'] });
    return contactJson({ contacts: await listContacts(claims) });
  } catch (error) {
    return contactErrorResponse(error, 'load_failed');
  }
}
