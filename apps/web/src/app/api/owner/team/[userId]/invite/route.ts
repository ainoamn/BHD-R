import { NextResponse } from 'next/server';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { requireLiveSession } from '@/lib/next-route-guard';
import { resendTeamInvite } from '@/lib/team-neon';
import { TEAM_WRITE, teamErrorResponse, teamWriteGuard, uuidParam } from '@/lib/team-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ userId: string }> };

/** POST sends the invitation email again to a member who has not signed in yet. */
export async function POST(request: Request, context: Context) {
  const claims = await teamWriteGuard(
    request,
    () => requireLiveSession(request, { requireCsrf: true, anyPermission: TEAM_WRITE }),
    10,
  );
  if (claims instanceof NextResponse) return claims;
  const userId = await uuidParam(context.params, 'userId');
  if (!userId) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  try {
    return NextResponse.json(await resendTeamInvite(claims, userId));
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'request_failed'));
  }
}
