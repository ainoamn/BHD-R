import { z } from 'zod';
import {
  redesignGreetingCampaign,
  selectGreetingDesign,
} from '@/lib/greeting-campaigns-neon';
import { requireLiveSession } from '@/lib/next-route-guard';
import { readJson, siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bodySchema = z
  .object({
    changeRequest: z.string().max(500).nullable().optional(),
    selectDesignId: z.string().uuid().optional(),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

/** POST /api/site-admin/greetings/:id/design — regenerate, or select an older version. */
export function POST(request: Request, { params }: Params) {
  return siteAdminRoute('POST /api/site-admin/greetings/:id/design', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const { id } = await params;
    const body = await readJson(request, (value) => bodySchema.parse(value));
    if (body.selectDesignId) {
      return selectGreetingDesign(claims, id, body.selectDesignId);
    }
    return redesignGreetingCampaign(claims, id, body.changeRequest);
  });
}
