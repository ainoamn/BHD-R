import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  legalCases,
  memberships,
  parties,
  partyRoles,
  properties,
  units,
  users,
  workflowEvents,
  workTasks,
} from '@bhd-r/db';
import { muscatToday } from '@/lib/tenant-charges-neon';
import { withinViewerTenant } from '@/lib/portal-ops-data';
import type {
  WorkTaskChoice,
  WorkTaskDetail,
  WorkTaskEvent,
  WorkTaskFile,
  WorkTaskFollower,
  WorkTaskSubject,
  WorkTaskSummary,
} from '@/lib/work-task-shared';

export type {
  WorkTaskChoice,
  WorkTaskDetail,
  WorkTaskEvent,
  WorkTaskFile,
  WorkTaskFollower,
  WorkTaskSubject,
  WorkTaskSummary,
};

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
        propertyId: workTasks.propertyId,
        unitId: workTasks.unitId,
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
        and(
          eq(workflowEvents.organizationId, orgId),
          eq(workflowEvents.resourceType, 'work_task'),
          eq(workflowEvents.resourceId, taskId),
          ne(workflowEvents.eventType, 'task.file'),
        ),
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
    const created = [...events].reverse().find((event) => event.type === 'task.roster') ?? events.find((event) => event.type === 'task.created');
    const link = [...events].reverse().find((event) => event.type === 'task.link');
    const linkMeta =
      link?.metadata && typeof link.metadata === 'object'
        ? (link.metadata as { kind?: unknown; id?: unknown; label?: unknown })
        : null;
    const subject: WorkTaskSubject | null =
      linkMeta &&
      (linkMeta.kind === 'party' || linkMeta.kind === 'property' || linkMeta.kind === 'unit') &&
      typeof linkMeta.id === 'string'
        ? {
            kind: linkMeta.kind,
            id: linkMeta.id,
            label: typeof linkMeta.label === 'string' ? linkMeta.label : linkMeta.id.slice(0, 8),
          }
        : task.unitId
          ? { kind: 'unit', id: task.unitId, label: task.unitId.slice(0, 8) }
          : task.propertyId
            ? { kind: 'property', id: task.propertyId, label: task.propertyId.slice(0, 8) }
            : null;
    const fileRows = await tx.execute<{ id: string; name: string | null }>(sql`
      select id::text as id, metadata->>'name' as name
      from workflow_events
      where organization_id = ${orgId}
        and resource_type = 'work_task'
        and resource_id = ${taskId}
        and event_type = 'task.file'
      order by occurred_at
      limit 12
    `);
    const fileList = (Array.isArray(fileRows) ? fileRows : ((fileRows as { rows?: unknown[] }).rows ?? [])) as Array<{
      id: string;
      name: string | null;
    }>;
    const [partyChoices, propertyChoices, unitChoices] = await Promise.all([
      tx
        .select({ id: parties.id, label: parties.displayName })
        .from(parties)
        .where(eq(parties.organizationId, orgId))
        .orderBy(parties.displayName)
        .limit(200),
      tx
        .select({ id: properties.id, label: properties.nameAr })
        .from(properties)
        .where(eq(properties.organizationId, orgId))
        .orderBy(properties.nameAr)
        .limit(200),
      tx
        .select({ id: units.id, label: units.code, propertyId: units.propertyId, name: units.nameAr })
        .from(units)
        .where(eq(units.organizationId, orgId))
        .orderBy(units.code)
        .limit(400),
    ]);
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
      files: fileList.map((file) => ({ id: file.id, name: file.name || 'file' })),
      subject,
      parties: partyChoices,
      properties: propertyChoices,
      units: unitChoices.map((unit) => ({
        id: unit.id,
        label: `${unit.label} · ${unit.name}`,
        propertyId: unit.propertyId,
      })),
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

const DUTIES = new Set(['lead', 'executor', 'supervisor', 'viewer']);
const FILE_DATA = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/]+={0,2}$/i;

function sqlRows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

