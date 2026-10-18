import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { listWorkTasks } from '@/lib/work-task-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/portal/tasks — tasks the viewer may open. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request, { anyPermission: ['task.read'] });
    return legalJson({ tasks: await listWorkTasks(claims) });
  } catch (error) {
    return legalErrorResponse(error, 'load_failed');
  }
}
