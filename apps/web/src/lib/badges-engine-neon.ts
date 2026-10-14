import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { aiChatJson, type AiEndpoint } from '@/lib/ai-chat';
import {
  BADGE_METRICS,
  DEFAULT_BADGES,
  awardSerial,
  criteriaMet,
  criterionMet,
  describeCriterion,
  formatMetric,
  isMetricKey,
  rulesRationale,
  type BadgeCriterion,
  type BadgeDefinitionInput,
  type BadgeSubject,
  type EvaluationSummary,
  type MetricValues,
} from '@/lib/badges-shared';
import { rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import { appLink, queueBrandedEmail } from '@/lib/email-notify';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { partyAccounts, verifiedUsers } from '@/lib/identity-marks-neon';

const DAY_MS = 86_400_000;
/** After a person rejects or withdraws a badge, the engine waits this long before proposing it again. */
const DECLINE_COOLDOWN_DAYS = 30;
const LIVE_LEASE = sql`('active', 'cancel_requested', 'clearance_pending')`;
const AI_BATCH = 12;

export type DefinitionRow = BadgeDefinitionInput & {
  id: string;
  code: string;
  serialNo: number;
  status: string;
};

export type SubjectMetrics = { name: string; metrics: MetricValues };

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

function monthsSince(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (30.4375 * DAY_MS)));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function parseCriteria(value: unknown): BadgeCriterion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { metric, op, value: threshold } = item as Record<string, unknown>;
    if (typeof metric !== 'string' || !isMetricKey(metric)) return [];
    if (op !== 'gte' && op !== 'lte') return [];
    const parsed = Number(threshold);
    return Number.isFinite(parsed) ? [{ metric, op, value: parsed }] : [];
  });
}

type RawDefinition = {
  id: string;
  code: string;
  serial_no: number;
  subject_type: BadgeSubject;
  tier: DefinitionRow['tier'];
  level: DefinitionRow['level'];
  name_ar: string;
  name_en: string;
  description_ar: string | null;
  description_en: string | null;
  icon: DefinitionRow['icon'];
  criteria: unknown;
  window_days: number;
  sustain_days: number;
  validity_days: number | null;
  auto_revoke: boolean;
  grant_mode: DefinitionRow['grantMode'];
  status: string;
};

export function definitionFromRow(row: RawDefinition): DefinitionRow {
  return {
    id: row.id,
    code: row.code,
    serialNo: num(row.serial_no),
    subjectType: row.subject_type,
    tier: row.tier,
    level: row.level,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    descriptionAr: row.description_ar,
    descriptionEn: row.description_en,
    icon: row.icon,
    criteria: parseCriteria(row.criteria),
    windowDays: num(row.window_days),
    sustainDays: num(row.sustain_days),
    validityDays: row.validity_days === null ? null : num(row.validity_days),
    autoRevoke: row.auto_revoke,
    grantMode: row.grant_mode,
    status: row.status,
  };
}

export async function loadDefinitions(
  tx: ElevatedTx,
  organizationId: string,
  filter: SQL = sql``,
): Promise<DefinitionRow[]> {
  return rowsOf<RawDefinition>(
    await tx.execute(sql`
      select id::text, code, serial_no, subject_type, tier, level, name_ar, name_en,
        description_ar, description_en, icon, criteria, window_days, sustain_days, validity_days,
        auto_revoke, grant_mode, status::text as status
      from badge_definitions
      where organization_id = ${organizationId} ${filter}
      order by serial_no
    `),
  ).map(definitionFromRow);
}

