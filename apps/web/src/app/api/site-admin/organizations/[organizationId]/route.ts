import { z } from 'zod';
import { requireLiveSession } from '@/lib/next-route-guard';
import { SUBSCRIPTION_STATUSES } from '@/lib/site-admin-shared';
import { updateOrganizationSubscription } from '@/lib/site-admin-neon';
import { readJson, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    planKey: z.string().min(2).max(24),
    status: z.enum(SUBSCRIPTION_STATUSES),
    endsOn: z.string().max(10).nullable(),
    note: z.string().max(200).nullable(),
  })
  .strict();

/** PATCH /api/site-admin/organizations/:id — change an organization's plan and subscription. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const { organizationId } = await params;
  return siteAdminRoute('PATCH /api/site-admin/organizations', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const body = await readJson(request, (value) => bodySchema.parse(value));
    return { organization: await updateOrganizationSubscription(claims, organizationId, body) };
  });
}
