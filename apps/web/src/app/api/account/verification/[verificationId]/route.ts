import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { cancelVerification, renewVerification } from '@/lib/verification-neon';
import { VERIFICATION_PERIODS } from '@/lib/verification-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel') }).strict(),
  z.object({ action: z.literal('renew'), period: z.enum(VERIFICATION_PERIODS) }).strict(),
]);

/** PATCH /api/account/verification/:id — withdraw a pending request, or renew an approved one. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ verificationId: string }> },
) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return contactJson({ error: { code: 'invalid_body' } }, { status: 400 });
    const { verificationId } = await context.params;
    return contactJson(
      parsed.data.action === 'cancel'
        ? await cancelVerification(claims, verificationId)
        : await renewVerification(claims, verificationId, parsed.data.period),
    );
  } catch (error) {
    return contactErrorResponse(error, 'update_failed');
  }
}
