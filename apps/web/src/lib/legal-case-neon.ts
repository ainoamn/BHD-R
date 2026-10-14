import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { hasPermission, roleKeys, rolePermissions, type SessionClaims } from '@bhd-r/authz';
import {
  contracts,
  leases,
  legalCases,
  legalEvents,
  memberships,
  outboxEvents,
  parties,
  partyRoles,
  properties,
  units,
  users,
  workflowEvents,
} from '@bhd-r/db';
import { applySessionSettings } from '@/lib/db-session-settings';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { escapeHtml } from '@/lib/lease-booking-contract';
import {
  LEGAL_CHANGE_LABELS,
  LEGAL_FILE_MAX_CHARS,
  LEGAL_FILE_TYPES,
  LEGAL_FILES_MAX,
  LEGAL_FILES_MAX_CHARS,
  LEGAL_STAGES,
  LEGAL_UPDATE_LABELS,
  LEGAL_UPDATE_TYPES,
  type LegalCaseDetail,
  type LegalCaseEntry,
  type LegalCaseFile,
  type LegalCaseSummary,
  type LegalChange,
  type LegalStage,
  type LegalUpdateType,
} from '@/lib/legal-case-shared';
import { lawyerParty } from '@/lib/portal-access';
import { getDatabase, type Tx } from '@/lib/public-booking-neon';
import { publicWebOrigin } from '@/lib/seo';

const CASE_LIMIT = 200;
const ENTRY_LIMIT = 500;
const EMAIL_RECIPIENTS_MAX = 15;
/** One email per recipient and case in this window; the bell still shows every message. */
const EMAIL_QUIET_MINUTES = 10;
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;
const CLOSING_STAGES = new Set<LegalStage>(['settled', 'closed', 'cancelled']);
const READ_EVENT = 'legal_case.read';
const FILE_EVENT = 'legal_event.file';
/** Built-in roles that run every case; saved roles count when they carry `legal.manage`. */
const CASE_MANAGER_ROLES = roleKeys.filter(
  (role) =>
    role !== 'platform_admin' &&
    role !== 'platform_support' &&
    rolePermissions[role].includes('legal.manage'),
);

type Scope = {
  organizationId: string;
  userId: string;
  /** Set for an external lawyer: only cases whose lawyer party is this. */
  lawyerPartyId: string | null;
  side: 'lawyer' | 'team';
  canEdit: boolean;
  canManage: boolean;
};

/** Who reads which cases: the team every case of the organization, a lawyer only theirs. */
export function legalScope(claims: SessionClaims): Scope | null {
  if (!claims.organizationId) return null;
  const base = { organizationId: claims.organizationId, userId: claims.sub };
  if (hasPermission(claims, 'legal.read')) {
    const manage = hasPermission(claims, 'legal.manage');
    return { ...base, lawyerPartyId: null, side: 'team', canEdit: manage, canManage: manage };
  }
  const party = lawyerParty(claims);
  if (party && hasPermission(claims, 'legal.case.read')) {
    return {
      ...base,
      lawyerPartyId: party,
      side: 'lawyer',
      canEdit: hasPermission(claims, 'legal.case.update'),
      canManage: false,
    };
  }
  return null;
}

function requireScope(claims: SessionClaims): Scope {
  const scope = legalScope(claims);
  if (!scope) throw new Error('forbidden');
  return scope;
}

/** Every query filters by organization and, for a lawyer, by their lawyer party. */
async function withLegal<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return getDatabase().db.transaction(async (tx) => {
    await applySessionSettings(tx, {
      statement_timeout: '8000',
      'app.platform_admin': 'true',
      'app.public': 'false',
    });
    return work(tx);
  });
}

function caseWhere(scope: Scope, caseId?: string) {
  return and(
    eq(legalCases.organizationId, scope.organizationId),
    ...(scope.lawyerPartyId ? [eq(legalCases.lawyerPartyId, scope.lawyerPartyId)] : []),
    ...(caseId ? [eq(legalCases.id, caseId)] : []),
  );
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? new Date(value).toISOString() : value.toISOString();
}

