import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  legalCases,
  memberships,
  parties,
  partyRoles,
  users,
  workflowEvents,
  workTasks,
} from '@bhd-r/db';
import { muscatToday } from '@/lib/tenant-charges-neon';
import { withinViewerTenant } from '@/lib/portal-ops-data';
import type { WorkTaskDetail, WorkTaskEvent, WorkTaskFollower, WorkTaskSummary } from '@/lib/work-task-shared';

export type { WorkTaskDetail, WorkTaskEvent, WorkTaskFollower, WorkTaskSummary };

const OPEN = new Set(['draft', 'pending', 'approved', 'in_progress', 'on_hold']);
const STATUSES = new Set([
  'pending',
  'approved',
  'in_progress',
  'on_hold',
  'completed',
  'cancelled',
  'rejected',
]);

function deny(): never {
  throw new Error('forbidden');
}

function missing(): never {
  throw new Error('not_found');
}

function bad(): never {
  throw new Error('invalid_body');
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function canRead(claims: SessionClaims): boolean {
  return Boolean(claims.organizationId) && hasPermission(claims, 'task.read');
}

function followersFrom(metadata: unknown): WorkTaskFollower[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const rows = (metadata as { followers?: unknown }).followers;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as { userId?: unknown; name?: unknown; duty?: unknown };
    if (typeof item.userId !== 'string' || typeof item.duty !== 'string') return [];
    return [
      {
        userId: item.userId,
        duty: item.duty,
        name: typeof item.name === 'string' && item.name ? item.name : item.userId.slice(0, 8),
      },
    ];
  });
}

export async function listWorkTasks(claims: SessionClaims): Promise<WorkTaskSummary[]> {
  if (!canRead(claims)) deny();
  const orgId = claims.organizationId!;
  const assignee = alias(users, 'work_task_assignee');
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: workTasks.id,
        reference: workTasks.reference,
        title: workTasks.title,
        category: workTasks.category,
        status: workTasks.status,
        priority: workTasks.priority,
        dueAt: workTasks.dueAt,
        assigneeName: assignee.displayName,
      })
      .from(workTasks)
      .leftJoin(assignee, eq(assignee.id, workTasks.assignedToUserId))
      .where(eq(workTasks.organizationId, orgId))
      .orderBy(desc(workTasks.createdAt))
      .limit(200);
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      title: row.title,
      category: row.category,
      status: row.status,
      priority: row.priority,
      dueAt: iso(row.dueAt),
      assigneeName: row.assigneeName,
    }));
  });
}

