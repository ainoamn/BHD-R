import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { loadPlatformDiagnostics } from '@/lib/platform-admin-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/platform/diagnostics — system health for platform administrators. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    const diagnostics = await loadPlatformDiagnostics(claims);
    return NextResponse.json(diagnostics);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    if (mapped.status >= 500) console.error('GET /api/platform/diagnostics', error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
