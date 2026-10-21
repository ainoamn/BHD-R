import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { loadPlatformBillingStats } from '@/lib/platform-admin-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/platform/billing — subscription desk stats for platform admins. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    const billing = await loadPlatformBillingStats(claims);
    return NextResponse.json(billing);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    if (mapped.status >= 500) console.error('GET /api/platform/billing', error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
