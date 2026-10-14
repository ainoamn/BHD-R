import { resolveAiEndpoint } from '@/lib/ai-chat';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { runBadgeEvaluation } from '@/lib/badges-neon';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/portal/badges/evaluate — re-measure everyone now instead of waiting for tonight. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['organization.members.write'],
      orgWide: true,
    });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['badge-evaluate', claims.organizationId ?? claims.sub]),
      limit: 4,
      windowMs: 60_000,
    });
    if (!limited.ok) return contactJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const ai = resolveAiEndpoint(request.headers.get('x-vercel-oidc-token'));
    return contactJson(await runBadgeEvaluation(claims, ai));
  } catch (error) {
    return contactErrorResponse(error, 'update_failed');
  }
}
