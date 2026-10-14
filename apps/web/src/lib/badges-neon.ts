import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { aiChatJson, type AiEndpoint } from '@/lib/ai-chat';
import {
  awardSerial,
  badgeSerial,
  criteriaMet,
  criterionMet,
  criterionProgress,
  describeCriterion,
  formatMetric,
  metricsFor,
  parseAwardSerial,
  type AwardStatus,
  type BadgeAwardView,
  type BadgeDefinitionInput,
  type BadgeDefinitionView,
  type BadgeProgressView,
  type BadgeSubject,
  type BadgesCenter,
  type EvaluationSummary,
  type MetricValues,
  type SubjectBadges,
} from '@/lib/badges-shared';
import {
  computeMetrics,
  ensureCatalog,
  evaluateOrganization,
  insertAwards,
  loadDefinitions,
  type DefinitionRow,
} from '@/lib/badges-engine-neon';
import { elevatedTx, isoOf, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import { scopedOwnerParty } from '@/lib/portal-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT_LIMIT = 40;
const HOLDERS_LIMIT = 500;

function fail(code: string): never {
  throw new Error(code);
}

export function canReadBadges(claims: SessionClaims): boolean {
  return (
    !!claims.organizationId &&
    !scopedOwnerParty(claims) &&
    (hasPermission(claims, 'party.read') ||
      hasPermission(claims, 'property.read') ||
      hasPermission(claims, 'organization.members.read'))
  );
}

export function canManageBadges(claims: SessionClaims): boolean {
  return canReadBadges(claims) && hasPermission(claims, 'organization.members.write');
}

function readerOrg(claims: SessionClaims): string {
  if (!canReadBadges(claims)) fail('forbidden');
  return claims.organizationId!;
}

function managerOrg(claims: SessionClaims): string {
  if (!canManageBadges(claims)) fail('forbidden');
  return claims.organizationId!;
}

type Ref = { type: BadgeSubject; id: string };

/** Display names for award subjects, looked up per kind within the organization. */
async function subjectNames(
  tx: ElevatedTx,
  organizationId: string,
  refs: Ref[],
  ar: boolean,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const byType = (types: BadgeSubject[]) => [
    ...new Set(refs.filter((ref) => types.includes(ref.type)).map((ref) => ref.id)),
  ];
  const list = (ids: string[]) =>
    sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
  const properties = byType(['property']);
  if (properties.length) {
    for (const row of rowsOf<{ id: string; name_ar: string; name_en: string }>(
      await tx.execute(sql`select id::text, name_ar, name_en from properties
        where organization_id = ${organizationId} and id in (${list(properties)})`),
    ))
      names.set(row.id, (ar ? row.name_ar : row.name_en) || row.name_ar);
  }
  const parties = byType(['owner', 'tenant']);
  if (parties.length) {
    for (const row of rowsOf<{ id: string; display_name: string }>(
      await tx.execute(sql`select id::text, display_name from parties
        where organization_id = ${organizationId} and id in (${list(parties)})`),
    ))
      names.set(row.id, row.display_name);
  }
  const staff = byType(['staff']);
  if (staff.length) {
    for (const row of rowsOf<{ id: string; display_name: string }>(
      await tx.execute(sql`select id::text, display_name from users where id in (${list(staff)})`),
    ))
      names.set(row.id, row.display_name);
  }
  const workers = byType(['worker']);
  if (workers.length) {
    for (const row of rowsOf<{ id: string; name: string }>(
      await tx.execute(sql`select id::text, name from vendors
        where organization_id = ${organizationId} and id in (${list(workers)})`),
    ))
      names.set(row.id, row.name);
  }
  return names;
}

type AwardRow = {
  id: string;
  serial_year: number;
  serial_no: number;
  badge_id: string;
  badge_serial_no: number;
  name_ar: string;
  name_en: string;
  tier: BadgeAwardView['tier'];
  level: BadgeAwardView['level'];
  icon: BadgeAwardView['icon'];
  subject_type: BadgeSubject;
  subject_id: string;
  status: AwardStatus;
  awarded_at: Date | string | null;
  expires_at: Date | string | null;
  ended_at: Date | string | null;
  end_reason: string | null;
  created_at: Date | string;
  rationale_ar: string | null;
  rationale_en: string | null;
  ai_engine: string;
  metrics: unknown;
};

const AWARD_COLUMNS = sql`a.id::text, a.serial_year, a.serial_no, a.badge_id::text,
  d.serial_no as badge_serial_no, d.name_ar, d.name_en, d.tier, d.level, d.icon,
  a.subject_type, a.subject_id::text, a.status, a.awarded_at, a.expires_at, a.ended_at,
  a.end_reason, a.created_at, a.rationale_ar, a.rationale_en, a.ai_engine, a.metrics`;

async function awardViews(
  tx: ElevatedTx,
  organizationId: string,
  rows: AwardRow[],
  ar: boolean,
): Promise<BadgeAwardView[]> {
  const names = await subjectNames(
    tx,
    organizationId,
    rows.map((row) => ({ type: row.subject_type, id: row.subject_id })),
    ar,
  );
  return rows.map((row) => ({
    id: row.id,
    serial: awardSerial(Number(row.serial_year), Number(row.serial_no)),
    badgeId: row.badge_id,
    badgeSerial: badgeSerial(Number(row.badge_serial_no)),
    badgeNameAr: row.name_ar,
    badgeNameEn: row.name_en,
    tier: row.tier,
    level: row.level,
    icon: row.icon,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subjectName: names.get(row.subject_id) ?? (ar ? 'غير معروف' : 'Unknown'),
    status: row.status,
    awardedAt: isoOf(row.awarded_at),
    expiresAt: isoOf(row.expires_at),
    endedAt: isoOf(row.ended_at),
    endReason: row.end_reason,
    createdAt: isoOf(row.created_at) ?? new Date().toISOString(),
    rationaleAr: row.rationale_ar,
    rationaleEn: row.rationale_en,
    aiEngine: row.ai_engine,
    metrics: row.metrics && typeof row.metrics === 'object' ? row.metrics : {},
  }));
}

function definitionView(
  definition: DefinitionRow,
  counts: Map<string, { holders: number; pending: number; ever: number }>,
): BadgeDefinitionView {
  const count = counts.get(definition.id) ?? { holders: 0, pending: 0, ever: 0 };
  return {
    id: definition.id,
    code: definition.code,
    serial: badgeSerial(definition.serialNo),
    status: definition.status as BadgeDefinitionView['status'],
    subjectType: definition.subjectType,
    tier: definition.tier,
    level: definition.level,
    nameAr: definition.nameAr,
    nameEn: definition.nameEn,
    descriptionAr: definition.descriptionAr,
    descriptionEn: definition.descriptionEn,
    icon: definition.icon,
    criteria: definition.criteria,
    windowDays: definition.windowDays,
    sustainDays: definition.sustainDays,
    validityDays: definition.validityDays,
    autoRevoke: definition.autoRevoke,
    grantMode: definition.grantMode,
    holders: count.holders,
    pending: count.pending,
    everAwarded: count.ever,
  };
}

export async function loadBadgesCenter(
  claims: SessionClaims,
  locale: 'ar' | 'en',
): Promise<BadgesCenter> {
  const organizationId = readerOrg(claims);
  const ar = locale === 'ar';
  return elevatedTx(async (tx) => {
    await ensureCatalog(tx, organizationId);
    const definitions = await loadDefinitions(tx, organizationId, sql`and status <> 'archived'`);
    const counts = new Map(
      rowsOf<{ badge_id: string; holders: number; pending: number; ever: number }>(
        await tx.execute(sql`
          select badge_id::text,
            count(*) filter (where status = 'active')::int as holders,
            count(*) filter (where status = 'pending')::int as pending,
            count(*) filter (where status in ('active', 'expired', 'revoked'))::int as ever
          from badge_awards where organization_id = ${organizationId}
          group by badge_id
        `),
      ).map((row) => [
        row.badge_id,
        { holders: Number(row.holders), pending: Number(row.pending), ever: Number(row.ever) },
      ]),
    );
    const pending = rowsOf<AwardRow>(
      await tx.execute(sql`
        select ${AWARD_COLUMNS} from badge_awards a join badge_definitions d on d.id = a.badge_id
        where a.organization_id = ${organizationId} and a.status = 'pending'
        order by a.created_at
        limit ${HOLDERS_LIMIT}
      `),
    );
    const recent = rowsOf<AwardRow>(
      await tx.execute(sql`
        select ${AWARD_COLUMNS} from badge_awards a join badge_definitions d on d.id = a.badge_id
        where a.organization_id = ${organizationId} and a.status <> 'pending'
        order by a.updated_at desc
        limit ${RECENT_LIMIT}
      `),
    );
    const [evaluated] = rowsOf<{ at: Date | string | null }>(
      await tx.execute(
        sql`select max(evaluated_at) as at from badge_progress where organization_id = ${organizationId}`,
      ),
    );
    return {
      canManage: canManageBadges(claims),
      definitions: definitions.map((definition) => definitionView(definition, counts)),
      pending: await awardViews(tx, organizationId, pending, ar),
      recent: await awardViews(tx, organizationId, recent, ar),
      lastEvaluatedAt: isoOf(evaluated?.at),
    };
  }, 20_000);
}

export async function loadBadgeHolders(
  claims: SessionClaims,
  badgeId: string,
  locale: 'ar' | 'en',
): Promise<{ definition: BadgeDefinitionView; awards: BadgeAwardView[] }> {
  const organizationId = readerOrg(claims);
  if (!UUID.test(badgeId)) fail('not_found');
  return elevatedTx(async (tx) => {
    const [definition] = await loadDefinitions(tx, organizationId, sql`and id = ${badgeId}`);
    if (!definition) fail('not_found');
    const rows = rowsOf<AwardRow>(
      await tx.execute(sql`
        select ${AWARD_COLUMNS} from badge_awards a join badge_definitions d on d.id = a.badge_id
        where a.organization_id = ${organizationId} and a.badge_id = ${badgeId}
        order by case a.status when 'active' then 0 when 'pending' then 1 else 2 end,
          coalesce(a.awarded_at, a.created_at) desc
        limit ${HOLDERS_LIMIT}
      `),
    );
    const awards = await awardViews(tx, organizationId, rows, locale === 'ar');
    const counts = new Map([
      [
        badgeId,
        {
          holders: awards.filter((award) => award.status === 'active').length,
          pending: awards.filter((award) => award.status === 'pending').length,
          ever: awards.filter((award) => ['active', 'expired', 'revoked'].includes(award.status))
            .length,
        },
      ],
    ]);
    return { definition: definitionView(definition, counts), awards };
  });
}

async function nextDefinitionSerial(tx: ElevatedTx, organizationId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`badge_def:${organizationId}`}))`);
  const [row] = rowsOf<{ n: number }>(
    await tx.execute(sql`select coalesce(max(serial_no), 0)::int as n from badge_definitions
      where organization_id = ${organizationId}`),
  );
  return Number(row?.n ?? 0) + 1;
}

function assertDefinition(input: BadgeDefinitionInput) {
  if (!input.nameAr.trim() || !input.nameEn.trim()) fail('badge_invalid');
  if (!input.criteria.length) fail('badge_invalid');
  if (input.validityDays !== null && input.validityDays < 1) fail('badge_invalid');
  const allowed = new Set<string>(metricsFor(input.subjectType));
  if (input.criteria.some((criterion) => !allowed.has(criterion.metric))) fail('badge_invalid');
}

export async function createBadgeDefinition(
  claims: SessionClaims,
  input: BadgeDefinitionInput,
): Promise<{ id: string }> {
  const organizationId = managerOrg(claims);
  assertDefinition(input);
  return elevatedTx(async (tx) => {
    await ensureCatalog(tx, organizationId);
    const serial = await nextDefinitionSerial(tx, organizationId);
    const [row] = rowsOf<{ id: string }>(
      await tx.execute(sql`
        insert into badge_definitions (
          organization_id, serial_no, code, subject_type, tier, level, name_ar, name_en,
          description_ar, description_en, icon, criteria, window_days, sustain_days, validity_days,
          auto_revoke, grant_mode, created_by_user_id
        ) values (
          ${organizationId}, ${serial}, ${`custom.${randomUUID().slice(0, 8)}`},
          ${input.subjectType}, ${input.tier}, ${input.level}, ${input.nameAr.trim()},
          ${input.nameEn.trim()}, ${input.descriptionAr}, ${input.descriptionEn}, ${input.icon},
          ${JSON.stringify(input.criteria)}::jsonb, ${input.windowDays}, ${input.sustainDays},
          ${input.validityDays}, ${input.autoRevoke}, ${input.grantMode}, ${claims.sub}
        )
        returning id::text
      `),
    );
    return { id: row!.id };
  });
}

export async function updateBadgeDefinition(
  claims: SessionClaims,
  badgeId: string,
  input: Partial<BadgeDefinitionInput> & { status?: 'active' | 'inactive' | 'archived' },
): Promise<{ ok: true }> {
  const organizationId = managerOrg(claims);
  if (!UUID.test(badgeId)) fail('not_found');
  return elevatedTx(async (tx) => {
    await tx.execute(sql`select 1 from badge_definitions
      where id = ${badgeId} and organization_id = ${organizationId} for update`);
    const [current] = await loadDefinitions(tx, organizationId, sql`and id = ${badgeId}`);
    if (!current) fail('not_found');
    const next: BadgeDefinitionInput = {
      subjectType: current.subjectType,
      tier: input.tier ?? current.tier,
      level: input.level ?? current.level,
      nameAr: input.nameAr ?? current.nameAr,
      nameEn: input.nameEn ?? current.nameEn,
      descriptionAr:
        input.descriptionAr !== undefined ? input.descriptionAr : current.descriptionAr,
      descriptionEn:
        input.descriptionEn !== undefined ? input.descriptionEn : current.descriptionEn,
      icon: input.icon ?? current.icon,
      criteria: input.criteria ?? current.criteria,
      windowDays: input.windowDays ?? current.windowDays,
      sustainDays: input.sustainDays ?? current.sustainDays,
      validityDays: input.validityDays !== undefined ? input.validityDays : current.validityDays,
      autoRevoke: input.autoRevoke ?? current.autoRevoke,
      grantMode: input.grantMode ?? current.grantMode,
    };
    assertDefinition(next);
    await tx.execute(sql`
      update badge_definitions set
        tier = ${next.tier}, level = ${next.level}, name_ar = ${next.nameAr.trim()},
        name_en = ${next.nameEn.trim()}, description_ar = ${next.descriptionAr},
        description_en = ${next.descriptionEn}, icon = ${next.icon},
        criteria = ${JSON.stringify(next.criteria)}::jsonb, window_days = ${next.windowDays},
        sustain_days = ${next.sustainDays}, validity_days = ${next.validityDays},
        auto_revoke = ${next.autoRevoke}, grant_mode = ${next.grantMode},
        status = ${input.status ?? current.status}::lifecycle_status, updated_at = now()
      where id = ${badgeId} and organization_id = ${organizationId}
    `);
    if (input.status === 'archived') {
      await tx.execute(sql`
        update badge_awards set status = case when status = 'pending' then 'rejected' else 'revoked' end,
          ended_at = now(), end_reason = 'badge_paused', updated_at = now()
        where badge_id = ${badgeId} and status in ('pending', 'active')
      `);
    }
    return { ok: true as const };
  });
}

export async function decideAward(
  claims: SessionClaims,
  awardId: string,
  action: 'approve' | 'reject' | 'revoke',
  note: string | null,
): Promise<{ status: AwardStatus }> {
  const organizationId = managerOrg(claims);
  if (!UUID.test(awardId)) fail('not_found');
  return elevatedTx(async (tx) => {
    const [award] = rowsOf<{ status: AwardStatus; validity_days: number | null }>(
      await tx.execute(sql`
        select a.status, d.validity_days from badge_awards a
          join badge_definitions d on d.id = a.badge_id
        where a.id = ${awardId} and a.organization_id = ${organizationId}
        for update of a
      `),
    );
    if (!award) fail('not_found');
    if (action === 'revoke') {
      if (award.status !== 'active') fail('badge_award_closed');
      await tx.execute(sql`
        update badge_awards set status = 'revoked', ended_at = now(),
          end_reason = ${note?.trim() || 'manual'}, decided_by_user_id = ${claims.sub}, updated_at = now()
        where id = ${awardId}
      `);
      return { status: 'revoked' as const };
    }
    if (award.status !== 'pending') fail('badge_award_closed');
    if (action === 'reject') {
      await tx.execute(sql`
        update badge_awards set status = 'rejected', ended_at = now(),
          end_reason = ${note?.trim() || 'manual'}, decided_by_user_id = ${claims.sub}, updated_at = now()
        where id = ${awardId}
      `);
      return { status: 'rejected' as const };
    }
    await tx.execute(sql`
      update badge_awards set status = 'active', awarded_at = now(),
        expires_at = ${
          award.validity_days
            ? sql`now() + make_interval(days => ${award.validity_days})`
            : sql`null`
        },
        decided_by_user_id = ${claims.sub}, updated_at = now()
      where id = ${awardId}
    `);
    return { status: 'active' as const };
  });
}

/** Candidates a badge of this kind can be granted to by hand. */
export async function listBadgeSubjects(
  claims: SessionClaims,
  subject: BadgeSubject,
  locale: 'ar' | 'en',
): Promise<{ id: string; name: string }[]> {
  const organizationId = managerOrg(claims);
  return elevatedTx(async (tx) => {
    const measured = await computeMetrics(tx, organizationId, subject, 30);
    const list = [...measured].map(([id, value]) => ({ id, name: value.name }));
    if (subject === 'property' && locale === 'en') {
      const names = await subjectNames(
        tx,
        organizationId,
        list.map((item) => ({ type: subject, id: item.id })),
        false,
      );
      list.forEach((item) => (item.name = names.get(item.id) ?? item.name));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, locale));
  }, 15_000);
}

export async function grantBadge(
  claims: SessionClaims,
  badgeId: string,
  subjectId: string,
  note: string,
): Promise<{ id: string }> {
  const organizationId = managerOrg(claims);
  if (!UUID.test(badgeId) || !UUID.test(subjectId)) fail('not_found');
  if (note.trim().length < 3) fail('badge_invalid');
  return elevatedTx(async (tx) => {
    const [definition] = await loadDefinitions(
      tx,
      organizationId,
      sql`and id = ${badgeId} and status = 'active'`,
    );
    if (!definition) fail('not_found');
    const measured = await computeMetrics(
      tx,
      organizationId,
      definition.subjectType,
      definition.windowDays,
      subjectId,
    );
    const subject = measured.get(subjectId);
    if (!subject) fail('badge_subject_invalid');
    const ids = await insertAwards(
      tx,
      organizationId,
      [
        {
          definition,
          subjectId,
          metrics: subject.metrics,
          status: 'active',
          grantedBy: claims.sub,
          note: note.trim().slice(0, 400),
        },
      ],
      new Map(),
    );
    if (!ids[0]) fail('badge_already_held');
    return { id: ids[0] };
  }, 15_000);
}

export async function runBadgeEvaluation(
  claims: SessionClaims,
  ai: AiEndpoint | null,
): Promise<EvaluationSummary> {
  const organizationId = managerOrg(claims);
  return elevatedTx((tx) => evaluateOrganization(tx, organizationId, ai), 50_000);
}

/** Every organization with badges, for the nightly job. */
export async function evaluateAllOrganizations(
  ai: AiEndpoint | null,
  deadline: number,
): Promise<{ organizations: number; summary: EvaluationSummary }> {
  const ids = await elevatedTx(async (tx) =>
    rowsOf<{ id: string }>(
      await tx.execute(sql`select id::text from organizations where status = 'active' order by id`),
    ).map((row) => row.id),
  );
  const total: EvaluationSummary = {
    subjects: 0,
    awarded: 0,
    pending: 0,
    revoked: 0,
    expired: 0,
    renewed: 0,
  };
  let done = 0;
  for (const id of ids) {
    if (Date.now() > deadline) break;
    try {
      const summary = await elevatedTx((tx) => evaluateOrganization(tx, id, ai), 40_000);
      for (const key of Object.keys(total) as (keyof EvaluationSummary)[])
        total[key] += summary[key];
      done += 1;
    } catch (error) {
      console.error('badge evaluation failed', id, error);
    }
  }
  return { organizations: done, summary: total };
}

async function subjectProgress(
  tx: ElevatedTx,
  organizationId: string,
  subject: BadgeSubject,
  subjectId: string,
  ar: boolean,
): Promise<SubjectBadges | null> {
  const definitions = (
    await loadDefinitions(
      tx,
      organizationId,
      sql`and status = 'active' and subject_type = ${subject}`,
    )
  ).filter((definition) => definition.criteria.length);
  const byWindow = new Map<number, MetricValues | null>();
  let headline: MetricValues | null = null;
  for (const definition of definitions) {
    if (!byWindow.has(definition.windowDays)) {
      const measured = await computeMetrics(
        tx,
        organizationId,
        subject,
        definition.windowDays,
        subjectId,
      );
      byWindow.set(definition.windowDays, measured.get(subjectId)?.metrics ?? null);
    }
  }
  if (!definitions.length) {
    const measured = await computeMetrics(tx, organizationId, subject, 365, subjectId);
    if (!measured.has(subjectId)) return null;
    headline = measured.get(subjectId)!.metrics;
  }
  if ([...byWindow.values()].every((value) => value === null) && !headline) return null;
  const rows = rowsOf<AwardRow>(
    await tx.execute(sql`
      select ${AWARD_COLUMNS} from badge_awards a join badge_definitions d on d.id = a.badge_id
      where a.organization_id = ${organizationId} and a.subject_type = ${subject}
        and a.subject_id = ${subjectId}
      order by case a.status when 'active' then 0 when 'pending' then 1 else 2 end,
        coalesce(a.awarded_at, a.created_at) desc
      limit 100
    `),
  );
  const awards = await awardViews(tx, organizationId, rows, ar);
  const since = new Map(
    rowsOf<{ badge_id: string; qualified_since: Date | string | null }>(
      await tx.execute(sql`select badge_id::text, qualified_since from badge_progress
        where organization_id = ${organizationId} and subject_id = ${subjectId}`),
    ).map((row) => [row.badge_id, isoOf(row.qualified_since)]),
  );
  const heldIds = new Set(
    awards
      .filter((award) => award.status === 'active' || award.status === 'pending')
      .map((award) => award.badgeId),
  );
  const progress: BadgeProgressView[] = definitions.map((definition) => {
    const metrics = byWindow.get(definition.windowDays) ?? {};
    const items = definition.criteria.map((criterion) => ({
      text: describeCriterion(criterion, ar),
      met: criterionMet(criterion, metrics),
      progress: criterionProgress(criterion, metrics),
      actual: formatMetric(criterion.metric, metrics[criterion.metric], ar),
    }));
    return {
      badgeId: definition.id,
      badgeSerial: badgeSerial(definition.serialNo),
      nameAr: definition.nameAr,
      nameEn: definition.nameEn,
      tier: definition.tier,
      level: definition.level,
      icon: definition.icon,
      criteria: items,
      progress: items.length
        ? items.reduce((sum, item) => sum + item.progress, 0) / items.length
        : 0,
      qualifiedSince: criteriaMet(definition.criteria, metrics)
        ? (since.get(definition.id) ?? null)
        : null,
      sustainDays: definition.sustainDays,
      held: heldIds.has(definition.id),
    };
  });
  const widest = [...byWindow.entries()].sort((a, b) => b[0] - a[0])[0]?.[1];
  return {
    subjectType: subject,
    subjectId,
    awards,
    progress: progress.sort((a, b) => Number(a.held) - Number(b.held) || b.progress - a.progress),
    metrics: widest ?? headline ?? {},
  };
}

/** Badges for one subject, any viewer who can open its page (contacts, properties, team). */
export async function loadSubjectBadges(
  claims: SessionClaims,
  subject: BadgeSubject,
  subjectId: string,
  locale: 'ar' | 'en',
): Promise<SubjectBadges | null> {
  if (!claims.organizationId || !UUID.test(subjectId)) fail('not_found');
  const organizationId = claims.organizationId;
  return elevatedTx(async (tx) => {
    await ensureCatalog(tx, organizationId);
    return subjectProgress(tx, organizationId, subject, subjectId, locale === 'ar');
  }, 15_000);
}

/** A party's badges as an owner, a tenant and (through its vendor record) a worker. */
export async function loadPartyBadges(
  claims: SessionClaims,
  partyId: string,
  locale: 'ar' | 'en',
): Promise<SubjectBadges[]> {
  if (!claims.organizationId || !hasPermission(claims, 'party.read') || !UUID.test(partyId))
    fail('forbidden');
  const organizationId = claims.organizationId;
  const ar = locale === 'ar';
  return elevatedTx(async (tx) => {
    await ensureCatalog(tx, organizationId);
    const result: SubjectBadges[] = [];
    for (const subject of ['owner', 'tenant'] as const) {
      const found = await subjectProgress(tx, organizationId, subject, partyId, ar);
      if (found) result.push(found);
    }
    const vendors = rowsOf<{ id: string }>(
      await tx.execute(sql`select id::text from vendors
        where organization_id = ${organizationId} and party_id = ${partyId} and active limit 3`),
    );
    for (const vendor of vendors) {
      const found = await subjectProgress(tx, organizationId, 'worker', vendor.id, ar);
      if (found) result.push(found);
    }
    return result;
  }, 20_000);
}

/** AI suggestions for reaching the next badges, from aggregate numbers only. */
export async function coachSubject(
  claims: SessionClaims,
  subject: BadgeSubject,
  subjectId: string,
  ai: AiEndpoint | null,
): Promise<{ ar: string[]; en: string[] }> {
  if (!ai) fail('ai_unconfigured');
  const data = await loadSubjectBadges(claims, subject, subjectId, 'en');
  if (!data) fail('not_found');
  const open = data.progress.filter((item) => !item.held).slice(0, 6);
  const answer = await aiChatJson(
    ai,
    'You are a performance coach for a property-management platform in Oman. Be concrete, kind and brief. Use only the numbers given.',
    'Suggest up to 4 practical steps that would earn the open badges soonest. Return JSON {"ar":[string],"en":[string]} with matching items, each under 25 words.',
    {
      subject,
      held: data.progress.filter((item) => item.held).map((item) => item.nameEn),
      open: open.map((item) => ({
        badge: item.nameEn,
        progressPct: Math.round(item.progress * 100),
        criteria: item.criteria.map((criterion) => ({
          need: criterion.text,
          now: criterion.actual,
          met: criterion.met,
        })),
      })),
    },
    'badge coach',
    25_000,
  );
  const list = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .filter((item): item is string => typeof item === 'string')
      .slice(0, 4)
      .map((item) => item.slice(0, 240));
  return { ar: list(answer.ar), en: list(answer.en) };
}

export type AwardCertificate = BadgeAwardView & {
  organizationNameAr: string;
  organizationNameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  criteria: string[];
};

export async function loadAwardCertificate(
  claims: SessionClaims,
  awardId: string,
  locale: 'ar' | 'en',
): Promise<AwardCertificate | null> {
  const organizationId = readerOrg(claims);
  if (!UUID.test(awardId)) return null;
  const ar = locale === 'ar';
  return elevatedTx(async (tx) => {
    const rows = rowsOf<
      AwardRow & {
        description_ar: string | null;
        description_en: string | null;
        criteria: unknown;
        org_ar: string;
        org_en: string;
      }
    >(
      await tx.execute(sql`
        select ${AWARD_COLUMNS}, d.description_ar, d.description_en, d.criteria,
          o.display_name_ar as org_ar, o.display_name_en as org_en
        from badge_awards a join badge_definitions d on d.id = a.badge_id
          join organizations o on o.id = a.organization_id
        where a.id = ${awardId} and a.organization_id = ${organizationId}
      `),
    );
    const row = rows[0];
    if (!row) return null;
    const [view] = await awardViews(tx, organizationId, [row], ar);
    const [definition] = await loadDefinitions(tx, organizationId, sql`and id = ${row.badge_id}`);
    return {
      ...view!,
      organizationNameAr: row.org_ar,
      organizationNameEn: row.org_en,
      descriptionAr: row.description_ar,
      descriptionEn: row.description_en,
      criteria: (definition?.criteria ?? []).map((criterion) => describeCriterion(criterion, ar)),
    };
  });
}

export type PublicAward = {
  serial: string;
  badgeNameAr: string;
  badgeNameEn: string;
  tier: BadgeAwardView['tier'];
  level: BadgeAwardView['level'];
  icon: BadgeAwardView['icon'];
  subjectType: BadgeSubject;
  holder: string;
  organizationNameAr: string;
  organizationNameEn: string;
  status: AwardStatus;
  awardedAt: string | null;
  expiresAt: string | null;
};

/** People are shown as given name and family initial; properties and businesses in full. */
function publicHolder(subject: BadgeSubject, name: string): string {
  if (subject === 'property' || subject === 'worker') return name;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '—';
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}

export async function loadPublicAward(serial: string): Promise<PublicAward | null> {
  const parsed = parseAwardSerial(serial);
  if (!parsed) return null;
  return elevatedTx(async (tx) => {
    const rows = rowsOf<AwardRow & { organization_id: string; org_ar: string; org_en: string }>(
      await tx.execute(sql`
        select ${AWARD_COLUMNS}, a.organization_id::text,
          o.display_name_ar as org_ar, o.display_name_en as org_en
        from badge_awards a join badge_definitions d on d.id = a.badge_id
          join organizations o on o.id = a.organization_id
        where a.serial_year = ${parsed.year} and a.serial_no = ${parsed.no}
          and a.status in ('active', 'expired', 'revoked')
      `),
    );
    const row = rows[0];
    if (!row) return null;
    const names = await subjectNames(
      tx,
      row.organization_id,
      [{ type: row.subject_type, id: row.subject_id }],
      true,
    );
    return {
      serial: awardSerial(Number(row.serial_year), Number(row.serial_no)),
      badgeNameAr: row.name_ar,
      badgeNameEn: row.name_en,
      tier: row.tier,
      level: row.level,
      icon: row.icon,
      subjectType: row.subject_type,
      holder: publicHolder(row.subject_type, names.get(row.subject_id) ?? '—'),
      organizationNameAr: row.org_ar,
      organizationNameEn: row.org_en,
      status: row.status,
      awardedAt: isoOf(row.awarded_at),
      expiresAt: isoOf(row.expires_at),
    };
  });
}
