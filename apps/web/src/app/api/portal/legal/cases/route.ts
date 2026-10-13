import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { listLegalCases } from '@/lib/legal-case-neon';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/** GET /api/portal/legal/cases — every case for the legal team, a lawyer's own cases for them. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) return legalJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  try {
    const claims = await requireLiveSession(request, {
      anyPermission: ['legal.read', 'legal.case.read'],
    });
    return legalJson({ cases: await listLegalCases(claims) });
  } catch (error) {
    return legalErrorResponse(error, 'load_failed');
  }
}
