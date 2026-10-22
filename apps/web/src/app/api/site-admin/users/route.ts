import { listAdminUsers } from '@/lib/site-admin-neon';
import { siteAdminRead } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/site-admin/users?q= — the newest 100 accounts, or those matching the search. */
export function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') ?? '';
  return siteAdminRead(request, 'GET /api/site-admin/users', async (claims) => ({
    users: await listAdminUsers(claims, query),
  }));
}
