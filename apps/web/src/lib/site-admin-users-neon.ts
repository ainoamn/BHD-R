import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { auditLogs, credentialTokens } from '@bhd-r/db';
import { elevatedTx, isoOf, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import { appLink, queueBrandedEmail } from '@/lib/email-notify';
import { sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { unlockUserAccount } from '@/lib/security-protection';
import { requireScope } from '@/lib/site-admin-neon';
import {
  DEFAULT_PLANS,
  SUBSCRIPTION_LABELS,
  SUBSCRIPTION_STATUSES,
  parsePlan,
  type AdminContractInspect,
  type AdminPropertyInspect,
  type AdminUserDetail,
  type AdminUserOrg,
  type PlanDefinition,
  type SubscriptionStatus,
} from '@/lib/site-admin-shared';

const PLANS_KEY = 'plan_catalog';
const SUBSCRIPTIONS_KEY = 'organization_subscriptions';
const CONTACTS_KEY = 'site_admin_contacts';
const DELEGATES_KEY = 'site_admin_delegates';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code: string): never {
  throw new Error(code);
}

type StoredSubscription = {
  status: SubscriptionStatus;
  endsOn: string | null;
  note?: string | null;
  updatedAt?: string | null;
};

function readCatalog(value: unknown): PlanDefinition[] {
  const list = (value as { plans?: unknown } | null)?.plans;
  if (!Array.isArray(list)) return DEFAULT_PLANS;
  const plans = list.map(parsePlan).filter((plan): plan is PlanDefinition => plan !== null);
  return plans.some((plan) => plan.key === 'starter') ? plans : DEFAULT_PLANS;
}

function readSubscriptions(value: unknown): Record<string, StoredSubscription> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, StoredSubscription> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!UUID.test(id) || !raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    out[id] = {
      status: (SUBSCRIPTION_STATUSES as readonly string[]).includes(String(row.status))
        ? (row.status as SubscriptionStatus)
        : 'active',
      endsOn: typeof row.endsOn === 'string' ? row.endsOn : null,
    };
  }
  return out;
}

async function readSetting(tx: ElevatedTx, key: string): Promise<unknown> {
  const [row] = rowsOf<{ value: unknown }>(
    await tx.execute(sql`select value from platform_settings where key = ${key} limit 1`),
  );
  return row?.value ?? null;
}

async function adminEmailSet(tx: ElevatedTx): Promise<Set<string>> {
  const contacts = (await readSetting(tx, CONTACTS_KEY)) as { emails?: unknown } | null;
  const delegates = (await readSetting(tx, DELEGATES_KEY)) as
    | { delegates?: Array<{ email?: string }> }
    | Array<{ email?: string }>
    | null;
  const all = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.includes('@')) all.add(value.trim().toLowerCase());
  };
  if (Array.isArray(contacts?.emails)) contacts.emails.forEach(push);
  if (Array.isArray(contacts)) (contacts as unknown as unknown[]).forEach(push);
  const list = Array.isArray(delegates)
    ? delegates
    : Array.isArray(delegates?.delegates)
      ? delegates.delegates
      : [];
  for (const row of list) push(row?.email);
  return all;
}

