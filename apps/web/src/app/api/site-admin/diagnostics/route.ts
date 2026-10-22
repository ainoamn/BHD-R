import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { loadPlatformDiagnostics } from '@/lib/platform-admin-neon';
import { siteAdminAccess } from '@/lib/site-admin-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/site-admin/diagnostics — system health for site owners / managers only. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    const access = await siteAdminAccess(claims);
    if (!access) {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    const diagnostics = await loadPlatformDiagnostics(claims);
    return NextResponse.json(diagnostics);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    if (mapped.status >= 500) console.error('GET /api/site-admin/diagnostics', error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