/** Gives an organization the starter catalogue the first time its badges are opened. */
export async function ensureCatalog(tx: ElevatedTx, organizationId: string): Promise<void> {
  const [existing] = rowsOf<{ n: number }>(
    await tx.execute(
      sql`select count(*)::int as n from badge_definitions where organization_id = ${organizationId}`,
    ),
  );
  if (num(existing?.n) > 0) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`badge_seed:${organizationId}`}))`);
  const [again] = rowsOf<{ n: number }>(
    await tx.execute(
      sql`select count(*)::int as n from badge_definitions where organization_id = ${organizationId}`,
    ),
  );
  if (num(again?.n) > 0) return;
  let serial = 0;
  for (const seed of DEFAULT_BADGES) {
    serial += 1;
    await tx.execute(sql`
      insert into badge_definitions (
        organization_id, serial_no, code, subject_type, tier, level, name_ar, name_en,
        description_ar, description_en, icon, criteria, window_days, sustain_days, validity_days,
        auto_revoke, grant_mode
      ) values (
        ${organizationId}, ${serial}, ${seed.code}, ${seed.subjectType}, ${seed.tier}, ${seed.level},
        ${seed.nameAr}, ${seed.nameEn}, ${seed.descriptionAr}, ${seed.descriptionEn}, ${seed.icon},
        ${JSON.stringify(seed.criteria)}::jsonb, ${seed.windowDays}, ${seed.sustainDays},
        ${seed.validityDays}, ${seed.autoRevoke}, ${seed.grantMode}
      )
      on conflict (organization_id, code) do nothing
    `);
  }
}

async function verifiedParties(
  tx: ElevatedTx,
  organizationId: string,
  partyIds: string[],
): Promise<Set<string>> {
  if (!partyIds.length) return new Set();
  const accounts = await partyAccounts(tx, organizationId, partyIds);
  const verified = await verifiedUsers(tx, [...new Set(accounts.values())]);
  return new Set([...accounts].filter(([, user]) => verified.has(user)).map(([party]) => party));
}

type PropertyRaw = {
  id: string;
  name: string;
  owner_party_id: string;
  created_at: Date | string;
  rating_total: string | null;
  rating_n: number;
  units: number;
  occupied: number;
  open_n: number;
  resolved_n: number;
  res_total: string | null;
};

async function propertyRaw(
  tx: ElevatedTx,
  organizationId: string,
  since: string,
  filter: SQL,
): Promise<PropertyRaw[]> {
  return rowsOf<PropertyRaw>(
    await tx.execute(sql`
      with props as (
        select p.id, p.name_ar, p.owner_party_id, p.created_at from properties p
        where p.organization_id = ${organizationId} and p.status <> 'archived' ${filter}
      ),
      rated as (
        select x.property_id, sum(x.s) as total, count(*)::int as n from (
          select br.property_id, coalesce(br.property_score, br.score) / 2.0 as s
            from booking_reviews br
            where br.organization_id = ${organizationId} and br.direction = 'guest_to_host'
              and br.status = 'published' and br.created_at >= ${since}::timestamptz
          union all
          select b.property_id, sr.rating::numeric
            from stay_reviews sr join stay_bookings b on b.id = sr.booking_id
            where sr.organization_id = ${organizationId} and sr.status = 'published'
              and sr.created_at >= ${since}::timestamptz
          union all
          select r.target_id, r.rating::numeric from reviews r
            where r.organization_id = ${organizationId} and r.target_type = 'property'
              and r.status = 'published' and r.created_at >= ${since}::timestamptz
        ) x
        where x.property_id in (select id from props)
        group by x.property_id
      ),
      occ as (
        select u.property_id, count(*)::int as units,
          count(*) filter (where
            exists (select 1 from leases l where l.unit_id = u.id and l.status in ${LIVE_LEASE})
            or exists (select 1 from stay_bookings b where b.unit_id = u.id
              and b.status in ('confirmed', 'pre_arrival', 'checked_in')
              and b.check_in_on <= current_date and b.check_out_on > current_date)
          )::int as occupied
        from units u
        where u.organization_id = ${organizationId} and u.property_id in (select id from props)
        group by u.property_id
      ),
      maint as (
        select u.property_id,
          count(*) filter (where t.status in ('open', 'assigned', 'in_progress'))::int as open_n,
          count(*) filter (where t.resolved_at >= ${since}::timestamptz)::int as resolved_n,
          sum(extract(epoch from (t.resolved_at - t.created_at)) / 86400.0)
            filter (where t.resolved_at >= ${since}::timestamptz) as res_total
        from maintenance_tickets t join units u on u.id = t.unit_id
        where t.organization_id = ${organizationId} and u.property_id in (select id from props)
        group by u.property_id
      )
      select p.id::text, p.name_ar as name, p.owner_party_id::text, p.created_at,
        r.total::text as rating_total, coalesce(r.n, 0) as rating_n,
        coalesce(o.units, 0) as units, coalesce(o.occupied, 0) as occupied,
        coalesce(m.open_n, 0) as open_n, coalesce(m.resolved_n, 0) as resolved_n,
        m.res_total::text as res_total
      from props p
        left join rated r on r.property_id = p.id
        left join occ o on o.property_id = p.id
        left join maint m on m.property_id = p.id
    `),
  );
}

type Aggregate = {
  ratingTotal: number;
  ratingN: number;
  units: number;
  occupied: number;
  open: number;
  resolved: number;
  resTotal: number;
};

function aggregate(rows: PropertyRaw[]): Aggregate {
  return rows.reduce<Aggregate>(
    (sum, row) => ({
      ratingTotal: sum.ratingTotal + num(row.rating_total),
      ratingN: sum.ratingN + num(row.rating_n),
      units: sum.units + num(row.units),
      occupied: sum.occupied + num(row.occupied),
      open: sum.open + num(row.open_n),
      resolved: sum.resolved + num(row.resolved_n),
      resTotal: sum.resTotal + num(row.res_total),
    }),
    { ratingTotal: 0, ratingN: 0, units: 0, occupied: 0, open: 0, resolved: 0, resTotal: 0 },
  );
}

function aggregateMetrics(sum: Aggregate): MetricValues {
  return {
    rating_avg: sum.ratingN ? round(sum.ratingTotal / sum.ratingN) : null,
    rating_count: sum.ratingN,
    occupancy_pct: ratio(sum.occupied, sum.units),
    open_maintenance: sum.open,
    maintenance_resolved: sum.resolved,
    resolution_days: sum.resolved ? round(sum.resTotal / sum.resolved, 1) : null,
  };
}

async function propertyMetrics(
  tx: ElevatedTx,
  organizationId: string,
  since: string,
  onlyId?: string,
): Promise<Map<string, SubjectMetrics>> {
  const raw = await propertyRaw(
    tx,
    organizationId,
    since,
    onlyId ? sql`and p.id = ${onlyId}` : sql``,
  );
  const verifiedOwners = await verifiedParties(tx, organizationId, [
    ...new Set(raw.map((row) => row.owner_party_id)),
  ]);
  return new Map(
    raw.map((row) => [
      row.id,
      {
        name: row.name,
        metrics: {
          ...aggregateMetrics(aggregate([row])),
          active_months: monthsSince(row.created_at),
          owner_verified: verifiedOwners.has(row.owner_party_id) ? 1 : 0,
        },
      },
    ]),
  );
}

async function ownerMetrics(
  tx: ElevatedTx,
  organizationId: string,
  since: string,
  onlyId?: string,
): Promise<Map<string, SubjectMetrics>> {
  const owners = rowsOf<{ id: string; name: string; created_at: Date | string }>(
    await tx.execute(sql`
      select p.id::text, p.display_name as name, p.created_at from parties p
      where p.organization_id = ${organizationId} and p.status <> 'archived'
        ${onlyId ? sql`and p.id = ${onlyId}` : sql``}
        and (
          exists (select 1 from party_roles r where r.organization_id = p.organization_id
            and r.party_id = p.id and r.role_key = 'owner' and r.status = 'active')
          or exists (select 1 from properties x where x.organization_id = p.organization_id
            and x.owner_party_id = p.id and x.status <> 'archived')
        )
    `),
  );
  if (!owners.length) return new Map();
  const raw = await propertyRaw(
    tx,
    organizationId,
    since,
    onlyId ? sql`and p.owner_party_id = ${onlyId}` : sql``,
  );
  const verified = await verifiedParties(
    tx,
    organizationId,
    owners.map((row) => row.id),
  );
  return new Map(
    owners.map((owner) => {
      const own = raw.filter((row) => row.owner_party_id === owner.id);
      const firstProperty = own
        .map((row) => new Date(row.created_at).getTime())
        .filter(Number.isFinite)
        .sort((a, b) => a - b)[0];
      const start = Math.min(
        new Date(owner.created_at).getTime(),
        firstProperty ?? Number.POSITIVE_INFINITY,
      );
      return [
        owner.id,
        {
          name: owner.name,
          metrics: {
            ...aggregateMetrics(aggregate(own)),
            properties_count: own.length,
            tenure_months: monthsSince(new Date(start)),
            verified: verified.has(owner.id) ? 1 : 0,
          },
        },
      ];
    }),
  );
}

async function tenantMetrics(
  tx: ElevatedTx,
  organizationId: string,
  since: string,
  onlyId?: string,
): Promise<Map<string, SubjectMetrics>> {
  const sinceDay = since.slice(0, 10);
  const invoiceBase = sql`i.organization_id = ${organizationId} and i.tenant_party_id = t.id
    and i.status not in ('void', 'draft') and i.due_on >= ${sinceDay}::date and i.due_on <= current_date`;
  const guestBase = sql`br.organization_id = ${organizationId} and br.direction = 'host_to_guest'
    and br.status = 'published' and b.guest_party_id = t.id and br.created_at >= ${since}::timestamptz`;
  const found = rowsOf<{
    id: string;
    name: string;
    created_at: Date | string;
    due_n: number;
    on_time_n: number;
    overdue_n: number;
    guest_total: string | null;
    guest_n: number;
    stays_n: number;
    live_leases: number;
    legal_n: number;
    first_on: Date | string | null;
  }>(
    await tx.execute(sql`
      with t as (
        select p.id, p.display_name, p.created_at from parties p
        where p.organization_id = ${organizationId} and p.status <> 'archived'
          ${onlyId ? sql`and p.id = ${onlyId}` : sql``}
          and (
            exists (select 1 from party_roles r where r.organization_id = p.organization_id
              and r.party_id = p.id and r.role_key = 'tenant' and r.status = 'active')
            or exists (select 1 from leases l where l.organization_id = p.organization_id
              and l.tenant_party_id = p.id)
            or exists (select 1 from stay_bookings b where b.organization_id = p.organization_id
              and b.guest_party_id = p.id)
          )
      )
      select t.id::text, t.display_name as name, t.created_at,
        (select count(*)::int from invoices i where ${invoiceBase}) as due_n,
        (select count(*)::int from invoices i where ${invoiceBase}
          and i.paid_minor >= i.total_minor
          and coalesce((select max(pm.received_at) from payments pm
            where pm.invoice_id = i.id and pm.status = 'succeeded')::date, i.due_on) <= i.due_on
        ) as on_time_n,
        (select count(*)::int from invoices i
          where i.organization_id = ${organizationId} and i.tenant_party_id = t.id
            and i.status in ('issued', 'partially_paid', 'overdue') and i.due_on < current_date
        ) as overdue_n,
        (select sum(br.score / 2.0)::text from booking_reviews br
          join stay_bookings b on b.id = br.booking_id where ${guestBase}) as guest_total,
        (select count(*)::int from booking_reviews br
          join stay_bookings b on b.id = br.booking_id where ${guestBase}) as guest_n,
        (select count(*)::int from stay_bookings b
          where b.organization_id = ${organizationId} and b.guest_party_id = t.id
            and b.status in ('checked_out', 'closed') and b.check_out_on >= ${sinceDay}::date
        ) as stays_n,
        (select count(*)::int from leases l
          where l.organization_id = ${organizationId} and l.tenant_party_id = t.id
            and l.status in ${LIVE_LEASE}) as live_leases,
        (select count(*)::int from legal_cases lc
          where lc.organization_id = ${organizationId} and lc.counterparty_id = t.id
            and lc.opened_on >= ${sinceDay}::date) as legal_n,
        least(
          (select min(l.starts_on) from leases l
            where l.organization_id = ${organizationId} and l.tenant_party_id = t.id),
          (select min(b.check_in_on) from stay_bookings b
            where b.organization_id = ${organizationId} and b.guest_party_id = t.id
              and b.status in ('checked_in', 'checked_out', 'closed'))
        ) as first_on
      from t
    `),
  );
  const verified = await verifiedParties(
    tx,
    organizationId,
    found.map((row) => row.id),
  );
  return new Map(
    found.map((row) => {
      const guestN = num(row.guest_n);
      return [
        row.id,
        {
          name: row.name,
          metrics: {
            on_time_pct: ratio(num(row.on_time_n), num(row.due_n)),
            invoices_count: num(row.due_n),
            overdue_count: num(row.overdue_n),
            guest_rating_avg: guestN ? round(num(row.guest_total) / guestN) : null,
            guest_rating_count: guestN,
            stays_count: num(row.stays_n),
            active_leases: num(row.live_leases),
            legal_cases: num(row.legal_n),
            tenure_months: monthsSince(row.first_on ?? row.created_at),
            verified: verified.has(row.id) ? 1 : 0,
          },
        },
      ];
    }),
  );
}

async function staffMetrics(
  tx: ElevatedTx,
  organizationId: string,
  since: string,
  onlyId?: string,
): Promise<Map<string, SubjectMetrics>> {
  const doneTask = sql`w.organization_id = ${organizationId} and w.assigned_to_user_id = s.id
    and w.status = 'completed' and w.completed_at >= ${since}::timestamptz`;
  const doneHousekeeping = sql`h.organization_id = ${organizationId} and h.assigned_to_user_id = s.id
    and h.status = 'done' and h.completed_at >= ${since}::timestamptz`;
  const found = rowsOf<{
    id: string;
    name: string;
    joined: Date | string;
    tasks_done: number;
    tasks_due: number;
    tasks_on_time: number;
    hk_done: number;
    hk_on_time: number;
    tickets_done: number;
    overdue_open: number;
  }>(
    await tx.execute(sql`
      with s as (
        select u.id, u.display_name, min(m.created_at) as joined
        from memberships m join users u on u.id = m.user_id
        where m.organization_id = ${organizationId} and m.status = 'active'
          and m.role_key not in ('tenant', 'property_owner', 'lawyer')
          and u.disabled_at is null
          ${onlyId ? sql`and u.id = ${onlyId}` : sql``}
        group by u.id, u.display_name
      )
      select s.id::text, s.display_name as name, s.joined,
        (select count(*)::int from work_tasks w where ${doneTask}) as tasks_done,
        (select count(*)::int from work_tasks w where ${doneTask} and w.due_at is not null) as tasks_due,
        (select count(*)::int from work_tasks w where ${doneTask}
          and w.due_at is not null and w.completed_at <= w.due_at) as tasks_on_time,
        (select count(*)::int from stay_housekeeping_tasks h where ${doneHousekeeping}) as hk_done,
        (select count(*)::int from stay_housekeeping_tasks h where ${doneHousekeeping}
          and (h.completed_at at time zone 'Asia/Muscat')::date <= h.due_on) as hk_on_time,
        (select count(*)::int from maintenance_tickets t
          where t.organization_id = ${organizationId} and t.assigned_to_user_id = s.id
            and t.resolved_at >= ${since}::timestamptz) as tickets_done,
        (select count(*)::int from work_tasks w
          where w.organization_id = ${organizationId} and w.assigned_to_user_id = s.id
            and w.status in ('pending', 'approved', 'in_progress', 'on_hold') and w.due_at < now())
        + (select count(*)::int from stay_housekeeping_tasks h
          where h.organization_id = ${organizationId} and h.assigned_to_user_id = s.id
            and h.status in ('open', 'in_progress') and h.due_on < current_date) as overdue_open
      from s
    `),
  );
  const verified = await verifiedUsers(
    tx,
    found.map((row) => row.id),
  );
  return new Map(
    found.map((row) => [
      row.id,
      {
        name: row.name,
        metrics: {
          tasks_completed: num(row.tasks_done) + num(row.hk_done) + num(row.tickets_done),
          on_time_pct: ratio(
            num(row.tasks_on_time) + num(row.hk_on_time),
            num(row.tasks_due) + num(row.hk_done),
          ),
          overdue_open: num(row.overdue_open),
          tenure_months: monthsSince(row.joined),
          verified: verified.has(row.id) ? 1 : 0,
        },
      },
    ]),
  );
}

async function workerMetrics(
  tx: ElevatedTx,
  organizationId: string,
  since: string,
  onlyId?: string,
): Promise<Map<string, SubjectMetrics>> {
  const done = sql`w.status in ('completed', 'verified') and w.completed_at >= ${since}::timestamptz`;
  const found = rowsOf<{
    id: string;
    name: string;
    party_id: string | null;
    created_at: Date | string;
    rating: number;
    jobs: number;
    scheduled: number;
    on_time: number;
    verified_n: number;
    costed: number;
    on_budget: number;
  }>(
    await tx.execute(sql`
      select v.id::text, v.name, v.party_id::text, v.created_at, v.rating_basis_points as rating,
        count(w.id) filter (where ${done})::int as jobs,
        count(w.id) filter (where ${done} and w.scheduled_at is not null)::int as scheduled,
        count(w.id) filter (where ${done} and w.scheduled_at is not null
          and w.completed_at <= w.scheduled_at + interval '1 day')::int as on_time,
        count(w.id) filter (where ${done} and w.verified_at is not null)::int as verified_n,
        count(w.id) filter (where ${done} and w.approved_minor > 0)::int as costed,
        count(w.id) filter (where ${done} and w.approved_minor > 0
          and w.actual_minor <= w.approved_minor)::int as on_budget
      from vendors v
        left join maintenance_work_orders w
          on w.vendor_id = v.id and w.organization_id = v.organization_id
      where v.organization_id = ${organizationId} and v.active
        ${onlyId ? sql`and v.id = ${onlyId}` : sql``}
      group by v.id
    `),
  );
  const verified = await verifiedParties(
    tx,
    organizationId,
    found.map((row) => row.party_id).filter((id): id is string => !!id),
  );
  return new Map(
    found.map((row) => [
      row.id,
      {
        name: row.name,
        metrics: {
          jobs_completed: num(row.jobs),
          on_time_pct: ratio(num(row.on_time), num(row.scheduled)),
          verified_jobs_pct: ratio(num(row.verified_n), num(row.jobs)),
          cost_accuracy_pct: ratio(num(row.on_budget), num(row.costed)),
          vendor_rating: num(row.rating) > 0 ? round(num(row.rating) / 100) : null,
          tenure_months: monthsSince(row.created_at),
          verified: row.party_id && verified.has(row.party_id) ? 1 : 0,
        },
      },
    ]),
  );
}

export function computeMetrics(
  tx: ElevatedTx,
  organizationId: string,
  subject: BadgeSubject,
  windowDays: number,
  onlyId?: string,
): Promise<Map<string, SubjectMetrics>> {
  const since = new Date(Date.now() - windowDays * DAY_MS).toISOString();
  switch (subject) {
    case 'property':
      return propertyMetrics(tx, organizationId, since, onlyId);
    case 'owner':
      return ownerMetrics(tx, organizationId, since, onlyId);
    case 'tenant':
      return tenantMetrics(tx, organizationId, since, onlyId);
    case 'staff':
      return staffMetrics(tx, organizationId, since, onlyId);
    default:
      return workerMetrics(tx, organizationId, since, onlyId);
  }
}

/** Next free award serial for this year; serials are global so a certificate verifies alone. */
async function nextAwardSerial(tx: ElevatedTx, year: number): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('badge_award_serial'))`);
  const [row] = rowsOf<{ n: number }>(
    await tx.execute(
      sql`select coalesce(max(serial_no), 0)::int as n from badge_awards where serial_year = ${year}`,
    ),
  );
  return num(row?.n) + 1;
}

