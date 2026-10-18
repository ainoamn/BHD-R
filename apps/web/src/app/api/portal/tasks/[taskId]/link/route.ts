import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { linkWorkTaskSubject } from '@/lib/work-task-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ taskId: string }> };

/** POST /api/portal/tasks/:taskId/link — attach the task to a tenant, building, or unit. */
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
    const parsed = z
      .object({
        kind: z.enum(['party', 'property', 'unit']),
        id: z.string().uuid(),
      })
      .strict()
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) return legalJson({ error: { code: 'invalid_body' } }, { status: 400 });
    return legalJson(await linkWorkTaskSubject(claims, taskId, parsed.data));
  } catch (error) {
    return legalErrorResponse(error, 'update_failed');
  }
}
