import { z } from 'zod';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { readWorkTaskFile } from '@/lib/work-task-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ taskId: string; fileId: string }> };

/** GET /api/portal/tasks/:taskId/files/:fileId — download one task attachment. */
export async function GET(request: Request, context: Context) {
  if (!hasDatabaseUrl()) return legalJson({ error: { code: 'db_unconfigured' } }, { status: 503 });
  const { taskId, fileId } = await context.params;
  if (!z.string().uuid().safeParse(taskId).success || !z.string().uuid().safeParse(fileId).success) {
    return legalJson({ error: { code: 'not_found' } }, { status: 404 });
  }
  try {
    const claims = await requireLiveSession(request, { anyPermission: ['task.read'] });
    const file = await readWorkTaskFile(claims, taskId, fileId);
    if (!file) return legalJson({ error: { code: 'not_found' } }, { status: 404 });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'content-type': file.mime,
        'content-disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return legalErrorResponse(error, 'load_failed');
  }
}
