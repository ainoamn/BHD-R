import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { attachWorkTaskFile } from '@/lib/work-task-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Context = { params: Promise<{ taskId: string }> };

/** POST /api/portal/tasks/:taskId/files — store one attachment on the task. */
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
        name: z.string().min(1).max(180),
        data: z.string().min(16).max(1_200_000),
      })
      .strict()
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) return legalJson({ error: { code: 'invalid_body' } }, { status: 400 });
    return legalJson(await attachWorkTaskFile(claims, taskId, parsed.data));
  } catch (error) {
    return legalErrorResponse(error, 'update_failed');
  }
}
