import { NextResponse } from 'next/server';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { requireLiveSession } from '@/lib/next-route-guard';
import { createSavedRole } from '@/lib/team-neon';
import {
  readTeamBody,
  savedRoleSchema,
  TEAM_WRITE,
  teamErrorResponse,
  teamWriteGuard,
} from '@/lib/team-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST save a custom role for this organization (owner only). */
export async function POST(request: Request) {
  const claims = await teamWriteGuard(
    request,
    () => requireLiveSession(request, { requireCsrf: true, anyPermission: TEAM_WRITE }),
    20,
  );
  if (claims instanceof NextResponse) return claims;
  const body = await readTeamBody(request, savedRoleSchema);
  if (body instanceof NextResponse) return body;

  try {
    return NextResponse.json(await createSavedRole(claims, body), { status: 201 });
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'create_failed'));
  }
}
