import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { loadPlatformSecurity } from '@/lib/platform-admin-neon';
import { siteAdminAccess } from '@/lib/site-admin-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/security — legacy alias.
 * Prefer /api/site-admin/security; both require site-console access.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    if (!(await siteAdminAccess(claims))) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    const security = await loadPlatformSecurity(claims);
    return NextResponse.json(security);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    if (mapped.status >= 500) console.error('GET /api/platform/security', error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
