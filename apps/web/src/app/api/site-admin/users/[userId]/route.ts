import { z } from 'zod';
import { requireLiveSession } from '@/lib/next-route-guard';
import { setUserSuspended } from '@/lib/site-admin-neon';
import { readJson, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ suspended: z.boolean() }).strict();

/** PATCH /api/site-admin/users/:id — suspend (signs out everywhere) or restore an account. */
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return siteAdminRoute('PATCH /api/site-admin/users', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const body = await readJson(request, (value) => bodySchema.parse(value));
    return { user: await setUserSuspended(claims, userId, body.suspended) };
  });
}
