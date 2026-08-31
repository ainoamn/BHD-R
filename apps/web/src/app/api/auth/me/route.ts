import { NextResponse } from 'next/server';
import { getShellViewer } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me — marketing chrome auth from Host-only `bhd_r_session`.
 * Do not use Nest `/v1/me` here: Render cold starts falsely show "sign in"
 * while the owner portal is already authenticated via Neon/JWT.
 */
export async function GET() {
  try {
    const viewer = await getShellViewer();
    if (!viewer) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    return NextResponse.json({
      authenticated: true,
      ...viewer,
    });
  } catch (error) {
    console.error('[auth/me] failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
