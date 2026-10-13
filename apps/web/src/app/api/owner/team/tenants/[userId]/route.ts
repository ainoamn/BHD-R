import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { requireLiveSession } from '@/lib/next-route-guard';
import { setTenantAccess } from '@/lib/team-neon';
import {
  readTeamBody,
  TEAM_WRITE,
  teamErrorResponse,
  teamWriteGuard,
  uuidParam,
} from '@/lib/team-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ status: z.enum(['active', 'inactive']) });

type Context = { params: Promise<{ userId: string }> };

/** PATCH pause or restore a tenant's portal access in this organization. */
export async function PATCH(request: Request, context: Context) {
  const claims = await teamWriteGuard(request, () =>
    requireLiveSession(request, { requireCsrf: true, anyPermission: TEAM_WRITE }),
  );
  if (claims instanceof NextResponse) return claims;
  const userId = await uuidParam(context.params, 'userId');
  if (!userId) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  const body = await readTeamBody(request, bodySchema);
  if (body instanceof NextResponse) return body;

  try {
    await setTenantAccess(claims, userId, body.status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'update_failed'));
  }
}
