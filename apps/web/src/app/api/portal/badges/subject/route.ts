import { z } from 'zod';
import { resolveAiEndpoint } from '@/lib/ai-chat';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { coachSubject, loadSubjectBadges } from '@/lib/badges-neon';
import { BADGE_SUBJECTS, type BadgeSubject } from '@/lib/badges-shared';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const READ = ['party.read', 'property.read', 'organization.members.read'] as const;

/** GET /api/portal/badges/subject?type=&id= — one subject's awards and progress. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, { anyPermission: READ, orgWide: true });
    const params = new URL(request.url).searchParams;
    const type = params.get('type') ?? '';
    const id = params.get('id') ?? '';
    if (
      !(BADGE_SUBJECTS as readonly string[]).includes(type) ||
      !z.string().uuid().safeParse(id).success
    )
      return contactJson({ error: { code: 'invalid_body' } }, { status: 400 });
    const locale = params.get('locale') === 'en' ? 'en' : 'ar';
    const found = await loadSubjectBadges(claims, type as BadgeSubject, id, locale);
    return contactJson({ badges: found });
  } catch (error) {
    return contactErrorResponse(error, 'load_failed');
  }
}

const coachSchema = z.object({ type: z.enum(BADGE_SUBJECTS), id: z.string().uuid() }).strict();

/** POST /api/portal/badges/subject — AI steps toward the badges this subject has not earned yet. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: READ,
      orgWide: true,
    });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['badge-coach', claims.sub]),
      limit: 10,
      windowMs: 60_000,
    });
    if (!limited.ok) return contactJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const parsed = coachSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return contactJson({ error: { code: 'invalid_body' } }, { status: 400 });
    const ai = resolveAiEndpoint(request.headers.get('x-vercel-oidc-token'));
    return contactJson(await coachSubject(claims, parsed.data.type, parsed.data.id, ai));
  } catch (error) {
    return contactErrorResponse(error, 'ai_failed');
  }
}
