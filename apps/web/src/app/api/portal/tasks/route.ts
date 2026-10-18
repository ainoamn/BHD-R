import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { legalErrorResponse, legalJson } from '@/lib/legal-case-route';
import { requireLiveSession } from '@/lib/next-route-guard';
import { listSubjectTasks, listWorkTasks } from '@/lib/work-task-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/portal/tasks — tasks the viewer may open. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request, { anyPermission: ['task.read'] });
    const url = new URL(request.url);
    const partyId = url.searchParams.get('partyId') ?? undefined;
    const propertyId = url.searchParams.get('propertyId') ?? undefined;
    const unitId = url.searchParams.get('unitId') ?? undefined;
    const uuid = /^[0-9a-f-]{36}$/i;
    if ((partyId && uuid.test(partyId)) || (propertyId && uuid.test(propertyId)) || (unitId && uuid.test(unitId))) {
      return legalJson({
        tasks: await listSubjectTasks(claims, {
          ...(partyId && uuid.test(partyId) ? { partyId } : {}),
          ...(propertyId && uuid.test(propertyId) && !unitId ? { propertyId } : {}),
          ...(unitId && uuid.test(unitId) ? { unitId } : {}),
        }),
      });
    }
    return legalJson({ tasks: await listWorkTasks(claims) });
  } catch (error) {
    return legalErrorResponse(error, 'load_failed');
  }
}
