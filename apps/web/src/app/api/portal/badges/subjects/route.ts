import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { listBadgeSubjects } from '@/lib/badges-neon';
import { BADGE_SUBJECTS, type BadgeSubject } from '@/lib/badges-shared';
import { contactErrorResponse, contactJson } from '@/lib/contacts-route';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/** GET /api/portal/badges/subjects?type= — who a badge of this kind can be granted to. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl())
    return contactJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, {
      anyPermission: ['organization.members.write'],
      orgWide: true,
    });
    const params = new URL(request.url).searchParams;
    const type = params.get('type') ?? '';
    if (!(BADGE_SUBJECTS as readonly string[]).includes(type))
      return contactJson({ error: { code: 'invalid_body' } }, { status: 400 });
    const locale = params.get('locale') === 'en' ? 'en' : 'ar';
    return contactJson({
      subjects: await listBadgeSubjects(claims, type as BadgeSubject, locale),
    });
  } catch (error) {
    return contactErrorResponse(error, 'load_failed');
  }
}
