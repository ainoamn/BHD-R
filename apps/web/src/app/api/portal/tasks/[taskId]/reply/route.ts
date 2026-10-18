import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';
import { replyWorkTask } from '@/lib/work-task-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ taskId: string }> };

/** POST /api/portal/tasks/:taskId/reply — a note on the task thread. */
export async function POST(request: Request, context: Context) {
  if (!hasDatabaseUrl()) return legalJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  const { taskId } = await context.params;
  if (!z.string().uuid().safeParse(taskId).success) {
    return legalJson({ error: { code: 'not_found' } }, { status: 404 });
  }
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['task.update'],
    });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['work-task-reply', claims.sub]),
      limit: 30,
      windowMs: 60_000,
    });
    if (!limited.ok) return legalJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const parsed = z
      .object({ note: z.string().min(2).max(4000) })
      .strict()
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) return legalJson({ error: { code: 'invalid_body' } }, { status: 400 });
    return legalJson(await replyWorkTask(claims, taskId, parsed.data.note));
  } catch (error) {
    return legalErrorResponse(error, 'update_failed');
  }
}
