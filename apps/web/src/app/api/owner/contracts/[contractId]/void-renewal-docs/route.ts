import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { voidRenewalForDocumentMismatchOnNeon } from '@/lib/lease-renewal-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ contractId: string }> };

const bodySchema = z.object({
  note: z.string().trim().max(500).optional(),
});

/** POST — void a renewal when uploaded documents do not match. */
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'validation_failed' } }, { status: 400 });
  }

  try {
    const result = await voidRenewalForDocumentMismatchOnNeon(
      claims,
      contractId,
      parsed.data.note,
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
