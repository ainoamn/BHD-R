import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { saveContractRenewalAutomationOverride } from '@/lib/lease-renewal-automation-neon';
import { sanitizeLeaseRenewalOverride } from '@/lib/lease-renewal-automation';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ contractId: string }> };

const bodySchema = z.object({
  override: z
    .object({
      enabled: z.boolean().nullable().optional(),
      leadDays: z.number().int().min(0).max(365).nullable().optional(),
      termMonths: z.number().int().min(1).max(120).nullable().optional(),
      minTermMonths: z.number().int().min(1).max(120).nullable().optional(),
      autoApproveShorterTerm: z.boolean().nullable().optional(),
    })
    .nullable(),
});

/** PUT — per signed contract override for electronic renewal automation. */
export async function PUT(request: Request, context: RouteContext) {
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
    const result = await saveContractRenewalAutomationOverride(
      claims,
      contractId,
      parsed.data.override ? sanitizeLeaseRenewalOverride(parsed.data.override) : null,
    );
    return NextResponse.json(result);
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    return NextResponse.json(
      { error: { code, message: code } },
      { status: statusForSafeCode(code) },
    );
  }
}