export async function readWorkTask(
  claims: SessionClaims,
  taskId: string,
): Promise<WorkTaskDetail> {
  if (!canRead(claims)) deny();
  const orgId = claims.organizationId!;
  const assignee = alias(users, 'work_task_assignee');
  const actor = alias(users, 'work_task_actor');
  return withinViewerTenant(claims, async (tx) => {
    const [task] = await tx
      .select({
        id: workTasks.id,
        reference: workTasks.reference,
        title: workTasks.title,
        description: workTasks.description,
        category: workTasks.category,
        status: workTasks.status,
        priority: workTasks.priority,
        dueAt: workTasks.dueAt,
        completedAt: workTasks.completedAt,
        checklist: workTasks.checklist,
        assigneeId: workTasks.assignedToUserId,
        assigneeName: assignee.displayName,
      })
      .from(workTasks)
      .leftJoin(assignee, eq(assignee.id, workTasks.assignedToUserId))
      .where(and(eq(workTasks.organizationId, orgId), eq(workTasks.id, taskId)))
      .limit(1);
    if (!task) missing();

    const events = await tx
      .select({
        id: workflowEvents.id,
        type: workflowEvents.eventType,
        note: workflowEvents.note,
        at: workflowEvents.occurredAt,
        metadata: workflowEvents.metadata,
        actorName: actor.displayName,
      })
      .from(workflowEvents)
      .leftJoin(actor, eq(actor.id, workflowEvents.actorUserId))
      .where(
        and(eq(workflowEvents.organizationId, orgId), eq(workflowEvents.resourceType, 'work_task'), eq(workflowEvents.resourceId, taskId)),
      )
      .orderBy(asc(workflowEvents.occurredAt))
      .limit(200);

    const legalEvent = [...events].reverse().find((event) => event.type === 'task.legal');
    const legalId =
      legalEvent &&
      legalEvent.metadata &&
      typeof legalEvent.metadata === 'object' &&
      typeof (legalEvent.metadata as { legalCaseId?: unknown }).legalCaseId === 'string'
        ? (legalEvent.metadata as { legalCaseId: string }).legalCaseId
        : null;
    const legal = legalId
      ? (
          await tx
            .select({ id: legalCases.id, reference: legalCases.reference })
            .from(legalCases)
            .where(and(eq(legalCases.organizationId, orgId), eq(legalCases.id, legalId)))
            .limit(1)
        )[0]
      : null;
    const created = events.find((event) => event.type === 'task.created');
    const people = await tx
      .select({ userId: users.id, name: users.displayName })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.status, 'active')))
      .orderBy(users.displayName)
      .limit(80);
    const lawyers = await tx
      .select({ id: parties.id, name: parties.displayName })
      .from(parties)
      .innerJoin(
        partyRoles,
        and(
          eq(partyRoles.partyId, parties.id),
          eq(partyRoles.organizationId, orgId),
          eq(partyRoles.roleKey, 'lawyer'),
          eq(partyRoles.status, 'active'),
        ),
      )
      .where(eq(parties.organizationId, orgId))
      .orderBy(parties.displayName)
      .limit(80);
    const seen = new Map<string, { userId: string; name: string }>();
    for (const person of people) {
      if (!seen.has(person.userId)) seen.set(person.userId, person);
    }

    return {
      id: task.id,
      reference: task.reference,
      title: task.title,
      description: task.description,
      category: task.category,
      status: task.status,
      priority: task.priority,
      dueAt: iso(task.dueAt),
      completedAt: iso(task.completedAt),
      assigneeId: task.assigneeId,
      assigneeName: task.assigneeName,
      checklist: task.checklist ?? [],
      followers: followersFrom(created?.metadata),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        note: event.note,
        at: event.at.toISOString(),
        actorName: event.actorName ?? '',
      })),
      legalCase: legal ?? null,
      people: [...seen.values()],
      lawyers,
      canUpdate: hasPermission(claims, 'task.update'),
      canAssign: hasPermission(claims, 'task.assign') || hasPermission(claims, 'task.update'),
      canLegal: hasPermission(claims, 'legal.manage'),
    };
  });
}

export async function replyWorkTask(
  claims: SessionClaims,
  taskId: string,
  note: string,
): Promise<WorkTaskDetail> {
  if (!canRead(claims) || !hasPermission(claims, 'task.update')) deny();
  const text = note.trim().slice(0, 4000);
  if (text.length < 2) bad();
  const orgId = claims.organizationId!;
  await withinViewerTenant(claims, async (tx) => {
    const [task] = await tx
      .select({ id: workTasks.id })
      .from(workTasks)
      .where(and(eq(workTasks.organizationId, orgId), eq(workTasks.id, taskId)))
      .limit(1);
    if (!task) missing();
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'work_task',
      resourceId: taskId,
      eventType: 'task.reply',
      note: text,
      metadata: {},
    });
  });
  return readWorkTask(claims, taskId);
}

