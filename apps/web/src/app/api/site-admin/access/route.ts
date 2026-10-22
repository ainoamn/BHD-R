import { siteAdminAccess } from '@/lib/site-admin-neon';
import { siteAdminRead } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/site-admin/access — this account's site-admin scopes, or null. */
export function GET(request: Request) {
  return siteAdminRead(request, 'GET /api/site-admin/access', async (claims) => ({
    access: await siteAdminAccess(claims),
  }));
}
