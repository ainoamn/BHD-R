import { NextResponse } from 'next/server';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import {
  createAccountingFollowTask,
  listAccountingFollowAssignees,
  listAccountingFollowLinks,
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
    const [assignees, tasks] = await Promise.all([
      listAccountingFollowAssignees(claims).catch(() => []),
      listAccountingFollowLinks(claims),
    ]);
    return NextResponse.json(
      { assignees, tasks },
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
      attachments?: string[];
      followers?: Array<{ userId?: string; duty?: string }>;
    } | null;
    const followers = (body?.followers ?? [])
      .filter((row) => row.userId && row.duty)
      .map((row) => ({ userId: row.userId!, duty: row.duty! }));
    if (
      !body?.kind ||
      !body.sourceId ||
      !body.title ||
      (!body.assignedToUserId && !followers.length)
    ) {
      return NextResponse.json({ error: { code: 'invalid_input' } }, { status: 400 });
    }
    const task = await createAccountingFollowTask(claims, {
      kind: body.kind,
      sourceId: body.sourceId,
      title: body.title,
      detail: body.detail,
      assignedToUserId: body.assignedToUserId ?? followers[0]?.userId ?? '',
      priority: body.priority,
      dueOn: body.dueOn,
      note: body.note,
      attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
      followers,
    });
    return NextResponse.json(task, { status: task.existing ? 200 : 201 });
  } catch (error) {
    return accountingErrorResponse(error, 'POST /api/owner/accounting/follow-task');
  }
}