export async function updateWorkTask(
  claims: SessionClaims,
  taskId: string,
  input: {
    status?: string | undefined;
    assignedToUserId?: string | null | undefined;
    checklistIndex?: number | undefined;
    checklistDone?: boolean | undefined;
    note?: string | undefined;
  },
): Promise<WorkTaskDetail> {
  if (!canRead(claims)) deny();
  const orgId = claims.organizationId!;
  const note = input.note?.trim().slice(0, 2000) || null;
  await withinViewerTenant(claims, async (tx) => {
    const [task] = await tx
      .select()
      .from(workTasks)
      .where(and(eq(workTasks.organizationId, orgId), eq(workTasks.id, taskId)))
      .limit(1);
    if (!task) missing();

  if (input.status) {
    if (!hasPermission(claims, 'task.update')) deny();
    if (!STATUSES.has(input.status) || input.status === task.status) bad();
    const closing = !OPEN.has(input.status);
    await tx
      .update(workTasks)
      .set({
        status: input.status as typeof task.status,
        completedAt: closing ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(workTasks.id, task.id));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'work_task',
      resourceId: task.id,
      eventType: 'task.status',
      fromStatus: task.status,
      toStatus: input.status,
      note,
      metadata: {},
    });
  }

  if (input.assignedToUserId !== undefined) {
    if (!hasPermission(claims, 'task.assign') && !hasPermission(claims, 'task.update')) deny();
    const userId = input.assignedToUserId;
    if (userId) {
      const [member] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, orgId),
            eq(memberships.userId, userId),
            eq(memberships.status, 'active'),
          ),
        )
        .limit(1);
      if (!member) bad();
    }
    await tx
      .update(workTasks)
      .set({ assignedToUserId: userId, updatedAt: new Date() })
      .where(eq(workTasks.id, task.id));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'work_task',
      resourceId: task.id,
      eventType: 'task.reassigned',
      note,
      metadata: { assignedToUserId: userId },
    });
  }

  if (input.checklistIndex !== undefined) {
    if (!hasPermission(claims, 'task.update')) deny();
    const checklist = [...(task.checklist ?? [])];
    const item = checklist[input.checklistIndex];
    if (!item) bad();
    checklist[input.checklistIndex] = { ...item, done: Boolean(input.checklistDone) };
    await tx
      .update(workTasks)
      .set({ checklist, updatedAt: new Date() })
      .where(eq(workTasks.id, task.id));
  }
  });

  return readWorkTask(claims, taskId);
}

export async function openLegalCaseFromTask(
  claims: SessionClaims,
  taskId: string,
  input: { lawyerPartyId?: string | null | undefined; note?: string | undefined },
): Promise<WorkTaskDetail> {
  if (!canRead(claims) || !hasPermission(claims, 'legal.manage')) deny();
  const orgId = claims.organizationId!;
  await withinViewerTenant(claims, async (tx) => {
  const [task] = await tx
    .select()
    .from(workTasks)
    .where(and(eq(workTasks.organizationId, orgId), eq(workTasks.id, taskId)))
    .limit(1);
  if (!task) missing();
  const prior = await tx
    .select({ metadata: workflowEvents.metadata })
    .from(workflowEvents)
    .where(
      and(
        eq(workflowEvents.organizationId, orgId),
        eq(workflowEvents.resourceType, 'work_task'),
        eq(workflowEvents.resourceId, task.id),
        eq(workflowEvents.eventType, 'task.legal'),
      ),
    )
    .limit(1);
  const existingId =
    prior[0]?.metadata &&
    typeof prior[0].metadata === 'object' &&
    typeof (prior[0].metadata as { legalCaseId?: unknown }).legalCaseId === 'string'
      ? (prior[0].metadata as { legalCaseId: string }).legalCaseId
      : null;
  if (existingId) return;

  let lawyerPartyId: string | null = null;
  if (input.lawyerPartyId) {
    const [lawyer] = await tx
      .select({ id: parties.id })
      .from(parties)
      .innerJoin(
        partyRoles,
        and(
          eq(partyRoles.partyId, parties.id),
          eq(partyRoles.organizationId, orgId),
          eq(partyRoles.roleKey, 'lawyer'),
          eq(partyRoles.status, 'active'),
        ),
      )
      .where(and(eq(parties.organizationId, orgId), eq(parties.id, input.lawyerPartyId)))
      .limit(1);
    if (!lawyer) bad();
    lawyerPartyId = lawyer.id;
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const reference = `LGL-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
  const note = input.note?.trim().slice(0, 2000) || null;
  const [legal] = await tx
    .insert(legalCases)
    .values({
      organizationId: orgId,
      reference,
      caseType: 'collection',
      title: task.title.slice(0, 240),
      description: [task.description, note].filter(Boolean).join('\n\n').slice(0, 8000) || null,
      propertyId: task.propertyId,
      unitId: task.unitId,
      lawyerPartyId,
      assignedToUserId: claims.sub,
      status: 'assessment',
      currency: 'OMR',
      minorUnit: 3,
      openedOn: muscatToday(),
    })
    .returning({ id: legalCases.id, reference: legalCases.reference });
  if (!legal) bad();
  await tx.insert(workflowEvents).values({
    organizationId: orgId,
    actorUserId: claims.sub,
    resourceType: 'work_task',
    resourceId: task.id,
    eventType: 'task.legal',
    note: note ?? `قضية ${legal.reference}`,
    metadata: { legalCaseId: legal.id, reference: legal.reference },
  });
  });
  return readWorkTask(claims, taskId);
}