function muscatToday(): string {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}

/** Entries from the other side the viewer has not opened yet, per case. */
function unreadSql(scope: Scope) {
  const lastRead = sql`coalesce((
    select max(w.occurred_at) from workflow_events w
    where w.organization_id = ${scope.organizationId}
      and w.resource_type = 'legal_case'
      and w.resource_id = e.legal_case_id
      and w.event_type = ${READ_EVENT}
      and w.actor_user_id = ${scope.userId}
  ), 'epoch'::timestamptz)`;
  const fromOtherSide =
    scope.side === 'lawyer'
      ? sql`true`
      : sql`e.created_by_user_id in (
          select m.user_id from memberships m
          where m.organization_id = ${scope.organizationId} and m.role_key = 'lawyer'
        )`;
  return sql`e.created_by_user_id <> ${scope.userId}
    and e.type <> 'opened'
    and e.created_at > ${lastRead}
    and ${fromOtherSide}`;
}

async function activity(
  tx: Tx,
  scope: Scope,
  caseIds: string[],
): Promise<Map<string, { unread: number; last: string | null }>> {
  const map = new Map<string, { unread: number; last: string | null }>();
  if (!caseIds.length) return map;
  const rows = await tx.execute<{
    case_id: string;
    unread: number;
    last: Date | string | null;
  }>(sql`
    select e.legal_case_id as case_id,
      count(*) filter (where ${unreadSql(scope)})::int as unread,
      max(e.created_at) as last
    from legal_events e
    where e.organization_id = ${scope.organizationId}
      and e.legal_case_id in (${sql.join(
        caseIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    group by e.legal_case_id
  `);
  for (const row of rows) {
    map.set(row.case_id, { unread: Number(row.unread), last: iso(row.last) });
  }
  return map;
}

const lawyerParties = alias(parties, 'lawyer_party');
const counterparties = alias(parties, 'counterparty');

async function summaries(tx: Tx, scope: Scope, onlyUnread: boolean): Promise<LegalCaseSummary[]> {
  const rows = await tx
    .select({
      id: legalCases.id,
      reference: legalCases.reference,
      title: legalCases.title,
      caseType: legalCases.caseType,
      status: legalCases.status,
      caseNumber: legalCases.caseNumber,
      court: legalCases.court,
      nextHearingAt: legalCases.nextHearingAt,
      claimAmountMinor: legalCases.claimAmountMinor,
      recoveredAmountMinor: legalCases.recoveredAmountMinor,
      currency: legalCases.currency,
      updatedAt: legalCases.updatedAt,
      lawyerName: lawyerParties.displayName,
      counterpartyName: counterparties.displayName,
      propertyNameAr: properties.nameAr,
      propertyNameEn: properties.nameEn,
      unitCode: units.code,
    })
    .from(legalCases)
    .leftJoin(units, eq(units.id, legalCases.unitId))
    .leftJoin(
      properties,
      sql`${properties.id} = coalesce(${legalCases.propertyId}, ${units.propertyId})`,
    )
    .leftJoin(lawyerParties, eq(lawyerParties.id, legalCases.lawyerPartyId))
    .leftJoin(counterparties, eq(counterparties.id, legalCases.counterpartyId))
    .where(caseWhere(scope))
    .orderBy(desc(legalCases.updatedAt))
    .limit(CASE_LIMIT);
  const stats = await activity(
    tx,
    scope,
    rows.map((row) => row.id),
  );
  const list = rows.map((row): LegalCaseSummary => {
    const stat = stats.get(row.id);
    const updated = iso(row.updatedAt) ?? new Date(0).toISOString();
    return {
      id: row.id,
      reference: row.reference,
      title: row.title,
      caseType: row.caseType,
      status: row.status,
      caseNumber: row.caseNumber,
      court: row.court,
      nextHearingAt: iso(row.nextHearingAt),
      claimAmountMinor: row.claimAmountMinor.toString(),
      recoveredAmountMinor: row.recoveredAmountMinor.toString(),
      currency: row.currency,
      lawyerName: row.lawyerName,
      counterpartyName: row.counterpartyName,
      propertyNameAr: row.propertyNameAr,
      propertyNameEn: row.propertyNameEn,
      unitCode: row.unitCode,
      unread: stat?.unread ?? 0,
      lastActivityAt: stat?.last && stat.last > updated ? stat.last : updated,
    };
  });
  return (onlyUnread ? list.filter((item) => item.unread > 0) : list).sort(
    (a, b) => b.unread - a.unread || b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
}

/** Cases the viewer may open, those with unread messages first. */
export async function listLegalCases(claims: SessionClaims): Promise<LegalCaseSummary[]> {
  const scope = requireScope(claims);
  return withLegal((tx) => summaries(tx, scope, false));
}

/** Cases with new messages or updates from the other side, for the header bell. */
export async function unreadLegalCases(claims: SessionClaims): Promise<LegalCaseSummary[]> {
  const scope = legalScope(claims);
  if (!scope?.canEdit) return [];
  return withLegal((tx) => summaries(tx, scope, true));
}

async function lawyerUsers(tx: Tx, organizationId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.roleKey, 'lawyer')));
  return new Set(rows.map((row) => row.userId));
}

