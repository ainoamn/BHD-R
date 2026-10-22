import { z } from 'zod';
import { requireLiveSession } from '@/lib/next-route-guard';
import { loadSitePages, saveSitePages } from '@/lib/site-control-neon';
import { SITE_PAGE_IDS } from '@/lib/site-control-shared';
import { readJson, siteAdminRead, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    pages: z.record(z.enum(SITE_PAGE_IDS), z.boolean()),
  })
  .strict();

/** GET /api/site-admin/site-pages */
export function GET(request: Request) {
  return siteAdminRead(request, 'GET /api/site-admin/site-pages', (claims) =>
    loadSitePages(claims),
  );
}

/** PUT /api/site-admin/site-pages */
export function PUT(request: Request) {
  return siteAdminRoute('PUT /api/site-admin/site-pages', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const body = await readJson(request, (value) => bodySchema.parse(value));
    return saveSitePages(claims, body.pages);
  });
}
