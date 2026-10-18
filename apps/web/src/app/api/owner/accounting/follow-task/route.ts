import { NextResponse } from 'next/server';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import {
  createAccountingFollowTask,
  listAccountingFollowAssignees,
} from '@/lib/accounting-follow-task-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Team members who can be assigned an accounting follow-up task. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    const assignees = await listAccountingFollowAssignees(claims);
    return NextResponse.json(
      { assignees },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/follow-task');
  }
}

/** Turn an accounting line into a work task for a follower. */
export async function POST(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    const body = (await request.json().catch(() => null)) as {
      kind?: string;
      sourceId?: string;
      title?: string;
      detail?: string;
      assignedToUserId?: string;
      priority?: string;
      dueOn?: string;
      note?: string;
    } | null;
    if (!body?.kind || !body.sourceId || !body.title || !body.assignedToUserId) {
      return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
    }
    const task = await createAccountingFollowTask(claims, {
      kind: body.kind,
      sourceId: body.sourceId,
      title: body.title,
      detail: body.detail,
      assignedToUserId: body.assignedToUserId,
      priority: body.priority,
      dueOn: body.dueOn,
      note: body.note,
    });
    return NextResponse.json(task, { status: task.existing ? 200 : 201 });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/follow-task');
  }
}
