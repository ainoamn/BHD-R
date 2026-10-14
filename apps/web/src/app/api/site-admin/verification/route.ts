import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { loadReviewQueue, saveVerificationPlan } from '@/lib/verification-neon';
import { VERIFICATION_KINDS, VERIFICATION_PERIODS } from '@/lib/verification-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/site-admin/verification — requests to review and the verification fees. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request);
    return contactJson(await loadReviewQueue(claims));
  } catch (error) {
    return contactErrorResponse(error, 'load_failed');
  }
}

const planSchema = z
  .object({
    kind: z.enum(VERIFICATION_KINDS),
    period: z.enum(VERIFICATION_PERIODS),
    price: z.string().trim().max(16),
    active: z.boolean(),
  })
  .strict();

/** PUT /api/site-admin/verification — set a monthly or yearly verification fee. */
export async function PUT(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const parsed = planSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return contactJson({ error: { code: 'invalid_amount' } }, { status: 400 });
    return contactJson(await saveVerificationPlan(claims, parsed.data));
  } catch (error) {
    return contactErrorResponse(error, 'update_failed');
  }
}
