import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { loadAccountState } from '@/lib/verification-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/account/state — the signed-in account's picture, verification and history. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request);
    return contactJson(await loadAccountState(claims));
  } catch (error) {
    return contactErrorResponse(error, 'load_failed');
  }
}
