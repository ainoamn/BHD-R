import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { decideVerification, recordVerificationPayment } from '@/lib/verification-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('pay'),
      method: z.enum(['bank_transfer', 'cash', 'card', 'other']),
      reference: z.string().trim().max(120).nullable(),
    })
    .strict(),
  z
    .object({ action: z.literal('waive'), reference: z.string().trim().max(120).nullable() })
    .strict(),
  z
    .object({
      action: z.literal('approve'),
      nameConfirmed: z.boolean(),
      note: z.string().trim().max(500).nullable(),
    })
    .strict(),
  z.object({ action: z.literal('reject'), note: z.string().trim().min(3).max(500) }).strict(),
]);

/** PATCH /api/site-admin/verification/:id — record the fee, then approve or reject. */
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
    const body = parsed.data;
    switch (body.action) {
      case 'pay':
        return contactJson(
          await recordVerificationPayment(claims, verificationId, {
            waive: false,
            method: body.method,
            reference: body.reference,
          }),
        );
      case 'waive':
        return contactJson(
          await recordVerificationPayment(claims, verificationId, {
            waive: true,
            method: null,
            reference: body.reference,
          }),
        );
      case 'approve':
        return contactJson(
          await decideVerification(claims, verificationId, {
            action: 'approve',
            note: body.note,
            nameConfirmed: body.nameConfirmed,
          }),
        );
      default:
        return contactJson(
          await decideVerification(claims, verificationId, {
            action: 'reject',
            note: body.note,
            nameConfirmed: false,
          }),
        );
    }
  } catch (error) {
    return contactErrorResponse(error, 'update_failed');
  }
}