async function lawyerChoices(tx: Tx, organizationId: string) {
  return tx
    .select({ id: parties.id, name: parties.displayName })
    .from(parties)
    .innerJoin(
      partyRoles,
      and(
        eq(partyRoles.partyId, parties.id),
        eq(partyRoles.organizationId, organizationId),
        eq(partyRoles.roleKey, 'lawyer'),
        eq(partyRoles.status, 'active'),
      ),
    )
    .where(eq(parties.organizationId, organizationId))
    .orderBy(parties.displayName)
    .limit(200);
}

function parseChangeNotes(notes: string | null): { changes: LegalChange[]; note: string | null } {
  if (!notes) return { changes: [], note: null };
  try {
    const parsed = JSON.parse(notes) as { changes?: unknown; note?: unknown };
    const changes = Array.isArray(parsed.changes)
      ? parsed.changes.filter(
          (item): item is LegalChange =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as LegalChange).field === 'string' &&
            (item as LegalChange).field in LEGAL_CHANGE_LABELS,
        )
      : [];
    return { changes, note: typeof parsed.note === 'string' ? parsed.note : null };
  } catch {
    return { changes: [], note: notes };
  }
}

function entryKind(type: string): LegalCaseEntry['kind'] {
  if (type === 'message') return 'message';
  if (type === 'case_change') return 'change';
  if (type === 'opened') return 'opened';
  return 'update';
}

