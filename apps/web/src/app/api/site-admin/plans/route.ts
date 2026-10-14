import { z } from 'zod';
import { requireLiveSession } from '@/lib/next-route-guard';
import { PLAN_LIMIT } from '@/lib/site-admin-shared';
import { loadPlansAdmin, savePlanCatalog } from '@/lib/site-admin-neon';
import { readJson, siteAdminRead, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({ plans: z.array(z.record(z.string(), z.unknown())).max(PLAN_LIMIT) })
  .strict();

/** GET /api/site-admin/plans — the plan catalogue and every organization's subscription. */
export function GET(request: Request) {
  return siteAdminRead(request, 'GET /api/site-admin/plans', (claims) => loadPlansAdmin(claims));
}

/** PUT /api/site-admin/plans — save plan names, prices and limits. */
export function PUT(request: Request) {
  return siteAdminRoute('PUT /api/site-admin/plans', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const body = await readJson(request, (value) => bodySchema.parse(value));
    return savePlanCatalog(claims, body.plans);
  });
}
