import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { requireLiveSession } from '@/lib/next-route-guard';
import { addPropertyOwner } from '@/lib/team-neon';
import { readTeamBody, TEAM_WRITE, teamErrorResponse, teamWriteGuard } from '@/lib/team-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().trim().min(3).max(320),
  displayName: z.string().trim().max(160).optional(),
  partyId: z.string().uuid(),
});

/** POST give a building owner portal access limited to their own properties. */
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
    const result = await addPropertyOwner(claims, {
      email: body.email,
      partyId: body.partyId,
      ...(body.displayName ? { displayName: body.displayName } : {}),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'create_failed'));
  }
}