export async function addWorkTaskFollower(
  claims: SessionClaims,
  taskId: string,
  input: { userId: string; duty: string },
): Promise<WorkTaskDetail> {
  if (!canRead(claims) || (!hasPermission(claims, 'task.assign') && !hasPermission(claims, 'task.update'))) deny();
  const duty = DUTIES.has(input.duty) ? input.duty : '';
  if (!duty) bad();
  const orgId = claims.organizationId!;
  await withinViewerTenant(claims, async (tx) => {
    const current = await readRoster(tx, orgId, taskId);
    const [member] = await tx
      .select({ userId: users.id, name: users.displayName })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, orgId),
          eq(memberships.userId, input.userId),
          eq(memberships.status, 'active'),
        ),
      )
      .limit(1);
    if (!member) bad();
    const next = current.filter((person) => person.userId !== member.userId);
    if (duty === 'lead') {
      for (const person of next) {
        if (person.duty === 'lead') person.duty = 'supervisor';
      }
    }
    next.push({ userId: member.userId, name: member.name, duty });
    await tx
      .update(workTasks)
      .set({
        assignedToUserId: next.find((person) => person.duty === 'lead')?.userId ?? member.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(workTasks.organizationId, orgId), eq(workTasks.id, taskId)));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'work_task',
      resourceId: taskId,
      eventType: 'task.roster',
      note: `${member.name}: ${duty}`,
      metadata: { followers: next },
    });
  });
  return readWorkTask(claims, taskId);
}

async function readRoster(
  tx: Parameters<Parameters<typeof withinViewerTenant>[1]>[0],
  orgId: string,
  taskId: string,
): Promise<WorkTaskFollower[]> {
  const [task] = await tx
    .select({ id: workTasks.id })
    .from(workTasks)
    .where(and(eq(workTasks.organizationId, orgId), eq(workTasks.id, taskId)))
    .limit(1);
  if (!task) missing();
  const events = await tx
    .select({ type: workflowEvents.eventType, metadata: workflowEvents.metadata })
    .from(workflowEvents)
    .where(
      and(
        eq(workflowEvents.organizationId, orgId),
        eq(workflowEvents.resourceType, 'work_task'),
        eq(workflowEvents.resourceId, taskId),
      ),
    )
    .orderBy(desc(workflowEvents.occurredAt))
    .limit(40);
  const roster =
    events.find((event) => event.type === 'task.roster') ??
    events.find((event) => event.type === 'task.created');
  return followersFrom(roster?.metadata);
}