function shortHash(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function num(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function uuidList(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

/** Full dossier for one account: orgs, assets, leases, reviews, storage, sessions. */
export function getAdminUserDetail(
  claims: SessionClaims,
  userId: string,
): Promise<AdminUserDetail> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'users');
    if (!UUID.test(userId)) fail('user_not_found');

    const adminEmails = await adminEmailSet(tx);
    const catalog = readCatalog(await readSetting(tx, PLANS_KEY));
    const subscriptions = readSubscriptions(await readSetting(tx, SUBSCRIPTIONS_KEY));
    const planByKey = new Map(catalog.map((plan) => [plan.key, plan]));

    const [user] = rowsOf<{
      id: string;
      email: string | null;
      username: string;
      display_name: string;
      locale: string;
      created_at: Date | string | null;
      disabled_at: Date | string | null;
      security_locked_at: Date | string | null;
      phone: string | null;
      party_email: string | null;
      session_country: string | null;
      country_name_ar: string | null;
      country_name_en: string | null;
    }>(
      await tx.execute(sql`
        select u.id::text, u.email, u.username, u.display_name, u.locale,
          u.created_at, u.disabled_at, u.security_locked_at,
          (select p.phone from memberships m
            join parties p on p.id = m.party_id
            where m.user_id = u.id and m.status = 'active' and p.phone is not null
            order by m.created_at limit 1) as phone,
          (select p.email from memberships m
            join parties p on p.id = m.party_id
            where m.user_id = u.id and m.status = 'active' and p.email is not null
            order by m.created_at limit 1) as party_email,
          (select s.country_code from sessions s
            where s.user_id = u.id and s.country_code is not null and s.country_code <> ''
            order by s.created_at desc limit 1) as session_country,
          (select cp.name_ar from country_packs cp
            where cp.country_code = coalesce(
              (select s.country_code from sessions s
                where s.user_id = u.id and s.country_code is not null and s.country_code <> ''
                order by s.created_at desc limit 1),
              (select o.country_code from memberships m
                join organizations o on o.id = m.organization_id
                where m.user_id = u.id and m.status = 'active'
                order by m.created_at limit 1)
            ) limit 1) as country_name_ar,
          (select cp.name_en from country_packs cp
            where cp.country_code = coalesce(
              (select s.country_code from sessions s
                where s.user_id = u.id and s.country_code is not null and s.country_code <> ''
                order by s.created_at desc limit 1),
              (select o.country_code from memberships m
                join organizations o on o.id = m.organization_id
                where m.user_id = u.id and m.status = 'active'
                order by m.created_at limit 1)
            ) limit 1) as country_name_en
        from users u where u.id = ${userId}::uuid
      `),
    );
    if (!user) fail('user_not_found');

    const memberships = rowsOf<{
      organization_id: string;
      name_ar: string;
      name_en: string | null;
      role: string;
      country_code: string;
      plan_key: string;
      party_id: string | null;
    }>(
      await tx.execute(sql`
        select o.id::text as organization_id, o.display_name_ar as name_ar,
          o.display_name_en as name_en, m.role_key as role, o.country_code, o.plan_key,
          m.party_id::text as party_id
        from memberships m
        join organizations o on o.id = m.organization_id
        where m.user_id = ${userId}::uuid and m.status = 'active'
        order by m.created_at
      `),
    );

    const partyIds = [...new Set(memberships.map((m) => m.party_id).filter(Boolean))] as string[];

    const storageByOrg = rowsOf<{ organization_id: string; name_ar: string; bytes: string }>(
      await tx.execute(sql`
        select ma.organization_id::text, o.display_name_ar as name_ar,
          coalesce(sum(ma.byte_size), 0)::text as bytes
        from media_assets ma
        join organizations o on o.id = ma.organization_id
        where ma.uploaded_by_user_id = ${userId}::uuid
        group by ma.organization_id, o.display_name_ar
        order by sum(ma.byte_size) desc
      `),
    );
    const storageMap = new Map(storageByOrg.map((row) => [row.organization_id, num(row.bytes)]));

    const organizations: AdminUserOrg[] = memberships.map((m) => {
      const plan = planByKey.get(m.plan_key) ?? planByKey.get('starter') ?? DEFAULT_PLANS[0]!;
      const sub = subscriptions[m.organization_id];
      return {
        id: m.organization_id,
        nameAr: m.name_ar,
        nameEn: m.name_en,
        role: m.role,
        countryCode: m.country_code,
        planKey: plan.key,
        planNameAr: plan.nameAr,
        planNameEn: plan.nameEn,
        subscriptionStatus: sub?.status ?? 'active',
        subscriptionEndsOn: sub?.endsOn ?? null,
        storageUsedBytes: storageMap.get(m.organization_id) ?? 0,
        storageLimitBytes: plan.storageGb * 1024 * 1024 * 1024,
      };
    });

    const propertiesOwned = partyIds.length
      ? rowsOf<{
          id: string;
          name_ar: string;
          name_en: string;
          status: string;
          kind: string;
          organization_id: string;
          org_name: string;
          listing_slug: string | null;
          units: number;
        }>(
          await tx.execute(sql`
            select p.id::text, p.name_ar, p.name_en, p.status::text, p.kind::text,
              p.organization_id::text, o.display_name_ar as org_name,
              (select l.slug from units u
                join listings l on l.unit_id = u.id and l.enabled = true
                where u.property_id = p.id order by l.published_at desc nulls last limit 1
              ) as listing_slug,
              (select count(*)::int from units u where u.property_id = p.id) as units
            from properties p
            join organizations o on o.id = p.organization_id
            where p.owner_party_id in (${uuidList(partyIds)})
               or exists (
                 select 1 from property_ownership_interests poi
                 where poi.property_id = p.id
                   and poi.party_id in (${uuidList(partyIds)})
                   and poi.role in ('owner', 'usufructuary', 'representative')
               )
            order by p.created_at desc
            limit 200
          `),
        )
      : [];

    const leasesAsTenant = partyIds.length
      ? rowsOf<{
          id: string;
          status: string;
          starts_on: string;
          ends_on: string;
          property_id: string;
          property_name_ar: string;
          property_name_en: string;
          unit_id: string;
          unit_name_ar: string;
          owner_name: string;
          contract_id: string | null;
          organization_id: string;
        }>(
          await tx.execute(sql`
            select l.id::text, l.status::text, l.starts_on::text, l.ends_on::text,
              p.id::text as property_id, p.name_ar as property_name_ar, p.name_en as property_name_en,
              u.id::text as unit_id, u.name_ar as unit_name_ar,
              op.display_name as owner_name, l.contract_id::text, l.organization_id::text
            from leases l
            join units u on u.id = l.unit_id
            join properties p on p.id = u.property_id
            join parties op on op.id = l.owner_party_id
            where l.tenant_party_id in (${uuidList(partyIds)})
            order by l.starts_on desc
            limit 200
          `),
        )
      : [];

    const contracts = partyIds.length
      ? rowsOf<{
          id: string;
          reference: string | null;
          kind: string;
          status: string;
          property_id: string;
          property_name_ar: string;
          unit_id: string;
          role: 'owner' | 'tenant';
          counterparty: string;
          completed_at: Date | string | null;
        }>(
          await tx.execute(sql`
            select c.id::text, c.reference, c.kind, c.status::text,
              p.id::text as property_id, p.name_ar as property_name_ar, c.unit_id::text,
              case when c.owner_party_id in (${uuidList(partyIds)}) then 'owner' else 'tenant' end as role,
              case when c.owner_party_id in (${uuidList(partyIds)})
                then tp.display_name else op.display_name end as counterparty,
              c.completed_at
            from contracts c
            join units u on u.id = c.unit_id
            join properties p on p.id = u.property_id
            join parties op on op.id = c.owner_party_id
            join parties tp on tp.id = c.tenant_party_id
            where c.owner_party_id in (${uuidList(partyIds)})
               or c.tenant_party_id in (${uuidList(partyIds)})
            order by c.created_at desc
            limit 200
          `),
        )
      : [];

    const authoredReviews = rowsOf<{
      id: string;
      source: string;
      score: number;
      target_label: string;
      status: string;
      created_at: Date | string | null;
      comment: string | null;
    }>(
      await tx.execute(sql`
        (select r.id::text, 'reviews'::text as source, r.rating::float as score,
            (r.target_type::text || ' · ' || left(r.target_id::text, 8)) as target_label,
            r.status::text, r.created_at, r.body as comment
          from reviews r where r.author_user_id = ${userId}::uuid
          order by r.created_at desc limit 40)
        union all
        (select sr.id::text, 'stay'::text as source, sr.rating::float as score,
            coalesce(p.name_ar, 'إقامة') as target_label,
            sr.status, sr.created_at, sr.body as comment
          from stay_reviews sr
          left join stay_bookings sb on sb.id = sr.booking_id
          left join properties p on p.id = sb.property_id
          where sr.author_user_id = ${userId}::uuid
          order by sr.created_at desc limit 40)
        union all
        (select br.id::text, 'booking'::text as source, br.score::float as score,
            coalesce(p.name_ar, 'حجز') as target_label,
            br.status, br.created_at, br.comment
          from booking_reviews br
          left join properties p on p.id = br.property_id
          where br.author_user_id = ${userId}::uuid
          order by br.created_at desc limit 40)
      `),
    );

    const receivedReviews = rowsOf<{
      id: string;
      source: string;
      score: number;
      target_label: string;
      status: string;
      created_at: Date | string | null;
      comment: string | null;
    }>(
      await tx.execute(sql`
        select br.id::text, 'booking'::text as source, br.score::float as score,
          coalesce(br.author_name, 'مضيف') as target_label,
          br.status, br.created_at, br.comment
        from booking_reviews br
        where br.subject_user_id = ${userId}::uuid
          and br.direction = 'host_to_guest'
        order by br.created_at desc
        limit 50
      `),
    );

    const sessionColsReady = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`
        select exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'sessions' and column_name = 'device_kind'
        ) as ok
      `),
    );
    const enrichedSessions = Boolean(sessionColsReady[0]?.ok);
    const sessions = enrichedSessions
      ? rowsOf<{
          id: string;
          country_code: string | null;
          country_name_ar: string | null;
          country_name_en: string | null;
          region: string | null;
          city: string | null;
          ip_address: string | null;
          ip_hash: string | null;
          device_kind: string | null;
          device_label: string | null;
          user_agent_hash: string | null;
          created_at: Date | string | null;
          expires_at: Date | string | null;
          revoked_at: Date | string | null;
        }>(
          await tx.execute(sql`
            select s.id::text, s.country_code, cp.name_ar as country_name_ar, cp.name_en as country_name_en,
              s.region, s.city, s.ip_address, s.ip_hash, s.device_kind, s.device_label,
              s.user_agent_hash, s.created_at, s.expires_at, s.revoked_at
            from sessions s
            left join country_packs cp on cp.country_code = s.country_code
            where s.user_id = ${userId}::uuid
            order by s.created_at desc
            limit 100
          `),
        )
      : rowsOf<{
          id: string;
          country_code: string | null;
          country_name_ar: string | null;
          country_name_en: string | null;
          region: string | null;
          city: string | null;
          ip_address: string | null;
          ip_hash: string | null;
          device_kind: string | null;
          device_label: string | null;
          user_agent_hash: string | null;
          created_at: Date | string | null;
          expires_at: Date | string | null;
          revoked_at: Date | string | null;
        }>(
          await tx.execute(sql`
            select s.id::text, s.country_code, cp.name_ar as country_name_ar, cp.name_en as country_name_en,
              null::text as region, null::text as city, null::text as ip_address, s.ip_hash,
              null::text as device_kind, null::text as device_label,
              s.user_agent_hash, s.created_at, s.expires_at, s.revoked_at
            from sessions s
            left join country_packs cp on cp.country_code = s.country_code
            where s.user_id = ${userId}::uuid
            order by s.created_at desc
            limit 100
          `),
        );

    const authReady = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`
        select to_regclass('public.security_auth_attempts') is not null as ok
      `),
    );
    const authAttempts = authReady[0]?.ok
      ? rowsOf<{
          id: string;
          created_at: Date | string | null;
          outcome: string;
          ip_address: string | null;
          ip_hash: string;
          country_code: string | null;
          country_name_ar: string | null;
          country_name_en: string | null;
          user_agent_hash: string | null;
          reason: string | null;
          metadata: unknown;
        }>(
          await tx.execute(sql`
            select a.id::text, a.created_at, a.outcome, a.ip_address, a.ip_hash, a.country_code,
              cp.name_ar as country_name_ar, cp.name_en as country_name_en,
              a.user_agent_hash, a.reason, a.metadata
            from security_auth_attempts a
            left join country_packs cp on cp.country_code = a.country_code
            where a.user_id = ${userId}::uuid
            order by a.created_at desc
            limit 100
          `),
        )
      : [];

    const audit = rowsOf<{
      occurred_at: Date | string | null;
      action: string;
      resource_type: string;
      resource_id: string | null;
    }>(
      await tx.execute(sql`
        select occurred_at, action, resource_type, resource_id::text
        from audit_logs
        where actor_user_id = ${userId}::uuid
        order by occurred_at desc
        limit 60
      `),
    );

    const uploadedBytes = storageByOrg.reduce((sum, row) => sum + num(row.bytes), 0);
    const primaryCountry = user.session_country || organizations[0]?.countryCode || null;

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      locale: user.locale,
      createdAt: isoOf(user.created_at),
      disabledAt: isoOf(user.disabled_at),
      securityLockedAt: isoOf(user.security_locked_at),
      isSiteAdmin: Boolean(user.email && adminEmails.has(user.email.trim().toLowerCase())),
      phone: user.phone,
      partyEmail: user.party_email,
      countryCode: primaryCountry,
      countryNameAr: user.country_name_ar,
      countryNameEn: user.country_name_en,
      organizations,
      propertiesOwned: propertiesOwned.map((row) => ({
        id: row.id,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        status: row.status,
        kind: row.kind,
        organizationId: row.organization_id,
        organizationNameAr: row.org_name,
        listingSlug: row.listing_slug,
        units: Number(row.units),
      })),
      leasesAsTenant: leasesAsTenant.map((row) => ({
        id: row.id,
        status: row.status,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        propertyId: row.property_id,
        propertyNameAr: row.property_name_ar,
        propertyNameEn: row.property_name_en,
        unitId: row.unit_id,
        unitNameAr: row.unit_name_ar,
        ownerName: row.owner_name,
        contractId: row.contract_id,
        organizationId: row.organization_id,
      })),
      contracts: contracts.map((row) => ({
        id: row.id,
        reference: row.reference,
        kind: row.kind,
        status: row.status,
        propertyId: row.property_id,
        propertyNameAr: row.property_name_ar,
        unitId: row.unit_id,
        role: row.role,
        counterpartyName: row.counterparty,
        completedAt: isoOf(row.completed_at),
      })),
      reviews: [
        ...authoredReviews.map((row) => ({
          id: row.id,
          source: row.source as 'reviews' | 'stay' | 'booking',
          direction: 'authored' as const,
          score: Number(row.score),
          targetLabel: row.target_label,
          status: row.status,
          createdAt: isoOf(row.created_at),
          comment: row.comment,
        })),
        ...receivedReviews.map((row) => ({
          id: row.id,
          source: 'booking' as const,
          direction: 'received' as const,
          score: Number(row.score),
          targetLabel: row.target_label,
          status: row.status,
          createdAt: isoOf(row.created_at),
          comment: row.comment,
        })),
      ].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
      storage: {
        uploadedBytes,
        byOrganization: storageByOrg.map((row) => ({
          organizationId: row.organization_id,
          nameAr: row.name_ar,
          bytes: num(row.bytes),
        })),
      },
      sessions: sessions.map((row) => {
        const revoked = Boolean(row.revoked_at);
        const expired = row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : true;
        const kind =
          row.device_kind === 'phone' ||
          row.device_kind === 'tablet' ||
          row.device_kind === 'desktop' ||
          row.device_kind === 'unknown'
            ? row.device_kind
            : null;
        return {
          id: row.id,
          countryCode: row.country_code,
          countryNameAr: row.country_name_ar,
          countryNameEn: row.country_name_en,
          region: row.region,
          city: row.city,
          ipAddress: row.ip_address,
          ipHash: shortHash(row.ip_hash),
          deviceKind: kind,
          deviceLabel: row.device_label,
          deviceHash: shortHash(row.user_agent_hash),
          createdAt: isoOf(row.created_at),
          expiresAt: isoOf(row.expires_at),
          revokedAt: isoOf(row.revoked_at),
          active: !revoked && !expired,
        };
      }),
      authAttempts: authAttempts.map((row) => {
        const meta =
          row.metadata && typeof row.metadata === 'object'
            ? (row.metadata as Record<string, unknown>)
            : {};
        const kindRaw = typeof meta.deviceKind === 'string' ? meta.deviceKind : null;
        const kind =
          kindRaw === 'phone' ||
          kindRaw === 'tablet' ||
          kindRaw === 'desktop' ||
          kindRaw === 'unknown'
            ? kindRaw
            : null;
        return {
          id: row.id,
          at: isoOf(row.created_at),
          outcome: row.outcome,
          ipAddress: row.ip_address,
          ipHash: shortHash(row.ip_hash) ?? row.ip_hash.slice(0, 10),
          countryCode: row.country_code,
          countryNameAr: row.country_name_ar,
          countryNameEn: row.country_name_en,
          region: typeof meta.region === 'string' ? meta.region : null,
          city: typeof meta.city === 'string' ? meta.city : null,
          deviceKind: kind,
          deviceLabel: typeof meta.deviceLabel === 'string' ? meta.deviceLabel : null,
          deviceHash: shortHash(row.user_agent_hash),
          reason: row.reason,
        };
      }),
      audit: audit.map((row) => ({
        at: isoOf(row.occurred_at),
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
      })),
      plans: catalog.filter((plan) => plan.active || plan.key === 'starter'),
    };
  }, 20_000);
}

