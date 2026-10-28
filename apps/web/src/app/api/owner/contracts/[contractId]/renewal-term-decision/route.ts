import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { decideRenewalTermProposalOnNeon } from '@/lib/lease-renewal-automation-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ contractId: string }> };

const bodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional(),
  /** Owner-chosen end date when approving with a modification. */
  endsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** POST — owner approves, modifies, or rejects a tenant renewal-term proposal. */
export async function POST(request: Request, context: RouteContext) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const { contractId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(contractId)) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'validation_failed' } }, { status: 400 });
  }

  try {
    const result = await decideRenewalTermProposalOnNeon(
      claims,
      contractId,
      parsed.data.decision,
      parsed.data.note,
      parsed.data.endsOn,
    );
    return NextResponse.json(result);
  } catch (error) {
    const code = clientSafeErrorCode(error, 'decision_failed');
    return NextResponse.json(
      { error: { code, message: code } },
      { status: statusForSafeCode(code) },
    );
  }
}
