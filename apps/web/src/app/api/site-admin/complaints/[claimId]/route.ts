import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { CLAIM_MESSAGE_MAX, claimErrorBody } from '@/lib/stay-deposit-claims';
import { resolveDepositComplaint } from '@/lib/stay-deposit-claims-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    outcome: z.enum(['guest', 'host']),
    note: z.string().max(CLAIM_MESSAGE_MAX * 2),
    amount: z.string().max(24).optional(),
  })
  .strict();

/** POST /api/site-admin/complaints/:claimId — the site administration decides a complaint. */
export async function POST(request: Request, context: { params: Promise<{ claimId: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const { claimId } = await context.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    const failed = claimErrorBody('invalid_body');
    return NextResponse.json(failed.body, { status: failed.status });
  }
  try {
    return NextResponse.json(await resolveDepositComplaint(claims, claimId, body));
  } catch (error) {
    const failed = claimErrorBody(error instanceof Error ? error.message : '');
    if (failed.status === 500) console.error('POST /api/site-admin/complaints', error);
    return NextResponse.json(failed.body, { status: failed.status });
  }
}
