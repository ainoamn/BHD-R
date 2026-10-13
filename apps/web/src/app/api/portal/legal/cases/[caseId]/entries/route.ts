import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { addLegalEntry } from '@/lib/legal-case-neon';
import { legalCaseId, legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import {
  LEGAL_FILE_MAX_CHARS,
  LEGAL_FILES_MAX,
  LEGAL_MESSAGE_MAX,
  LEGAL_UPDATE_TYPES,
} from '@/lib/legal-case-shared';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Context = { params: Promise<{ caseId: string }> };

const fileSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    dataUrl: z.string().startsWith('data:').max(LEGAL_FILE_MAX_CHARS),
  })
  .strict();
const files = z.array(fileSchema).max(LEGAL_FILES_MAX).default([]);
const when = z.string().datetime({ offset: true }).optional();

const bodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), text: z.string().max(LEGAL_MESSAGE_MAX), files }).strict(),
  z
    .object({
      kind: z.literal('update'),
      type: z.enum(LEGAL_UPDATE_TYPES),
      title: z.string().max(200),
      notes: z.string().max(10_000).optional(),
      occurredAt: when,
      deadlineAt: when,
      files,
    })
    .strict(),
]);

/** POST /api/portal/legal/cases/:caseId/entries — a message or a timeline update, with files. */
export async function POST(request: Request, context: Context) {
  if (!hasDatabaseUrl()) return legalJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  const caseId = await legalCaseId(context.params);
  if (!caseId) return legalJson({ error: { code: 'not_found' } }, { status: 404 });
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['legal.manage', 'legal.case.update'],
    });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['legal-case-entry', claims.sub]),
      limit: 30,
      windowMs: 60_000,
    });
    if (!limited.ok) return legalJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return legalJson({ error: { code: 'invalid_body' } }, { status: 400 });
    return legalJson(await addLegalEntry(claims, caseId, parsed.data), { status: 201 });
  } catch (error) {
    return legalErrorResponse(error, 'create_failed');
  }
}