export function getAdminPropertyInspect(
  claims: SessionClaims,
  propertyId: string,
): Promise<AdminPropertyInspect> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'users');
    if (!UUID.test(propertyId)) fail('property_not_found');

    const [property] = rowsOf<{
      id: string;
      name_ar: string;
      name_en: string;
      status: string;
      kind: string;
      category: string;
      organization_id: string;
      org_name: string;
      owner_name: string;
      country_code: string | null;
      listing_slug: string | null;
    }>(
      await tx.execute(sql`
        select p.id::text, p.name_ar, p.name_en, p.status::text, p.kind::text, p.category::text,
          p.organization_id::text, o.display_name_ar as org_name, op.display_name as owner_name,
          o.country_code,
          (select l.slug from units u
            join listings l on l.unit_id = u.id and l.enabled = true
            where u.property_id = p.id order by l.published_at desc nulls last limit 1
          ) as listing_slug
        from properties p
        join organizations o on o.id = p.organization_id
        join parties op on op.id = p.owner_party_id
        where p.id = ${propertyId}::uuid
      `),
    );
    if (!property) fail('property_not_found');

    const units = rowsOf<{ id: string; name_ar: string; name_en: string; status: string }>(
      await tx.execute(sql`
        select id::text, name_ar, name_en, status::text
        from units where property_id = ${propertyId}::uuid
        order by name_ar
      `),
    );

    const contracts = rowsOf<{
      id: string;
      reference: string | null;
      status: string;
      kind: string;
      tenant_name: string;
      owner_name: string;
    }>(
      await tx.execute(sql`
        select c.id::text, c.reference, c.status::text, c.kind,
          tp.display_name as tenant_name, op.display_name as owner_name
        from contracts c
        join units u on u.id = c.unit_id
        join parties tp on tp.id = c.tenant_party_id
        join parties op on op.id = c.owner_party_id
        where u.property_id = ${propertyId}::uuid
        order by c.created_at desc
        limit 100
      `),
    );

    const leases = rowsOf<{
      id: string;
      status: string;
      starts_on: string;
      ends_on: string;
      tenant_name: string;
      contract_id: string | null;
    }>(
      await tx.execute(sql`
        select l.id::text, l.status::text, l.starts_on::text, l.ends_on::text,
          tp.display_name as tenant_name, l.contract_id::text
        from leases l
        join units u on u.id = l.unit_id
        join parties tp on tp.id = l.tenant_party_id
        where u.property_id = ${propertyId}::uuid
        order by l.starts_on desc
        limit 100
      `),
    );

    return {
      id: property.id,
      nameAr: property.name_ar,
      nameEn: property.name_en,
      status: property.status,
      kind: property.kind,
      category: property.category,
      organizationId: property.organization_id,
      organizationNameAr: property.org_name,
      ownerName: property.owner_name,
      countryCode: property.country_code,
      listingSlug: property.listing_slug,
      units: units.map((row) => ({
        id: row.id,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        status: row.status,
      })),
      contracts: contracts.map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        kind: row.kind,
        tenantName: row.tenant_name,
        ownerName: row.owner_name,
      })),
      leases: leases.map((row) => ({
        id: row.id,
        status: row.status,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        tenantName: row.tenant_name,
        contractId: row.contract_id,
      })),
    };
  }, 12_000);
}

