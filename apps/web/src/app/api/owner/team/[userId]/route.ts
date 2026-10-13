import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { requireLiveSession } from '@/lib/next-route-guard';
import { removeTeamMember, updateTeamMember } from '@/lib/team-neon';
import {
  capabilityListSchema,
  readTeamBody,
  roleListSchema,
  TEAM_WRITE,
  teamErrorResponse,
  teamWriteGuard,
  uuidParam,
} from '@/lib/team-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    roles: roleListSchema.optional(),
    role: z.string().min(2).max(80).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    capabilities: capabilityListSchema.optional(),
  })
  .refine((body) => body.roles || body.role || body.status || body.capabilities, 'empty');

type Context = { params: Promise<{ userId: string }> };

function guard(request: Request) {
  return teamWriteGuard(request, () =>
    requireLiveSession(request, { requireCsrf: true, anyPermission: TEAM_WRITE }),
  );
}

/** PATCH a member's roles, status or extra capabilities. */
export async function PATCH(request: Request, context: Context) {
  const claims = await guard(request);
  if (claims instanceof NextResponse) return claims;
  const userId = await uuidParam(context.params, 'userId');
  if (!userId) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  const body = await readTeamBody(request, bodySchema);
  if (body instanceof NextResponse) return body;

  const roles = body.roles ?? (body.role ? [body.role] : undefined);
  try {
    await updateTeamMember(claims, userId, {
      ...(roles ? { roles } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.capabilities ? { capabilities: body.capabilities } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'update_failed'));
  }
}

/** DELETE removes the member from this organization (their account stays). */
export async function DELETE(request: Request, context: Context) {
  const claims = await guard(request);
  if (claims instanceof NextResponse) return claims;
  const userId = await uuidParam(context.params, 'userId');
  if (!userId) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  try {
    await removeTeamMember(claims, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'delete_failed'));
  }
}