export type NewAward = {
  definition: DefinitionRow;
  subjectId: string;
  metrics: MetricValues;
  status: 'active' | 'pending';
  grantedBy?: string | null;
  note?: string | null;
};

export async function insertAwards(
  tx: ElevatedTx,
  organizationId: string,
  awards: NewAward[],
  rationales: Map<number, { ar: string; en: string }>,
): Promise<string[]> {
  if (!awards.length) return [];
  const year = new Date().getUTCFullYear();
  let serial = await nextAwardSerial(tx, year);
  const ids: string[] = [];
  for (const [index, award] of awards.entries()) {
    const ai = rationales.get(index);
    const rationaleAr =
      award.note ?? ai?.ar ?? rulesRationale(award.definition, award.metrics, true);
    const rationaleEn =
      award.note ?? ai?.en ?? rulesRationale(award.definition, award.metrics, false);
    const active = award.status === 'active';
    const [row] = rowsOf<{ id: string }>(
      await tx.execute(sql`
        insert into badge_awards (
          organization_id, badge_id, subject_type, subject_id, serial_year, serial_no, status,
          awarded_at, expires_at, metrics, rationale_ar, rationale_en, ai_engine, granted_by_user_id
        ) values (
          ${organizationId}, ${award.definition.id}, ${award.definition.subjectType},
          ${award.subjectId}, ${year}, ${serial}, ${award.status},
          ${active ? sql`now()` : sql`null`},
          ${
            active && award.definition.validityDays
              ? sql`now() + make_interval(days => ${award.definition.validityDays})`
              : sql`null`
          },
          ${JSON.stringify(award.metrics)}::jsonb, ${rationaleAr}, ${rationaleEn},
          ${award.note ? 'manual' : ai ? 'ai' : 'rules'}, ${award.grantedBy ?? null}
        )
        on conflict do nothing
        returning id::text
      `),
    );
    if (row) {
      ids.push(row.id);
      serial += 1;
    }
  }
  const granted = ids.filter((_, index) => awards[index]?.status === 'active');
  if (granted.length) await queueAwardEmails(tx, granted);
  return ids;
}

