import { sendGreetingCampaignNow } from '@/lib/greeting-campaigns-neon';
import { requireLiveSession } from '@/lib/next-route-guard';
import { siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/** POST /api/site-admin/greetings/:id/send — send immediately to the matched audience. */
export function POST(request: Request, { params }: Params) {
  return siteAdminRoute('POST /api/site-admin/greetings/:id/send', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const { id } = await params;
    return sendGreetingCampaignNow(claims, id);
  });
}
