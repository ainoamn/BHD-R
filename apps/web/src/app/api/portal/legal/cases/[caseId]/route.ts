import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readLegalCase, updateLegalCase } from '@/lib/legal-case-neon';
import { legalCaseId, legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { LEGAL_STAGES } from '@/lib/legal-case-shared';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

type Context = { params: Promise<{ caseId: string }> };

const minor = z.string().regex(/^\d{1,18}$/);
const bodySchema = z
  .object({
    status: z.enum(LEGAL_STAGES).optional(),
    caseNumber: z.string().max(120).nullable().optional(),
    court: z.string().max(200).nullable().optional(),
    nextHearingAt: z.string().datetime({ offset: true }).nullable().optional(),
    claimAmountMinor: minor.optional(),
    recoveredAmountMinor: minor.optional(),
    lawyerPartyId: z.string().uuid().nullable().optional(),
    note: z.string().max(2_000).optional(),
  })
  .strict();

/** GET /api/portal/legal/cases/:caseId — facts, timeline and conversation of one case. */
export async function GET(request: Request, context: Context) {
  if (!hasDatabaseUrl()) return legalJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  const caseId = await legalCaseId(context.params);
  if (!caseId) return legalJson({ error: { code: 'not_found' } }, { status: 404 });
  try {
    const claims = await requireLiveSession(request, {
      anyPermission: ['legal.read', 'legal.case.read'],
    });
    const found = await readLegalCase(claims, caseId);
    if (!found) return legalJson({ error: { code: 'legal_case_not_found' } }, { status: 404 });
    return legalJson(found);
  } catch (error) {
    return legalErrorResponse(error, 'load_failed');
  }
}

/** PATCH /api/portal/legal/cases/:caseId — stage, number, court, hearing, amounts, lawyer. */
export async function PATCH(request: Request, context: Context) {
  if (!hasDatabaseUrl()) return legalJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  const caseId = await legalCaseId(context.params);
  if (!caseId) return legalJson({ error: { code: 'not_found' } }, { status: 404 });
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['legal.manage', 'legal.case.update'],
    });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['legal-case-update', claims.sub]),
      limit: 30,
      windowMs: 60_000,
    });
    if (!limited.ok) return legalJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return legalJson({ error: { code: 'invalid_body' } }, { status: 400 });
    return legalJson(await updateLegalCase(claims, caseId, parsed.data));
  } catch (error) {
    return legalErrorResponse(error, 'update_failed');
  }
}
