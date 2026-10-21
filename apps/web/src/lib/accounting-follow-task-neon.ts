import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { hasPermission, rolePermissions, type RoleKey } from '@bhd-r/authz';
import { memberships, users, workflowEvents, workTasks, type Database } from '@bhd-r/db';
import { fail } from '@/lib/accounting-gl-neon';
import { withinViewerTenant } from '@/lib/portal-ops-data';
import { ensureAccountingPlace } from '@/lib/work-task-neon';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const PAY_REFUND_ROLES = (Object.entries(rolePermissions) as Array<[RoleKey, readonly string[]]>)
  .filter(([, perms]) => perms.includes('payment.refund'))
  .map(([role]) => role);

const PARTNER_ROLES: RoleKey[] = ['organization_owner', 'property_manager', 'property_owner'];

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
export type AccountingFollowAssignee = {
  userId: string;
  name: string;
  roleKey: string;
};

export type AccountingFollowLink = {
  id: string;
  reference: string;
  title: string;
  status: string;
  kind: string;
  sourceId: string;
  updatedAt: string;
  open: boolean;
};

const TASK_OPEN = new Set(['draft', 'pending', 'approved', 'in_progress', 'on_hold']);

export function accountingTaskIsOpen(status: string): boolean {
  return TASK_OPEN.has(status);
}

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

