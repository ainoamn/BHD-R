import { z } from 'zod';
import { requireLiveSession } from '@/lib/next-route-guard';
import { DELEGATE_LIMIT } from '@/lib/site-admin-shared';
import { loadDelegates, saveDelegates } from '@/lib/site-admin-neon';
import { readJson, siteAdminRead, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    delegates: z
      .array(
        z
          .object({
            email: z.string().max(160),
            scopes: z.array(z.string().max(24)).max(10),
            note: z.string().max(120).nullable().optional(),
          })
          .strict(),
      )
      .max(DELEGATE_LIMIT),
  })
  .strict();

/** GET /api/site-admin/delegates — top-level admins and delegates with their scopes. */
export function GET(request: Request) {
  return siteAdminRead(request, 'GET /api/site-admin/delegates', (claims) => loadDelegates(claims));
}

/** PUT /api/site-admin/delegates — replace the delegate list. */
export function PUT(request: Request) {
  return siteAdminRoute('PUT /api/site-admin/delegates', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const body = await readJson(request, (value) => bodySchema.parse(value));
    return saveDelegates(claims, body.delegates);
  });
}