export function getAdminContractInspect(
  claims: SessionClaims,
  contractId: string,
): Promise<AdminContractInspect> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'users');
    if (!UUID.test(contractId)) fail('contract_not_found');

    const [contract] = rowsOf<{
      id: string;
      reference: string | null;
      kind: string;
      status: string;
      organization_id: string;
      org_name: string;
      property_id: string;
      property_name_ar: string;
      property_name_en: string;
      unit_id: string;
      unit_name_ar: string;
      owner_name: string;
      tenant_name: string;
      sent_at: Date | string | null;
      completed_at: Date | string | null;
      has_pdf: boolean;
      owner_party_id: string;
      tenant_party_id: string;
    }>(
      await tx.execute(sql`
        select c.id::text, c.reference, c.kind, c.status::text,
          c.organization_id::text, o.display_name_ar as org_name,
          p.id::text as property_id, p.name_ar as property_name_ar, p.name_en as property_name_en,
          u.id::text as unit_id, u.name_ar as unit_name_ar,
          op.display_name as owner_name, tp.display_name as tenant_name,
          c.sent_at, c.completed_at,
          (c.rendered_pdf_object_key is not null) as has_pdf,
          c.owner_party_id::text, c.tenant_party_id::text
        from contracts c
        join organizations o on o.id = c.organization_id
        join units u on u.id = c.unit_id
        join properties p on p.id = u.property_id
        join parties op on op.id = c.owner_party_id
        join parties tp on tp.id = c.tenant_party_id
        where c.id = ${contractId}::uuid
      `),
    );
    if (!contract) fail('contract_not_found');

    const related = rowsOf<{ user_id: string }>(
      await tx.execute(sql`
        select distinct m.user_id::text
        from memberships m
        where m.status = 'active'
          and m.party_id in (${contract.owner_party_id}::uuid, ${contract.tenant_party_id}::uuid)
      `),
    );

    return {
      id: contract.id,
      reference: contract.reference,
      kind: contract.kind,
      status: contract.status,
      organizationId: contract.organization_id,
      organizationNameAr: contract.org_name,
      propertyId: contract.property_id,
      propertyNameAr: contract.property_name_ar,
      propertyNameEn: contract.property_name_en,
      unitId: contract.unit_id,
      unitNameAr: contract.unit_name_ar,
      ownerName: contract.owner_name,
      tenantName: contract.tenant_name,
      sentAt: isoOf(contract.sent_at),
      completedAt: isoOf(contract.completed_at),
      hasPdf: Boolean(contract.has_pdf),
      relatedUserIds: related.map((row) => row.user_id),
    };
  }, 8_000);
}