/**
 * Congratulates whoever earned a badge: the tenant or owner themself, the staff member, the
 * worker's contact, or a property's owner for a property badge.
 */
export async function queueAwardEmails(tx: ElevatedTx, awardIds: string[]): Promise<void> {
  if (!awardIds.length) return;
  try {
    await tx.transaction(async (savepoint) => {
      const rows = rowsOf<{
        id: string;
        organization_id: string;
        subject_type: string;
        serial_year: number;
        serial_no: number;
        rationale_ar: string | null;
        name_ar: string;
        icon: string | null;
        email: string | null;
        name: string | null;
        property_name: string | null;
      }>(
        await savepoint.execute(sql`
          select a.id::text, a.organization_id::text, a.subject_type, a.serial_year, a.serial_no,
            a.rationale_ar, d.name_ar, d.icon,
            case when a.subject_type = 'staff' then u.email else p.email end as email,
            case when a.subject_type = 'staff' then u.display_name else p.display_name end as name,
            pr.name_ar as property_name
          from badge_awards a
          join badge_definitions d on d.id = a.badge_id
          left join users u on a.subject_type = 'staff' and u.id = a.subject_id
          left join vendors v on a.subject_type = 'worker' and v.id = a.subject_id
          left join properties pr on a.subject_type = 'property' and pr.id = a.subject_id
          left join parties p on p.id = case a.subject_type
            when 'worker' then v.party_id when 'property' then pr.owner_party_id
            when 'staff' then null else a.subject_id end
          where a.id = any(${`{${awardIds.join(',')}}`}::uuid[]) and a.status = 'active'
        `),
      );
      for (const row of rows) {
        const serial = awardSerial(num(row.serial_year), num(row.serial_no));
        await queueBrandedEmail(savepoint, {
          orgId: row.organization_id,
          recipient: row.email,
          recipientName: row.name,
          subject: `🏆 مبروك! حصلت${row.property_name ? ` لعقارك «${row.property_name}»` : ''} على شارة «${row.name_ar}»`,
          aggregateType: 'badge_award',
          aggregateId: row.id,
          tone: 'reward',
          title: `شارة «${row.name_ar}» صارت لك!`,
          intro: row.property_name
            ? `استحق عقارك «${row.property_name}» شارة جديدة تظهر لكل من يزوره على المنصة.`
            : 'استحققت شارة جديدة تقديراً لأدائك، وتظهر في ملفك على المنصة.',
          lines: row.rationale_ar ? [row.rationale_ar] : [],
          details: [
            { label: 'الشارة', value: row.name_ar },
            { label: 'رقم الشهادة', value: serial },
          ],
          cta: { label: 'عرض الشهادة', url: appLink(`/ar/verify/badge/${serial}`) },
        });
      }
    });
    sendQueuedEmailsSoon();
  } catch (error) {
    console.error('badge award emails failed', error instanceof Error ? error.message : '');
  }
}

