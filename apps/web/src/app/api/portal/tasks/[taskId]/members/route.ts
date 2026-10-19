import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { addWorkTaskFollower, inviteWorkTaskFollower } from '@/lib/work-task-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ taskId: string }> };

const bodySchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().trim().email().max(320).optional(),
    displayName: z.string().trim().max(160).optional(),
    duty: z.enum(['lead', 'executor', 'supervisor', 'viewer']),
  })
  .strict()
  .refine((body) => Boolean(body.userId) !== Boolean(body.email), {
    message: 'user_or_email',
  });

/** POST /api/portal/tasks/:taskId/members — add a follower (by user id or invite email). */
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
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return legalJson({ error: { code: 'invalid_body' } }, { status: 400 });
    const data = parsed.data;
    if (data.email) {
      return legalJson(
        await inviteWorkTaskFollower(claims, taskId, {
          email: data.email,
          duty: data.duty,
          ...(data.displayName ? { displayName: data.displayName } : {}),
        }),
      );
    }
    return legalJson(
      await addWorkTaskFollower(claims, taskId, { userId: data.userId!, duty: data.duty }),
    );
  } catch (error) {
    return legalErrorResponse(error, 'update_failed');
  }
}
