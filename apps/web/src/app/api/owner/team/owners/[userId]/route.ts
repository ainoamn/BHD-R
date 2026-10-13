import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { requireLiveSession } from '@/lib/next-route-guard';
import { removePropertyOwner, updatePropertyOwner } from '@/lib/team-neon';
import {
  readTeamBody,
  TEAM_WRITE,
  teamErrorResponse,
  teamWriteGuard,
  uuidParam,
} from '@/lib/team-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    status: z.enum(['active', 'inactive']).optional(),
    partyId: z.string().uuid().optional(),
  })
  .refine((body) => body.status || body.partyId, 'empty');

type Context = { params: Promise<{ userId: string }> };

function guard(request: Request) {
  return teamWriteGuard(request, () =>
    requireLiveSession(request, { requireCsrf: true, anyPermission: TEAM_WRITE }),
  );
}

/** PATCH a building owner's access status or the owner party they are limited to. */
export async function PATCH(request: Request, context: Context) {
  const claims = await guard(request);
  if (claims instanceof NextResponse) return claims;
  const userId = await uuidParam(context.params, 'userId');
  if (!userId) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  const body = await readTeamBody(request, bodySchema);
  if (body instanceof NextResponse) return body;

  try {
    await updatePropertyOwner(claims, userId, {
      ...(body.status ? { status: body.status } : {}),
      ...(body.partyId ? { partyId: body.partyId } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'update_failed'));
  }
}

/** DELETE ends a building owner's portal access (their account stays). */
export async function DELETE(request: Request, context: Context) {
  const claims = await guard(request);
  if (claims instanceof NextResponse) return claims;
  const userId = await uuidParam(context.params, 'userId');
  if (!userId) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  try {
    await removePropertyOwner(claims, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'delete_failed'));
  }
}