/** One AI call explaining every new award, from aggregate numbers only (no names, no ids). */
async function aiRationales(
  ai: AiEndpoint | null,
  awards: NewAward[],
): Promise<Map<number, { ar: string; en: string }>> {
  const result = new Map<number, { ar: string; en: string }>();
  if (!ai || !awards.length) return result;
  const batch = awards.slice(0, AI_BATCH).map((award, index) => ({
    key: index,
    badge: award.definition.nameEn,
    badgeAr: award.definition.nameAr,
    tier: award.definition.tier,
    subject: award.definition.subjectType,
    windowDays: award.definition.windowDays,
    sustainDays: award.definition.sustainDays,
    criteria: award.definition.criteria.map((criterion) => describeCriterion(criterion, false)),
    measured: Object.fromEntries(
      award.definition.criteria.map((criterion) => [
        BADGE_METRICS[criterion.metric].en,
        formatMetric(criterion.metric, award.metrics[criterion.metric], false),
      ]),
    ),
  }));
  try {
    const answer = await aiChatJson(
      ai,
      'You write short, warm, factual award citations for a property-management platform in Oman. Never invent numbers; use only the measured values given. No names.',
      'For each item write one sentence (max 30 words) in Arabic ("ar") and English ("en") explaining why the badge was earned. Return JSON {"items":[{"key":number,"ar":string,"en":string}]}.',
      { items: batch },
      'badge rationale',
      25_000,
    );
    const items = Array.isArray(answer.items) ? answer.items : [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const { key, ar, en } = item as Record<string, unknown>;
      if (typeof key === 'number' && typeof ar === 'string' && typeof en === 'string') {
        result.set(key, { ar: ar.slice(0, 400), en: en.slice(0, 400) });
      }
    }
  } catch {
    /* rules text is used instead */
  }
  return result;
}

