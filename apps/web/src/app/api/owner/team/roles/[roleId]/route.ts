import { NextResponse } from 'next/server';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { requireLiveSession } from '@/lib/next-route-guard';
import { archiveSavedRole, updateSavedRole } from '@/lib/team-neon';
import {
  readTeamBody,
  savedRoleSchema,
  TEAM_WRITE,
  teamErrorResponse,
  teamWriteGuard,
  uuidParam,
} from '@/lib/team-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ roleId: string }> };

function guard(request: Request) {
  return teamWriteGuard(request, () =>
    requireLiveSession(request, { requireCsrf: true, anyPermission: TEAM_WRITE }),
  );
}

/** PATCH rename a saved role or change its permissions; holders refresh at once. */
export async function PATCH(request: Request, context: Context) {
  const claims = await guard(request);
  if (claims instanceof NextResponse) return claims;
  const roleId = await uuidParam(context.params, 'roleId');
  if (!roleId) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  const body = await readTeamBody(request, savedRoleSchema);
  if (body instanceof NextResponse) return body;

  try {
    await updateSavedRole(claims, roleId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'update_failed'));
  }
}

/** DELETE retires a saved role; members who held it lose it. */
export async function DELETE(request: Request, context: Context) {
  const claims = await guard(request);
  if (claims instanceof NextResponse) return claims;
  const roleId = await uuidParam(context.params, 'roleId');
  if (!roleId) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  try {
    await archiveSavedRole(claims, roleId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'delete_failed'));
  }
}
