import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { decideAward } from '@/lib/badges-neon';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    action: z.enum(['approve', 'reject', 'revoke']),
    note: z.string().trim().max(400).nullable().optional(),
  })
  .strict();

/** PATCH /api/portal/badges/awards/:id — approve or reject a proposed award, or revoke one. */
export async function PATCH(request: Request, context: { params: Promise<{ awardId: string }> }) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['organization.members.write'],
      orgWide: true,
    });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return contactJson({ error: { code: 'invalid_body' } }, { status: 400 });
    const { awardId } = await context.params;
    return contactJson(
      await decideAward(claims, awardId, parsed.data.action, parsed.data.note ?? null),
    );
  } catch (error) {
    return contactErrorResponse(error, 'update_failed');
  }
}
