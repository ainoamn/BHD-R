import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, hashRateKey } from '@/lib/route-rate-limit';
import { readWorkTask, updateWorkTask } from '@/lib/work-task-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ taskId: string }> };

const STATUSES = [
  'pending',
  'approved',
  'in_progress',
  'on_hold',
  'completed',
  'cancelled',
  'rejected',
] as const;

const bodySchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    assignedToUserId: z.string().uuid().nullable().optional(),
    checklistIndex: z.number().int().min(0).max(40).optional(),
    checklistDone: z.boolean().optional(),
    note: z.string().max(2000).optional(),
  })
  .strict();

async function taskIdOf(params: Promise<{ taskId: string }>): Promise<string | null> {
  const { taskId } = await params;
  return z.string().uuid().safeParse(taskId).success ? taskId : null;
}

/** GET /api/portal/tasks/:taskId — the task, its replies and who follows it. */
export async function GET(request: Request, context: Context) {
  if (!hasDatabaseUrl()) return legalJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  const taskId = await taskIdOf(context.params);
  if (!taskId) return legalJson({ error: { code: 'not_found' } }, { status: 404 });
  try {
    const claims = await requireLiveSession(request, { anyPermission: ['task.read'] });
    return legalJson(await readWorkTask(claims, taskId));
  } catch (error) {
    return legalErrorResponse(error, 'load_failed');
  }
}

/** PATCH /api/portal/tasks/:taskId — status, assignee, or a checklist tick. */
export async function PATCH(request: Request, context: Context) {
  if (!hasDatabaseUrl()) return legalJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  const taskId = await taskIdOf(context.params);
  if (!taskId) return legalJson({ error: { code: 'not_found' } }, { status: 404 });
  try {
    const claims = await requireLiveSession(request, {
      requireCsrf: true,
      anyPermission: ['task.update', 'task.assign'],
    });
    const limited = assertRouteRateLimit({
      key: hashRateKey(['work-task-update', claims.sub]),
      limit: 40,
      windowMs: 60_000,
    });
    if (!limited.ok) return legalJson({ error: { code: 'rate_limited' } }, { status: 429 });
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return legalJson({ error: { code: 'invalid_body' } }, { status: 400 });
    return legalJson(await updateWorkTask(claims, taskId, parsed.data));
  } catch (error) {
    return legalErrorResponse(error, 'update_failed');
  }
}
