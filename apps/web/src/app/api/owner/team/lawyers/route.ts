import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientSafeErrorCode } from '@/lib/client-safe-error';
import { requireLiveSession } from '@/lib/next-route-guard';
import { addLawyer } from '@/lib/team-neon';
import { readTeamBody, TEAM_WRITE, teamErrorResponse, teamWriteGuard } from '@/lib/team-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    email: z.string().trim().min(3).max(320),
    displayName: z.string().trim().max(160).optional(),
    partyId: z.string().uuid().optional(),
    firmName: z.string().trim().max(200).optional(),
    partyType: z.enum(['person', 'company']).optional(),
  })
  .strict();

/** POST give an external lawyer access to the legal cases assigned to their lawyer contact. */
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
    const result = await addLawyer(claims, {
      email: body.email,
      ...(body.displayName ? { displayName: body.displayName } : {}),
      ...(body.partyId ? { partyId: body.partyId } : {}),
      ...(body.firmName ? { firmName: body.firmName } : {}),
      ...(body.partyType ? { partyType: body.partyType } : {}),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return teamErrorResponse(clientSafeErrorCode(error, 'create_failed'));
  }
}