async function writeSubscriptions(
  tx: ElevatedTx,
  value: Record<string, StoredSubscription>,
  userId: string,
) {
  await tx.execute(sql`
    insert into platform_settings (key, value, updated_at, updated_by_user_id)
    values (${SUBSCRIPTIONS_KEY}, ${JSON.stringify(value)}::jsonb, now(), ${userId}::uuid)
    on conflict (key) do update
      set value = excluded.value,
          updated_at = now(),
          updated_by_user_id = excluded.updated_by_user_id
  `);
}

/** Signs the account out everywhere without suspending it. */
export function revokeAdminUserSessions(
  claims: SessionClaims,
  userId: string,
): Promise<{ revoked: number }> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'users');
    if (!UUID.test(userId)) fail('user_not_found');
    if (userId === claims.sub) fail('user_self');
    const result = rowsOf<{ n: string }>(
      await tx.execute(sql`
        with updated as (
          update sessions
          set revoked_at = now()
          where user_id = ${userId}::uuid and revoked_at is null
          returning 1
        )
        select count(*)::text as n from updated
      `),
    );
    await tx.execute(sql`
      update users set session_version = session_version + 1, updated_at = now()
      where id = ${userId}::uuid
    `);
    await tx.insert(auditLogs).values({
      actorUserId: claims.sub,
      action: 'site_admin.user.sessions_revoked',
      resourceType: 'user',
      resourceId: userId,
      requestId: randomUUID(),
      metadata: {},
    });
    return { revoked: Number(result[0]?.n ?? 0) };
  });
}