/** Accounting lines already turned into a task. One row per source, newest first. */
export async function listAccountingFollowLinks(
  claims: SessionClaims,
): Promise<AccountingFollowLink[]> {
  if (!claims.organizationId) fail('forbidden');
  if (
    !hasPermission(claims, 'accounting.read') &&
    !hasPermission(claims, 'task.read') &&
    !canCreateFollowTask(claims)
  ) {
    fail('forbidden');
  }
  const orgId = claims.organizationId;
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: workTasks.id,
        reference: workTasks.reference,
        title: workTasks.title,
        status: workTasks.status,
        relatedType: workTasks.relatedType,
        relatedId: workTasks.relatedId,
        updatedAt: workTasks.updatedAt,
      })
      .from(workTasks)
      .where(and(eq(workTasks.organizationId, orgId), like(workTasks.relatedType, 'acct_%')))
      .orderBy(desc(workTasks.updatedAt), desc(workTasks.createdAt))
      .limit(200);
    const seen = new Set<string>();
    const links: AccountingFollowLink[] = [];
    for (const row of rows) {
      if (!row.relatedId || !row.relatedType) continue;
      const key = `${row.relatedType}:${row.relatedId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        id: row.id,
        reference: row.reference,
        title: row.title,
        status: row.status,
        kind: row.relatedType.slice(5),
        sourceId: row.relatedId,
        updatedAt: row.updatedAt.toISOString(),
        open: accountingTaskIsOpen(row.status),
      });
    }
    return links;
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
    followers?: Array<{ userId: string; duty: string }> | undefined;
  },
): Promise<{ id: string; reference: string; existing: boolean }> {
  if (!canCreateFollowTask(claims)) fail('forbidden');
  const orgId = claims.organizationId!;
  const kind = input.kind.trim();
  if (!KINDS.has(kind)) fail('invalid_input');
  const title = input.title.trim().slice(0, 200);
  if (title.length < 2) fail('invalid_input');
  const DUTY_LABEL: Record<string, string> = {
    lead: 'المسؤول',
    executor: 'المنفّذ',
    supervisor: 'المراقب',
    viewer: 'للاطلاع',
  };
  const followers = (input.followers?.length
    ? input.followers
    : [{ userId: input.assignedToUserId, duty: 'lead' }]
  )
    .map((row) => ({
      userId: row.userId.trim(),
      duty: DUTY_LABEL[row.duty] ? row.duty : 'viewer',
    }))
    .filter((row) => UUID.test(row.userId))
    .slice(0, 12);
  const uniqueFollowers = followers.filter(
    (row, index) => followers.findIndex((item) => item.userId === row.userId) === index,
  );
  if (!uniqueFollowers.length) fail('invalid_input');
  const lead = uniqueFollowers.find((row) => row.duty === 'lead') ?? uniqueFollowers[0]!;
  const assignee = lead.userId;
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

  return withinViewerTenant(claims, async (tx) => {
    const member = await tx
      .select({ userId: memberships.userId, name: users.displayName })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, orgId),
          inArray(
            memberships.userId,
            uniqueFollowers.map((row) => row.userId),
          ),
          eq(memberships.status, 'active'),
        ),
      );
    const names = new Map(member.map((row) => [row.userId, row.name]));
    if (uniqueFollowers.some((row) => !names.has(row.userId))) fail('invalid_input');
    const roster = uniqueFollowers
      .map((person) => `${names.get(person.userId) ?? person.userId}: ${DUTY_LABEL[person.duty]}`)
      .join('\n');
    const description = [
      input.detail?.trim(),
      input.note?.trim(),
      roster ? `المتابعون:\n${roster}` : '',
      attachments.length ? `مرفقات: ${attachments.join('، ')}` : '',
      sourceId ? `source:${kind}:${sourceId}` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);

    if (relatedId) {
      const open = await tx
        .select({ id: workTasks.id, reference: workTasks.reference })
        .from(workTasks)
        .where(
          and(
            eq(workTasks.organizationId, orgId),
            eq(workTasks.relatedType, relatedType),
            eq(workTasks.relatedId, relatedId),
          ),
        )
        .orderBy(desc(workTasks.createdAt))
        .limit(1);
      if (open[0]) {
        if (relatedId) await ensureAccountingPlace(tx, orgId, claims.sub, open[0].id, kind, relatedId);
        return { id: open[0].id, reference: open[0].reference, existing: true };
      }
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
      metadata: {
        kind,
        sourceId,
        followers: uniqueFollowers.map((person) => ({
          userId: person.userId,
          duty: person.duty,
          name: names.get(person.userId) ?? '',
        })),
      },
    });
    if (relatedId) await ensureAccountingPlace(tx, orgId, claims.sub, row.id, kind, relatedId);
    return { id: row.id, reference: row.reference, existing: false };
  });
}

/**
 * When a guest reports that the deposit transfer did not arrive: open (or reuse) an accounting
 * follow-up task for the accountant, with the owner / property manager as partners, and post the
 * guest's note on the thread.
 */
export async function openDepositNotReceivedFollowTask(
  tx: Tx,
  input: {
    organizationId: string;
    bookingId: string;
    claimId: string;
    referenceCode: string;
    guestMessage: string;
  },
): Promise<{ id: string; reference: string; created: boolean } | null> {
  const orgId = input.organizationId;
  const bookingId = input.bookingId;
  if (!UUID.test(bookingId) || !UUID.test(input.claimId)) return null;

  const relatedType = 'acct_deposit';
  const [existing] = await tx
    .select({
      id: workTasks.id,
      reference: workTasks.reference,
      status: workTasks.status,
      assignedToUserId: workTasks.assignedToUserId,
    })
    .from(workTasks)
    .where(
      and(
        eq(workTasks.organizationId, orgId),
        eq(workTasks.relatedType, relatedType),
        eq(workTasks.relatedId, bookingId),
      ),
    )
    .orderBy(desc(workTasks.createdAt))
    .limit(1);

  const memberRows = await tx
    .select({
      userId: memberships.userId,
      roleKey: memberships.roleKey,
      name: users.displayName,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.status, 'active')));

  const byUser = new Map<string, { name: string; roles: Set<string> }>();
  for (const row of memberRows) {
    const current = byUser.get(row.userId) ?? { name: row.name || row.userId.slice(0, 8), roles: new Set() };
    current.roles.add(row.roleKey);
    byUser.set(row.userId, current);
  }

  const payers = [...byUser.entries()].filter(([, info]) =>
    [...info.roles].some((role) => PAY_REFUND_ROLES.includes(role as RoleKey)),
  );
  const partners = [...byUser.entries()].filter(([, info]) =>
    [...info.roles].some((role) => PARTNER_ROLES.includes(role as RoleKey)),
  );
  const leadId =
    payers.find(([, info]) => info.roles.has('finance_manager'))?.[0] ??
    payers[0]?.[0] ??
    partners.find(([, info]) => info.roles.has('organization_owner'))?.[0] ??
    partners[0]?.[0] ??
    null;
  if (!leadId) return null;

  const DUTY_LABEL = {
    lead: 'المسؤول',
    supervisor: 'المراقب',
    viewer: 'للاطلاع',
  } as const;
  const followers: Array<{ userId: string; duty: keyof typeof DUTY_LABEL; name: string }> = [
    { userId: leadId, duty: 'lead', name: byUser.get(leadId)?.name ?? '' },
  ];
  for (const [userId, info] of partners) {
    if (userId === leadId) continue;
    if (followers.length >= 12) break;
    followers.push({ userId, duty: 'supervisor', name: info.name });
  }

  const guestNote = input.guestMessage.trim().slice(0, 2000) || 'لم يصلني مبلغ التأمين المحوَّل.';
  const title = `لم يصل مبلغ التأمين — ${input.referenceCode}`.slice(0, 200);

  let taskId = existing?.id ?? null;
  let taskReference = existing?.reference ?? null;
  let created = false;

  if (!taskId || !accountingTaskIsOpen(existing?.status ?? '')) {
    const nextReference = reference();
    const roster = followers
      .map((person) => `${person.name || person.userId}: ${DUTY_LABEL[person.duty]}`)
      .join('\n');
    const description = [
      `بلاغ الضيف بعدم استلام تحويل التأمين للحجز ${input.referenceCode}.`,
      `claim:${input.claimId}`,
      roster ? `المتابعون:\n${roster}` : '',
      `source:deposit:${bookingId}`,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
    const [row] = await tx
      .insert(workTasks)
      .values({
        organizationId: orgId,
        reference: nextReference,
        title,
        description,
        category: 'accounting',
        priority: 'high',
        createdByUserId: leadId,
        assignedToUserId: leadId,
        relatedType,
        relatedId: bookingId,
      })
      .returning({ id: workTasks.id, reference: workTasks.reference, status: workTasks.status });
    if (!row) return null;
    taskId = row.id;
    taskReference = row.reference;
    created = true;
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: leadId,
      resourceType: 'work_task',
      resourceId: row.id,
      eventType: 'task.created',
      toStatus: row.status,
      note: 'accounting:deposit_not_received',
      metadata: {
        kind: 'deposit',
        sourceId: bookingId,
        claimId: input.claimId,
        followers: followers.map((person) => ({
          userId: person.userId,
          duty: person.duty,
          name: person.name,
        })),
      },
    });
    await ensureAccountingPlace(tx, orgId, leadId, row.id, 'deposit', bookingId);
  } else if (existing && existing.assignedToUserId !== leadId) {
    await tx
      .update(workTasks)
      .set({ assignedToUserId: leadId, updatedAt: new Date(), priority: 'high' })
      .where(eq(workTasks.id, existing.id));
  }

  await tx.insert(workflowEvents).values({
    organizationId: orgId,
    actorUserId: leadId,
    resourceType: 'work_task',
    resourceId: taskId,
    eventType: 'task.reply',
    note: `الضيف: ${guestNote}`,
    metadata: {
      from: 'guest',
      claimId: input.claimId,
      kind: 'deposit_not_received',
    },
  });
  await tx
    .update(workTasks)
    .set({ updatedAt: new Date(), title })
    .where(eq(workTasks.id, taskId));

  return { id: taskId, reference: taskReference!, created };
}