/**
 * Re-measures every subject against every active badge of one organization: expires awards past
 * their validity, revokes those whose criteria stopped holding, and grants (or proposes, for
 * approval badges) those whose criteria have held for the sustain period.
 */
export async function evaluateOrganization(
  tx: ElevatedTx,
  organizationId: string,
  ai: AiEndpoint | null,
): Promise<EvaluationSummary> {
  await ensureCatalog(tx, organizationId);
  const summary: EvaluationSummary = {
    subjects: 0,
    awarded: 0,
    pending: 0,
    revoked: 0,
    expired: 0,
    renewed: 0,
  };
  const expired = rowsOf<{ badge_id: string; subject_id: string }>(
    await tx.execute(sql`
      update badge_awards
      set status = 'expired', ended_at = now(), end_reason = 'expired', updated_at = now()
      where organization_id = ${organizationId} and status = 'active'
        and expires_at is not null and expires_at <= now()
      returning badge_id::text, subject_id::text
    `),
  );
  summary.expired = expired.length;
  const justExpired = new Set(expired.map((row) => `${row.badge_id}:${row.subject_id}`));

  const definitions = (
    await loadDefinitions(tx, organizationId, sql`and status = 'active'`)
  ).filter((definition) => definition.criteria.length);
  const live = new Map(
    rowsOf<{ id: string; badge_id: string; subject_id: string; status: string; manual: boolean }>(
      await tx.execute(sql`
        select id::text, badge_id::text, subject_id::text, status,
          granted_by_user_id is not null as manual
        from badge_awards
        where organization_id = ${organizationId} and status in ('pending', 'active')
      `),
    ).map((row) => [`${row.badge_id}:${row.subject_id}`, row]),
  );
  const declined = new Map(
    rowsOf<{ badge_id: string; subject_id: string; ended_at: Date | string }>(
      await tx.execute(sql`
        select badge_id::text, subject_id::text, max(ended_at) as ended_at from badge_awards
        where organization_id = ${organizationId} and status in ('rejected', 'revoked')
          and decided_by_user_id is not null and ended_at is not null
          and end_reason not like 'criteria:%' and end_reason <> 'badge_paused'
        group by badge_id, subject_id
      `),
    ).map((row) => [`${row.badge_id}:${row.subject_id}`, new Date(row.ended_at).getTime()]),
  );
  const progress = new Map(
    rowsOf<{ badge_id: string; subject_id: string; qualified_since: Date | string | null }>(
      await tx.execute(sql`
        select badge_id::text, subject_id::text, qualified_since from badge_progress
        where organization_id = ${organizationId}
      `),
    ).map((row) => [`${row.badge_id}:${row.subject_id}`, row.qualified_since]),
  );

  const metricCache = new Map<string, Map<string, SubjectMetrics>>();
  const subjects = new Set<string>();
  const grants: NewAward[] = [];
  const now = Date.now();

  for (const definition of definitions) {
    const cacheKey = `${definition.subjectType}:${definition.windowDays}`;
    let measured = metricCache.get(cacheKey);
    if (!measured) {
      measured = await computeMetrics(
        tx,
        organizationId,
        definition.subjectType,
        definition.windowDays,
      );
      metricCache.set(cacheKey, measured);
    }
    const progressRows: SQL[] = [];
    for (const [subjectId, { metrics }] of measured) {
      subjects.add(`${definition.subjectType}:${subjectId}`);
      const key = `${definition.id}:${subjectId}`;
      const met = criteriaMet(definition.criteria, metrics);
      const since = progress.get(key);
      progressRows.push(
        sql`(${definition.id}::uuid, ${subjectId}::uuid, ${organizationId}::uuid, ${met ? sql`now()` : sql`null`})`,
      );
      const current = live.get(key);
      if (current) {
        if (met) continue;
        const failing = definition.criteria
          .filter((criterion) => !criterionMet(criterion, metrics))
          .map((criterion) => criterion.metric)
          .join(',');
        if (current.status === 'active' && definition.autoRevoke && !current.manual) {
          await tx.execute(sql`
            update badge_awards
            set status = 'revoked', ended_at = now(), end_reason = ${`criteria:${failing}`},
              metrics = ${JSON.stringify(metrics)}::jsonb, updated_at = now()
            where id = ${current.id} and status = 'active'
          `);
          summary.revoked += 1;
        } else if (current.status === 'pending') {
          await tx.execute(sql`
            update badge_awards
            set status = 'rejected', ended_at = now(), end_reason = ${`criteria:${failing}`},
              updated_at = now()
            where id = ${current.id} and status = 'pending'
          `);
        }
        continue;
      }
      if (!met || definition.grantMode === 'manual') continue;
      const declinedAt = declined.get(key);
      if (
        declinedAt &&
        now - declinedAt < Math.max(definition.windowDays, DECLINE_COOLDOWN_DAYS) * DAY_MS
      )
        continue;
      const sinceMs = since ? new Date(since).getTime() : now;
      if (now - sinceMs < definition.sustainDays * DAY_MS) continue;
      const status = definition.grantMode === 'auto' ? 'active' : 'pending';
      grants.push({ definition, subjectId, metrics, status });
      if (justExpired.has(key)) summary.renewed += 1;
    }
    for (let index = 0; index < progressRows.length; index += 500) {
      await tx.execute(sql`
        insert into badge_progress (badge_id, subject_id, organization_id, qualified_since)
        values ${sql.join(progressRows.slice(index, index + 500), sql`, `)}
        on conflict (badge_id, subject_id) do update set
          qualified_since = case when excluded.qualified_since is null then null
            else coalesce(badge_progress.qualified_since, excluded.qualified_since) end,
          evaluated_at = now()
      `);
    }
  }

  const rationales = await aiRationales(ai, grants);
  await insertAwards(tx, organizationId, grants, rationales);
  summary.subjects = subjects.size;
  summary.awarded = grants.filter((grant) => grant.status === 'active').length;
  summary.pending = grants.filter((grant) => grant.status === 'pending').length;
  return summary;
}