/** Clears a security lock so the person can sign in again. */
export async function unlockAdminUser(
  claims: SessionClaims,
  userId: string,
): Promise<{ unlocked: true }> {
  await elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'users');
    if (!UUID.test(userId)) fail('user_not_found');
    if (userId === claims.sub) fail('user_self');
    const [row] = rowsOf<{ id: string }>(
      await tx.execute(sql`select id::text from users where id = ${userId}::uuid`),
    );
    if (!row) fail('user_not_found');
  });
  await unlockUserAccount({ userId, unlockedBy: `site_admin:${claims.sub}` });
  return { unlocked: true };
}

/** Emails a one-time password-reset link to the account. */
export function sendAdminPasswordReset(
  claims: SessionClaims,
  userId: string,
): Promise<{ sent: boolean }> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'users');
    if (!UUID.test(userId)) fail('user_not_found');
    const [user] = rowsOf<{
      email: string | null;
      display_name: string;
      disabled_at: Date | string | null;
      organization_id: string | null;
    }>(
      await tx.execute(sql`
        select u.email, u.display_name, u.disabled_at,
          (select m.organization_id::text from memberships m
            where m.user_id = u.id and m.status = 'active'
            order by m.created_at limit 1) as organization_id
        from users u where u.id = ${userId}::uuid
      `),
    );
    if (!user) fail('user_not_found');
    if (user.disabled_at) fail('user_suspended');
    if (!user.email) fail('user_no_email');

    const token = randomBytes(32).toString('base64url');
    const [tokenRow] = await tx
      .insert(credentialTokens)
      .values({
        userId,
        purpose: 'password_reset',
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })
      .returning({ id: credentialTokens.id });

    const localePath = '/ar/reset-password';
    const sent = await queueBrandedEmail(tx, {
      orgId: user.organization_id,
      recipient: user.email,
      recipientName: user.display_name,
      subject: 'إعادة ضبط كلمة مرور حسابك في BHD R',
      tone: 'alert',
      title: 'رابط إعادة ضبط كلمة المرور',
      intro: `طلب مسؤول الموقع إرسال رابط لإعادة ضبط كلمة مرور حساب «${user.display_name}». الرابط صالح لمرة واحدة ولمدة 30 دقيقة.`,
      details: [{ label: 'البريد', value: user.email }],
      cta: { label: 'تعيين كلمة مرور جديدة', url: appLink(`${localePath}?token=${token}`) },
      aggregateType: 'credential_token',
      aggregateId: tokenRow?.id ?? userId,
    });

    await tx.insert(auditLogs).values({
      actorUserId: claims.sub,
      action: 'site_admin.user.password_reset_sent',
      resourceType: 'user',
      resourceId: userId,
      requestId: randomUUID(),
      metadata: { sent },
    });
    return { sent };
  }).then(async (result) => {
    if (result.sent) void sendQueuedEmailsSoon();
    return result;
  });
}

