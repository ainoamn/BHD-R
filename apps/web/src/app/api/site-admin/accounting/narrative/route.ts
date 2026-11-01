import { requireLiveSession } from '@/lib/next-route-guard';
import { analyzePlatformAccounting } from '@/lib/platform-accounting-ai';
import { loadPlatformAccounting } from '@/lib/platform-accounting-neon';
import { siteAdminRoute } from '@/lib/site-admin-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/site-admin/accounting/narrative — AI/rules analysis for marketing & sorting. */
export async function POST(request: Request) {
  return siteAdminRoute('POST /api/site-admin/accounting/narrative', async () => {
    const claims = await requireLiveSession(request, { requireCsrf: true });
    const view = await loadPlatformAccounting(claims);
    const oidc = request.headers.get('x-vercel-oidc-token');
    return { narrative: await analyzePlatformAccounting(view, oidc) };
  });
}
