import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { addWorkTaskFollower } from '@/lib/work-task-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ taskId: string }> };

/** POST /api/portal/tasks/:taskId/members — add a follower with a duty. */
export async function POST(request: Request, context: Context) {
  if (!hasDatabaseUrl()) return legalJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  const { taskId } = await context.params;
  if (!z.string().uuid().safeParse(taskId).success) {
    return legalJson({ error: { code: 'not_found' } }, { status: 404 });
  }
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['task.update', 'task.assign'],
    });
    const parsed = z
      .object({
        userId: z.string().uuid(),
        duty: z.enum(['lead', 'executor', 'supervisor', 'viewer']),
      })
      .strict()
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) return legalJson({ error: { code: 'invalid_body' } }, { status: 400 });
    return legalJson(await addWorkTaskFollower(claims, taskId, parsed.data));
  } catch (error) {
    return legalErrorResponse(error, 'update_failed');
  }
}