/** Upgrade/downgrade one of the user's organizations and email them. */
export function updateAdminUserPlan(
  claims: SessionClaims,
  userId: string,
  input: {
    organizationId: string;
    planKey: string;
    status: SubscriptionStatus;
    endsOn: string | null;
    note: string | null;
  },
): Promise<{ organizationId: string; planKey: string; endsOn: string | null }> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'users');
    if (!UUID.test(userId) || !UUID.test(input.organizationId)) fail('user_not_found');

    const [membership] = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`
        select exists (
          select 1 from memberships
          where user_id = ${userId}::uuid
            and organization_id = ${input.organizationId}::uuid
            and status = 'active'
        ) as ok
      `),
    );
    if (!membership?.ok) fail('organization_not_found');

    const [current] = rowsOf<{ plan_key: string; name: string }>(
      await tx.execute(sql`
        select plan_key, display_name_ar as name
        from organizations where id = ${input.organizationId}::uuid for update
      `),
    );
    if (!current) fail('organization_not_found');

    const catalog = readCatalog(await readSetting(tx, PLANS_KEY));
    const planKey = input.planKey.trim().toLowerCase();
    const plan = catalog.find((item) => item.key === planKey);
    if (!plan || (!plan.active && planKey !== current.plan_key)) fail('plan_unknown');
    if (!(SUBSCRIPTION_STATUSES as readonly string[]).includes(input.status)) fail('ledger_invalid');
    const endsOn =
      input.endsOn && /^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) ? input.endsOn : null;
    const note = input.note?.trim().slice(0, 200) || null;

    const subscriptions = readSubscriptions(await readSetting(tx, SUBSCRIPTIONS_KEY));
    const before = { planKey: current.plan_key, ...subscriptions[input.organizationId] };
    subscriptions[input.organizationId] = {
      status: input.status,
      endsOn,
      note,
      updatedAt: new Date().toISOString(),
    };
    await tx.execute(sql`
      update organizations set plan_key = ${planKey}, updated_at = now()
      where id = ${input.organizationId}::uuid
    `);
    await writeSubscriptions(tx, subscriptions, claims.sub);

    const [user] = rowsOf<{ email: string | null; display_name: string }>(
      await tx.execute(
        sql`select email, display_name from users where id = ${userId}::uuid`,
      ),
    );
    const previous = catalog.find((item) => item.key === current.plan_key);
    const upgraded = planKey !== current.plan_key;
    await queueBrandedEmail(tx, {
      orgId: input.organizationId,
      recipient: user?.email,
      recipientName: user?.display_name ?? null,
      subject: upgraded
        ? `🚀 باقة ${current.name} الآن: ${plan.nameAr}`
        : `تحديث على اشتراك ${current.name}`,
      tone: 'upgrade',
      title: upgraded ? `أهلاً بك في باقة «${plan.nameAr}»` : 'تحدّث اشتراك منشأتك',
      intro: upgraded
        ? `حدّث مسؤول الموقع باقة منشأتك «${current.name}» إلى «${plan.nameAr}».`
        : `حدّث مسؤول الموقع حالة اشتراك منشأتك «${current.name}».`,
      details: [
        ...(previous && upgraded ? [{ label: 'الباقة السابقة', value: previous.nameAr }] : []),
        { label: 'الباقة الحالية', value: plan.nameAr },
        { label: 'حالة الاشتراك', value: SUBSCRIPTION_LABELS[input.status].ar },
        ...(endsOn
          ? [{ label: 'ينتهي في', value: endsOn.split('-').reverse().join('/') }]
          : []),
        ...(note ? [{ label: 'ملاحظة', value: note }] : []),
      ],
      cta: { label: 'فتح لوحة التحكم', url: appLink('/ar/owner') },
      aggregateType: 'organization',
      aggregateId: input.organizationId,
    });

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorUserId: claims.sub,
      action: 'site_admin.user.subscription.updated',
      resourceType: 'organization',
      resourceId: input.organizationId,
      requestId: randomUUID(),
      metadata: { userId, before, after: { planKey, status: input.status, endsOn, note } },
    });

    return { organizationId: input.organizationId, planKey, endsOn };
  }, 12_000).then(async (result) => {
    void sendQueuedEmailsSoon();
    return result;
  });
}