/** The case with its timeline and conversation; opening it marks the other side's entries read. */
export async function readLegalCase(
  claims: SessionClaims,
  caseId: string,
): Promise<LegalCaseDetail | null> {
  const scope = legalScope(claims);
  if (!scope) return null;
  return withLegal(async (tx) => {
    const [row] = await tx
      .select({
        legal: legalCases,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        unitCode: units.code,
        lawyerName: lawyerParties.displayName,
        counterpartyName: counterparties.displayName,
        counterpartyPhone: counterparties.phone,
        counterpartyEmail: counterparties.email,
      })
      .from(legalCases)
      .leftJoin(units, eq(units.id, legalCases.unitId))
      .leftJoin(
        properties,
        sql`${properties.id} = coalesce(${legalCases.propertyId}, ${units.propertyId})`,
      )
      .leftJoin(lawyerParties, eq(lawyerParties.id, legalCases.lawyerPartyId))
      .leftJoin(counterparties, eq(counterparties.id, legalCases.counterpartyId))
      .where(caseWhere(scope, caseId))
      .limit(1);
    if (!row) return null;
    const legal = row.legal;

    const [lease] = legal.leaseId
      ? await tx
          .select({
            status: leases.status,
            startsOn: leases.startsOn,
            endsOn: leases.endsOn,
            rentMinor: leases.rentMinor,
            currency: leases.currency,
            contractReference: contracts.reference,
          })
          .from(leases)
          .leftJoin(contracts, eq(contracts.id, leases.contractId))
          .where(and(eq(leases.organizationId, scope.organizationId), eq(leases.id, legal.leaseId)))
          .limit(1)
      : [];

    const events = await tx
      .select({
        id: legalEvents.id,
        type: legalEvents.type,
        title: legalEvents.title,
        notes: legalEvents.notes,
        occurredAt: legalEvents.occurredAt,
        deadlineAt: legalEvents.deadlineAt,
        createdAt: legalEvents.createdAt,
        authorId: legalEvents.createdByUserId,
        authorName: users.displayName,
      })
      .from(legalEvents)
      .innerJoin(users, eq(users.id, legalEvents.createdByUserId))
      .where(
        and(
          eq(legalEvents.organizationId, scope.organizationId),
          eq(legalEvents.legalCaseId, legal.id),
        ),
      )
      .orderBy(asc(legalEvents.createdAt))
      .limit(ENTRY_LIMIT);

    const eventIds = events.map((event) => event.id);
    const fileRows = eventIds.length
      ? await tx
          .select({
            id: workflowEvents.id,
            eventId: workflowEvents.resourceId,
            name: sql<string | null>`${workflowEvents.metadata}->>'name'`,
            mime: sql<string | null>`${workflowEvents.metadata}->>'mime'`,
            size: sql<string | null>`${workflowEvents.metadata}->>'size'`,
          })
          .from(workflowEvents)
          .where(
            and(
              eq(workflowEvents.organizationId, scope.organizationId),
              eq(workflowEvents.resourceType, 'legal_event'),
              eq(workflowEvents.eventType, FILE_EVENT),
              inArray(workflowEvents.resourceId, eventIds),
            ),
          )
          .orderBy(asc(workflowEvents.occurredAt))
      : [];
    const filesByEvent = new Map<string, LegalCaseFile[]>();
    for (const file of fileRows) {
      filesByEvent.set(file.eventId, [
        ...(filesByEvent.get(file.eventId) ?? []),
        {
          id: file.id,
          name: file.name ?? 'file',
          mime: file.mime ?? 'application/octet-stream',
          size: Number(file.size ?? 0),
        },
      ]);
    }

    const lawyerIds = await lawyerUsers(tx, scope.organizationId);
    const entries = events.map((event): LegalCaseEntry => {
      const kind = entryKind(event.type);
      const parsed = kind === 'change' ? parseChangeNotes(event.notes) : null;
      return {
        id: event.id,
        kind,
        type: event.type,
        title: event.title,
        notes: parsed ? parsed.note : event.notes,
        changes: parsed?.changes ?? [],
        occurredAt: iso(event.occurredAt) ?? '',
        deadlineAt: iso(event.deadlineAt),
        authorName: event.authorName,
        authorSide: lawyerIds.has(event.authorId) ? 'lawyer' : 'team',
        mine: event.authorId === scope.userId,
        files: filesByEvent.get(event.id) ?? [],
      };
    });

    const [unread] = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count from legal_events e
      where e.organization_id = ${scope.organizationId}
        and e.legal_case_id = ${legal.id}
        and ${unreadSql(scope)}
    `);
    if (Number(unread?.count ?? 0) > 0) {
      await tx.insert(workflowEvents).values({
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        resourceType: 'legal_case',
        resourceId: legal.id,
        eventType: READ_EVENT,
        metadata: {},
      });
    }

    return {
      id: legal.id,
      reference: legal.reference,
      title: legal.title,
      caseType: legal.caseType,
      description: legal.description,
      status: legal.status,
      caseNumber: legal.caseNumber,
      court: legal.court,
      nextHearingAt: iso(legal.nextHearingAt),
      openedOn: legal.openedOn,
      closedOn: legal.closedOn,
      claimAmountMinor: legal.claimAmountMinor.toString(),
      recoveredAmountMinor: legal.recoveredAmountMinor.toString(),
      currency: legal.currency,
      minorUnit: legal.minorUnit,
      property: row.propertyNameAr
        ? { nameAr: row.propertyNameAr, nameEn: row.propertyNameEn }
        : null,
      unitCode: row.unitCode,
      lease: lease
        ? {
            contractReference: lease.contractReference,
            status: lease.status,
            startsOn: lease.startsOn,
            endsOn: lease.endsOn,
            rentMinor: lease.rentMinor.toString(),
            currency: lease.currency,
          }
        : null,
      counterparty: row.counterpartyName
        ? {
            name: row.counterpartyName,
            phone: row.counterpartyPhone,
            email: row.counterpartyEmail,
          }
        : null,
      lawyer:
        legal.lawyerPartyId && row.lawyerName
          ? { id: legal.lawyerPartyId, name: row.lawyerName }
          : null,
      entries,
      canEdit: scope.canEdit,
      canManage: scope.canManage,
      viewerSide: scope.side,
      lawyers: scope.canManage ? await lawyerChoices(tx, scope.organizationId) : [],
    };
  });
}

async function lockCase(tx: Tx, scope: Scope, caseId: string) {
  const [row] = await tx.select().from(legalCases).where(caseWhere(scope, caseId)).for('update');
  if (!row) throw new Error('legal_case_not_found');
  return row;
}

async function actorName(tx: Tx, userId: string): Promise<string> {
  const actor = await tx.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { displayName: true },
  });
  return actor?.displayName ?? 'BHD R';
}

/** The other side of the case: the team that runs it, or the users of the case's lawyer party. */
async function recipients(
  tx: Tx,
  scope: Scope,
  legal: { lawyerPartyId: string | null; assignedToUserId: string | null },
): Promise<{ userId: string; email: string; name: string }[]> {
  const notMe = ne(memberships.userId, scope.userId);
  const active = and(
    eq(memberships.organizationId, scope.organizationId),
    eq(memberships.status, 'active'),
    notMe,
  );
  const who =
    scope.side === 'team'
      ? legal.lawyerPartyId
        ? and(
            active,
            eq(memberships.roleKey, 'lawyer'),
            eq(memberships.partyId, legal.lawyerPartyId),
          )
        : null
      : and(
          active,
          or(
            inArray(memberships.roleKey, CASE_MANAGER_ROLES),
            sql`${memberships.permissions} @> '["legal.manage"]'::jsonb`,
            ...(legal.assignedToUserId ? [eq(memberships.userId, legal.assignedToUserId)] : []),
          ),
        );
  if (!who) return [];
  const rows = await tx
    .selectDistinct({ userId: users.id, email: users.email, name: users.displayName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(who, sql`${users.disabledAt} is null`))
    .limit(EMAIL_RECIPIENTS_MAX);
  return rows.filter((row) => row.email.includes('@'));
}

async function notifyOtherSide(
  tx: Tx,
  scope: Scope,
  legal: {
    id: string;
    reference: string;
    title: string;
    lawyerPartyId: string | null;
    assignedToUserId: string | null;
  },
  what: 'message' | 'update' | 'change',
) {
  const people = await recipients(tx, scope, legal);
  if (!people.length) return;
  const recent = await tx.execute<{ recipient: string }>(sql`
    select distinct payload->>'recipient' as recipient from outbox_events
    where organization_id = ${scope.organizationId}
      and aggregate_type = 'legal_case'
      and aggregate_id = ${legal.id}
      and occurred_at > now() - make_interval(mins => ${EMAIL_QUIET_MINUTES})
  `);
  const quiet = new Set([...recent].map((row) => row.recipient));
  const sender = await actorName(tx, scope.userId);
  const link = `${publicWebOrigin()}/ar/owner/legal/${legal.id}`;
  const action =
    what === 'message'
      ? 'أرسل رسالة جديدة'
      : what === 'update'
        ? 'أضاف تحديثاً جديداً'
        : 'حدّث بيانات القضية';
  const subject =
    what === 'message'
      ? `رسالة جديدة في القضية ${legal.reference}`
      : `تحديث في القضية ${legal.reference}`;
  for (const person of people) {
    if (quiet.has(person.email)) continue;
    const greeting = person.name ? `مرحباً ${person.name}،` : 'مرحباً،';
    const lines = [
      `${sender} ${action} في القضية ${legal.reference} — ${legal.title}.`,
      'افتح القضية في BHD R للاطلاع والرد. لا نرسل محتوى الرسائل أو المرفقات بالبريد.',
    ];
    await tx.insert(outboxEvents).values({
      organizationId: scope.organizationId,
      topic: 'notification.delivery.requested',
      aggregateType: 'legal_case',
      aggregateId: legal.id,
      payload: {
        correlationId: randomUUID(),
        organizationId: scope.organizationId,
        notificationId: randomUUID(),
        channel: 'email',
        recipient: person.email,
        subject,
        text: [greeting, '', ...lines, '', `فتح القضية: ${link}`, '', 'BHD R'].join('\n'),
        html: `<div dir="rtl"><p>${escapeHtml(greeting)}</p>${lines
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join('')}<p><a href="${escapeHtml(link)}">فتح القضية</a></p><p>BHD R</p></div>`,
      },
    });
  }
  sendQueuedEmailsSoon();
}

export type LegalCaseUpdate = {
  status?: LegalStage | undefined;
  caseNumber?: string | null | undefined;
  court?: string | null | undefined;
  nextHearingAt?: string | null | undefined;
  claimAmountMinor?: string | undefined;
  recoveredAmountMinor?: string | undefined;
  lawyerPartyId?: string | null | undefined;
  note?: string | undefined;
};

function cleanText(value: string | null | undefined, max: number): string | null {
  const text = value?.trim().slice(0, max);
  return text ? text : null;
}

function cleanMinor(value: string | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{1,18}$/.test(value)) throw new Error('legal_invalid');
  return BigInt(value);
}

/** Change the case facts; each change is written to the timeline and the other side is told. */
export async function updateLegalCase(
  claims: SessionClaims,
  caseId: string,
  input: LegalCaseUpdate,
): Promise<{ changed: number }> {
  const scope = requireScope(claims);
  if (!scope.canEdit) throw new Error('forbidden');
  if (input.lawyerPartyId !== undefined && !scope.canManage) throw new Error('forbidden');
  if (input.status && !(LEGAL_STAGES as readonly string[]).includes(input.status)) {
    throw new Error('legal_invalid');
  }
  let hearing: Date | null | undefined;
  if (input.nextHearingAt !== undefined) {
    hearing = input.nextHearingAt ? new Date(input.nextHearingAt) : null;
    if (hearing && Number.isNaN(hearing.getTime())) throw new Error('legal_invalid');
  }
  const claim = cleanMinor(input.claimAmountMinor);
  const recovered = cleanMinor(input.recoveredAmountMinor);
  const note = cleanText(input.note, 2_000);

  return withLegal(async (tx) => {
    const legal = await lockCase(tx, scope, caseId);
    const changes: LegalChange[] = [];
    const set: Partial<typeof legalCases.$inferInsert> = {};

    if (input.status && input.status !== legal.status) {
      changes.push({ field: 'status', from: legal.status, to: input.status });
      set.status = input.status;
      set.closedOn = CLOSING_STAGES.has(input.status) ? muscatToday() : null;
    }
    if (input.caseNumber !== undefined) {
      const next = cleanText(input.caseNumber, 120);
      if (next !== legal.caseNumber) {
        changes.push({ field: 'caseNumber', from: legal.caseNumber, to: next });
        set.caseNumber = next;
      }
    }
    if (input.court !== undefined) {
      const next = cleanText(input.court, 200);
      if (next !== legal.court) {
        changes.push({ field: 'court', from: legal.court, to: next });
        set.court = next;
      }
    }
    if (hearing !== undefined) {
      const before = iso(legal.nextHearingAt);
      const after = iso(hearing);
      if (before !== after) {
        changes.push({ field: 'nextHearingAt', from: before, to: after });
        set.nextHearingAt = hearing;
      }
    }
    if (claim !== undefined && claim !== legal.claimAmountMinor) {
      changes.push({
        field: 'claimAmountMinor',
        from: legal.claimAmountMinor.toString(),
        to: claim.toString(),
      });
      set.claimAmountMinor = claim;
    }
    if (recovered !== undefined && recovered !== legal.recoveredAmountMinor) {
      changes.push({
        field: 'recoveredAmountMinor',
        from: legal.recoveredAmountMinor.toString(),
        to: recovered.toString(),
      });
      set.recoveredAmountMinor = recovered;
    }
    if (input.lawyerPartyId !== undefined && input.lawyerPartyId !== legal.lawyerPartyId) {
      const choices = await lawyerChoices(tx, scope.organizationId);
      const next = input.lawyerPartyId
        ? choices.find((choice) => choice.id === input.lawyerPartyId)
        : null;
      if (input.lawyerPartyId && !next) throw new Error('legal_lawyer_invalid');
      const before = legal.lawyerPartyId
        ? (
            await tx
              .select({ name: parties.displayName })
              .from(parties)
              .where(
                and(
                  eq(parties.organizationId, scope.organizationId),
                  eq(parties.id, legal.lawyerPartyId),
                ),
              )
              .limit(1)
          )[0]?.name
        : null;
      changes.push({ field: 'lawyerPartyId', from: before ?? null, to: next?.name ?? null });
      set.lawyerPartyId = input.lawyerPartyId;
    }
    if (!changes.length && !note) return { changed: 0 };

    if (changes.length) {
      await tx
        .update(legalCases)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(legalCases.id, legal.id));
    }
    await tx.insert(legalEvents).values({
      organizationId: scope.organizationId,
      legalCaseId: legal.id,
      createdByUserId: scope.userId,
      type: 'case_change',
      title: 'تحديث بيانات القضية',
      notes: JSON.stringify({ changes, note }),
    });
    const notified = {
      ...legal,
      lawyerPartyId: set.lawyerPartyId !== undefined ? set.lawyerPartyId : legal.lawyerPartyId,
    };
    await notifyOtherSide(tx, scope, notified, 'change');
    return { changed: changes.length };
  });
}

export type LegalEntryFileInput = { name: string; dataUrl: string };

export type LegalEntryInput =
  | { kind: 'message'; text: string; files: LegalEntryFileInput[] }
  | {
      kind: 'update';
      type: LegalUpdateType;
      title: string;
      notes?: string | undefined;
      occurredAt?: string | undefined;
      deadlineAt?: string | undefined;
      files: LegalEntryFileInput[];
    };

function checkedFiles(files: LegalEntryFileInput[]) {
  if (files.length > LEGAL_FILES_MAX) throw new Error('legal_file_invalid');
  let total = 0;
  return files.map((file) => {
    const parsed = DATA_URL.exec(file.dataUrl);
    if (!parsed || file.dataUrl.length > LEGAL_FILE_MAX_CHARS) {
      throw new Error('legal_file_invalid');
    }
    const mime = parsed[1]!;
    if (!LEGAL_FILE_TYPES.includes(mime)) throw new Error('legal_file_invalid');
    total += file.dataUrl.length;
    if (total > LEGAL_FILES_MAX_CHARS) throw new Error('legal_file_invalid');
    const name =
      Array.from(file.name)
        .filter((char) => char.charCodeAt(0) > 31 && !'\\/:*?"<>|'.includes(char))
        .join('')
        .trim()
        .slice(0, 120) || 'file';
    return {
      name,
      mime,
      size: Math.floor((parsed[2]!.length * 3) / 4),
      dataUrl: file.dataUrl,
    };
  });
}

function optionalDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('legal_invalid');
  return date;
}

/** A message in the case conversation or an update on its timeline, with attachments. */
export async function addLegalEntry(
  claims: SessionClaims,
  caseId: string,
  input: LegalEntryInput,
): Promise<{ id: string }> {
  const scope = requireScope(claims);
  if (!scope.canEdit) throw new Error('forbidden');
  const files = checkedFiles(input.files);
  let values: Pick<typeof legalEvents.$inferInsert, 'type' | 'title' | 'notes' | 'deadlineAt'> & {
    occurredAt?: Date;
  };
  if (input.kind === 'message') {
    const text = input.text.trim();
    if (!text && !files.length) throw new Error('legal_invalid');
    values = { type: 'message', title: 'رسالة', notes: text || null, deadlineAt: null };
  } else {
    if (!(LEGAL_UPDATE_TYPES as readonly string[]).includes(input.type)) {
      throw new Error('legal_invalid');
    }
    const title = cleanText(input.title, 200) ?? LEGAL_UPDATE_LABELS[input.type].ar;
    const occurred = optionalDate(input.occurredAt);
    values = {
      type: input.type,
      title,
      notes: cleanText(input.notes, 10_000),
      deadlineAt: optionalDate(input.deadlineAt),
      ...(occurred ? { occurredAt: occurred } : {}),
    };
  }

  return withLegal(async (tx) => {
    const legal = await lockCase(tx, scope, caseId);
    const [created] = await tx
      .insert(legalEvents)
      .values({
        organizationId: scope.organizationId,
        legalCaseId: legal.id,
        createdByUserId: scope.userId,
        ...values,
      })
      .returning({ id: legalEvents.id });
    for (const file of files) {
      await tx.insert(workflowEvents).values({
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        resourceType: 'legal_event',
        resourceId: created!.id,
        eventType: FILE_EVENT,
        metadata: file,
      });
    }
    await tx.update(legalCases).set({ updatedAt: new Date() }).where(eq(legalCases.id, legal.id));
    await notifyOtherSide(tx, scope, legal, input.kind);
    return { id: created!.id };
  });
}

/** An attachment of one of the case's entries, for whoever may open the case. */
export async function readLegalFile(
  claims: SessionClaims,
  caseId: string,
  fileId: string,
): Promise<{ mime: string; bytes: Buffer; name: string } | null> {
  const scope = legalScope(claims);
  if (!scope) return null;
  return withLegal(async (tx) => {
    const [legal] = await tx
      .select({ id: legalCases.id })
      .from(legalCases)
      .where(caseWhere(scope, caseId))
      .limit(1);
    if (!legal) return null;
    const [row] = await tx
      .select({ metadata: workflowEvents.metadata })
      .from(workflowEvents)
      .innerJoin(
        legalEvents,
        and(eq(legalEvents.id, workflowEvents.resourceId), eq(legalEvents.legalCaseId, legal.id)),
      )
      .where(
        and(
          eq(workflowEvents.id, fileId),
          eq(workflowEvents.organizationId, scope.organizationId),
          eq(workflowEvents.resourceType, 'legal_event'),
          eq(workflowEvents.eventType, FILE_EVENT),
        ),
      )
      .limit(1);
    const metadata = (row?.metadata ?? {}) as Record<string, unknown>;
    const parsed = typeof metadata.dataUrl === 'string' ? DATA_URL.exec(metadata.dataUrl) : null;
    if (!parsed || !LEGAL_FILE_TYPES.includes(parsed[1]!)) return null;
    return {
      mime: parsed[1]!,
      bytes: Buffer.from(parsed[2]!, 'base64'),
      name: typeof metadata.name === 'string' ? metadata.name : 'file',
    };
  });
}
