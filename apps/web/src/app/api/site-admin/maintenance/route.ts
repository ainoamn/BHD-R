import { z } from 'zod';
import { requireLiveSession } from '@/lib/next-route-guard';
import { loadMaintenance, saveMaintenance } from '@/lib/site-control-neon';
import { readJson, siteAdminRead, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['banner', 'hard']),
    messageAr: z.string().max(500),
    messageEn: z.string().max(500),
  })
  .strict();

/** GET /api/site-admin/maintenance */
export function GET(request: Request) {
  return siteAdminRead(request, 'GET /api/site-admin/maintenance', (claims) =>
    loadMaintenance(claims),
  );
}

/** PUT /api/site-admin/maintenance */
export function PUT(request: Request) {
  return siteAdminRoute('PUT /api/site-admin/maintenance', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const body = await readJson(request, (value) => bodySchema.parse(value));
    return saveMaintenance(claims, body);
  });
}
