import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { verifySessionToken } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadPendingApprovals } from '@/lib/pending-approvals-neon';
import { EMPTY_PENDING_APPROVALS } from '@/lib/pending-approvals-shared';
import { requireSessionSecret } from '@/lib/runtime-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * GET /api/portal/pending-approvals
 * Contracts and stay booking requests waiting for the viewer's approval — feeds the portal
 * header bell. Viewers without approval permissions get an empty list.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(EMPTY_PENDING_APPROVALS, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }
  let claims: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    claims = await verifySessionToken(token, requireSessionSecret());
  } catch {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }
  try {
    return NextResponse.json(await loadPendingApprovals(claims), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('GET /api/portal/pending-approvals failed', error);
    return NextResponse.json({ error: { code: 'load_failed' } }, { status: 500 });
  }
}