export async function attachWorkTaskFile(
  claims: SessionClaims,
  taskId: string,
  input: { name: string; data: string },
): Promise<WorkTaskDetail> {
  if (!canRead(claims) || !hasPermission(claims, 'task.update')) deny();
  const name = input.name.trim().slice(0, 180);
  const data = input.data.trim();
  if (name.length < 1 || data.length > 1_200_000 || !FILE_DATA.test(data)) bad();
  const orgId = claims.organizationId!;
  await withinViewerTenant(claims, async (tx) => {
    const [task] = await tx
      .select({ id: workTasks.id })
      .from(workTasks)
      .where(and(eq(workTasks.organizationId, orgId), eq(workTasks.id, taskId)))
      .limit(1);
    if (!task) missing();
    const existing = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count from workflow_events
      where organization_id = ${orgId} and resource_type = 'work_task'
        and resource_id = ${taskId} and event_type = 'task.file'
    `);
    const count = sqlRows<{ count: number }>(existing)[0]?.count ?? 0;
    if (Number(count) >= 8) bad();
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'work_task',
      resourceId: taskId,
      eventType: 'task.file',
      note: name,
      metadata: { name, data },
    });
  });
  return readWorkTask(claims, taskId);
}

export async function readWorkTaskFile(
  claims: SessionClaims,
  taskId: string,
  fileId: string,
): Promise<{ name: string; mime: string; bytes: Buffer } | null> {
  if (!canRead(claims)) return null;
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const [row] = await tx
      .select({ metadata: workflowEvents.metadata })
      .from(workflowEvents)
      .where(
        and(
          eq(workflowEvents.id, fileId),
          eq(workflowEvents.organizationId, orgId),
          eq(workflowEvents.resourceType, 'work_task'),
          eq(workflowEvents.resourceId, taskId),
          eq(workflowEvents.eventType, 'task.file'),
        ),
      )
      .limit(1);
    const meta = row?.metadata as { name?: unknown; data?: unknown } | undefined;
    const data = typeof meta?.data === 'string' ? meta.data : '';
    const matched = /^data:([^;]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(data);
    if (!matched?.[2]) return null;
    return {
      name: typeof meta?.name === 'string' ? meta.name : 'file',
      mime: matched[1] || 'application/octet-stream',
      bytes: Buffer.from(matched[2], 'base64'),
    };
  });
}

export async function linkWorkTaskSubject(
  claims: SessionClaims,
  taskId: string,
  input: { kind: 'party' | 'property' | 'unit'; id: string },
): Promise<WorkTaskDetail> {
  if (!canRead(claims) || !hasPermission(claims, 'task.update')) deny();
  const orgId = claims.organizationId!;
  await withinViewerTenant(claims, async (tx) => {
    const [task] = await tx
      .select({ id: workTasks.id })
      .from(workTasks)
      .where(and(eq(workTasks.organizationId, orgId), eq(workTasks.id, taskId)))
      .limit(1);
    if (!task) missing();
    let label = '';
    let propertyId: string | null = null;
    let unitId: string | null = null;
    let partyId: string | null = null;
    if (input.kind === 'party') {
      const [party] = await tx
        .select({ id: parties.id, name: parties.displayName })
        .from(parties)
        .where(and(eq(parties.organizationId, orgId), eq(parties.id, input.id)))
        .limit(1);
      if (!party) bad();
      label = party.name;
      partyId = party.id;
    } else if (input.kind === 'property') {
      const [property] = await tx
        .select({ id: properties.id, name: properties.nameAr })
        .from(properties)
        .where(and(eq(properties.organizationId, orgId), eq(properties.id, input.id)))
        .limit(1);
      if (!property) bad();
      label = property.name;
      propertyId = property.id;
    } else {
      const [unit] = await tx
        .select({
          id: units.id,
          code: units.code,
          name: units.nameAr,
          propertyId: units.propertyId,
        })
        .from(units)
        .where(and(eq(units.organizationId, orgId), eq(units.id, input.id)))
        .limit(1);
      if (!unit) bad();
      label = `${unit.code} · ${unit.name}`;
      unitId = unit.id;
      propertyId = unit.propertyId;
    }
    await tx
      .update(workTasks)
      .set({ propertyId, unitId, updatedAt: new Date() })
      .where(eq(workTasks.id, task.id));
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'work_task',
      resourceId: task.id,
      eventType: 'task.link',
      note: label,
      metadata: { kind: input.kind, id: input.id, label, partyId },
    });
  });
  return readWorkTask(claims, taskId);
}

export async function listSubjectTasks(
  claims: SessionClaims,
  filter: { partyId?: string; propertyId?: string; unitId?: string },
): Promise<Array<{ id: string; reference: string; title: string; status: string }>> {
  if (!canRead(claims)) deny();
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    if (filter.unitId) {
      return tx
        .select({
          id: workTasks.id,
          reference: workTasks.reference,
          title: workTasks.title,
          status: workTasks.status,
        })
        .from(workTasks)
        .where(and(eq(workTasks.organizationId, orgId), eq(workTasks.unitId, filter.unitId)))
        .orderBy(desc(workTasks.createdAt))
        .limit(40);
    }
    if (filter.propertyId) {
      return tx
        .select({
          id: workTasks.id,
          reference: workTasks.reference,
          title: workTasks.title,
          status: workTasks.status,
        })
        .from(workTasks)
        .where(and(eq(workTasks.organizationId, orgId), eq(workTasks.propertyId, filter.propertyId)))
        .orderBy(desc(workTasks.createdAt))
        .limit(40);
    }
    if (!filter.partyId) return [];
    const result = await tx.execute<{ id: string; reference: string; title: string; status: string }>(sql`
      select t.id::text as id, t.reference, t.title, t.status::text as status
      from work_tasks t
      join lateral (
        select metadata from workflow_events e
        where e.organization_id = t.organization_id
          and e.resource_type = 'work_task'
          and e.resource_id = t.id
          and e.event_type = 'task.link'
        order by e.occurred_at desc
        limit 1
      ) link on true
      where t.organization_id = ${orgId}
        and link.metadata->>'partyId' = ${filter.partyId}
      order by t.created_at desc
      limit 40
    `);
    return sqlRows(result);
  });
}
