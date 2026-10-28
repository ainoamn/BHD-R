import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { saveOwnerLeaseRenewalAutomation } from '@/lib/lease-renewal-automation-neon';
import { sanitizeLeaseRenewalAutomation } from '@/lib/lease-renewal-automation';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  policy: z
    .object({
      enabled: z.boolean(),
      leadDays: z.number().int().min(0).max(365),
      termMonths: z.number().int().min(1).max(120).nullable(),
      minTermMonths: z.number().int().min(1).max(120),
      autoApproveShorterTerm: z.boolean(),
    })
    .nullable(),
});

/** PUT — organization-wide electronic renewal automation. */
export async function PUT(request: Request) {
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'validation_failed' } }, { status: 400 });
  }

  try {
    const policy = parsed.data.policy ? sanitizeLeaseRenewalAutomation(parsed.data.policy) : null;
    const result = await saveOwnerLeaseRenewalAutomation(claims, policy);
    return NextResponse.json(result);
  } catch (error) {
    const code = clientSafeErrorCode(error, 'update_failed');
    return NextResponse.json(
      { error: { code, message: code } },
      { status: statusForSafeCode(code) },
    );
  }
}
