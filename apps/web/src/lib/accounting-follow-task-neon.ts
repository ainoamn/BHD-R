import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { hasPermission } from '@bhd-r/authz';
import { memberships, users, workflowEvents, workTasks } from '@bhd-r/db';
import { fail } from '@/lib/accounting-gl-neon';
import { withinViewerTenant } from '@/lib/portal-ops-data';

const UUID = /^[0-9a-f-]{36}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set([
  'invoice',
  'receipt',
  'journal',
  'expense',
  'cheque',
  'deposit',
  'payment',
  'ledger',
]);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const OPEN = ['pending', 'approved', 'in_progress', 'on_hold'] as const;

export type AccountingFollowAssignee = {
  userId: string;
  name: string;
  roleKey: string;
};

function canCreateFollowTask(claims: SessionClaims): boolean {
  return (
    Boolean(claims.organizationId) &&
    (hasPermission(claims, 'task.create') || hasPermission(claims, 'accounting.manage'))
  );
}

function reference(): string {
  const now = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  return `TSK-${now}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

export async function listAccountingFollowAssignees(
  claims: SessionClaims,
): Promise<AccountingFollowAssignee[]> {
  if (!canCreateFollowTask(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        userId: users.id,
        name: users.displayName,
        roleKey: memberships.roleKey,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.status, 'active')));
    const seen = new Map<string, AccountingFollowAssignee>();
    for (const row of rows) {
      const current = seen.get(row.userId);
      if (!current) {
        seen.set(row.userId, {
          userId: row.userId,
          name: row.name || row.userId.slice(0, 8),
          roleKey: row.roleKey,
        });
        continue;
      }
      if (!current.roleKey.split(' · ').includes(row.roleKey)) {
        current.roleKey = `${current.roleKey} · ${row.roleKey}`;
      }
    }
    const people = [...seen.values()];
    people.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    return people;
  });
}

export async function createAccountingFollowTask(
  claims: SessionClaims,
  input: {
    kind: string;
    sourceId: string;
    title: string;
    detail?: string | undefined;
    assignedToUserId: string;
    priority?: string | undefined;
    dueOn?: string | undefined;
    note?: string | undefined;
    attachments?: string[] | undefined;
  },
): Promise<{ id: string; reference: string; existing: boolean }> {
  if (!canCreateFollowTask(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const kind = input.kind.trim();
  if (!KINDS.has(kind)) fail('invalid_input');
  const title = input.title.trim().slice(0, 200);
  if (title.length < 2) fail('invalid_input');
  const assignee = input.assignedToUserId.trim();
  if (!UUID.test(assignee)) fail('invalid_input');
  const priority = PRIORITIES.has(input.priority ?? '') ? input.priority! : 'normal';
  const sourceId = input.sourceId.trim().slice(0, 80);
  const relatedType = `acct_${kind}`.slice(0, 60);
  const relatedId = UUID.test(sourceId) ? sourceId : null;
  const dueAt =
    input.dueOn && ISO_DATE.test(input.dueOn) ? new Date(`${input.dueOn}T16:00:00.000Z`) : null;
  const attachments = (input.attachments ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 8);
  const description = [
    input.detail?.trim(),
    input.note?.trim(),
    attachments.length ? `مرفقات: ${attachments.join('، ')}` : '',
    sourceId ? `source:${kind}:${sourceId}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);

  return withinViewerTenant(claims, async (tx) => {
    const member = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, orgId),
          eq(memberships.userId, assignee),
          eq(memberships.status, 'active'),
        ),
      )
      .limit(1);
    if (!member.length) fail('invalid_input');

    if (relatedId) {
      const open = await tx
        .select({ id: workTasks.id, reference: workTasks.reference })
        .from(workTasks)
        .where(
          and(
            eq(workTasks.organizationId, orgId),
            eq(workTasks.relatedType, relatedType),
            eq(workTasks.relatedId, relatedId),
            inArray(workTasks.status, [...OPEN]),
          ),
        )
        .limit(1);
      if (open[0]) return { id: open[0].id, reference: open[0].reference, existing: true };
    }

    const rows = await tx
      .insert(workTasks)
      .values({
        organizationId: orgId,
        reference: reference(),
        title,
        description: description || null,
        category: 'accounting',
        priority: priority as 'low' | 'normal' | 'high' | 'urgent',
        createdByUserId: claims.sub,
        assignedToUserId: assignee,
        relatedType,
        relatedId,
        dueAt,
        checklist: attachments.map((label) => ({ label: label.slice(0, 200), done: false })),
      })
      .returning({ id: workTasks.id, reference: workTasks.reference, status: workTasks.status });
    const row = rows[0];
    if (!row) fail('invalid_input');
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'work_task',
      resourceId: row.id,
      eventType: 'task.created',
      toStatus: row.status,
      note: `accounting:${kind}`,
      metadata: { kind, sourceId },
    });
    return { id: row.id, reference: row.reference, existing: false };
  });
}
