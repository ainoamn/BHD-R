import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { addTeamMember, loadTeam } from '@/lib/team-neon';
import {
  capabilityListSchema,
  readTeamBody,
  roleListSchema,
  TEAM_WRITE,
  teamErrorResponse,
  teamWriteGuard,
} from '@/lib/team-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    email: z.string().trim().min(3).max(320),
    displayName: z.string().trim().max(160).optional(),
    roles: roleListSchema.optional(),
    /** Single role, as sent before members could hold several. */
    role: z.string().min(2).max(80).optional(),
    capabilities: capabilityListSchema.default([]),
  })
  .refine((body) => body.roles || body.role, 'roles');

/** GET the organization team. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  try {
    return NextResponse.json(await loadTeam(claims));
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'request_failed'));
  }
}

/** POST add a team member by email; they join on their first BHD sign-in with that email. */
export async function POST(request: Request) {
  const claims = await teamWriteGuard(
    request,
    () => requireLiveSession(request, { requireCsrf: true, anyPermission: TEAM_WRITE }),
    20,
  );
  if (claims instanceof NextResponse) return claims;
  const body = await readTeamBody(request, bodySchema);
  if (body instanceof NextResponse) return body;

  try {
    const result = await addTeamMember(claims, {
      email: body.email,
      roles: body.roles ?? [body.role!],
      capabilities: body.capabilities,
      ...(body.displayName ? { displayName: body.displayName } : {}),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'create_failed'));
  }
}
