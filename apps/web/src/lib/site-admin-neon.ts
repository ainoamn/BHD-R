import 'server-only';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import { auditLogs, platformSettings } from '@bhd-r/db';
import { entitlementsForPlan } from '@bhd-r/domain';
import { elevatedTx, isoOf, rowsOf, type ElevatedTx } from '@/lib/elevated-db';
import { appLink, notifyInTx } from '@/lib/email-notify';
import {
  ADMIN_SCOPES,
  DEFAULT_PLANS,
  DELEGATE_LIMIT,
  PLAN_LIMIT,
  SUBSCRIPTION_LABELS,
  SUBSCRIPTION_STATUSES,
  isAdminScope,
  parsePlan,
  subscriptionBlocksGrowth,
  type AdminDelegate,
  type AdminOrganization,
  type AdminScope,
  type AdminUser,
  type PlanDefinition,
  type SiteAdminAccess,
  type SubscriptionStatus,
} from '@/lib/site-admin-shared';
import { validAdminEmail } from '@/lib/stay-deposit-claims';

const CONTACTS_KEY = 'site_admin_contacts';
const DELEGATES_KEY = 'site_admin_delegates';
const PLANS_KEY = 'plan_catalog';
const SUBSCRIPTIONS_KEY = 'organization_subscriptions';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code: string): never {
  throw new Error(code);
}

async function readSetting(tx: ElevatedTx, key: string): Promise<unknown> {
  const [row] = rowsOf<{ value: unknown }>(
    await tx.execute(sql`select value from platform_settings where key = ${key} limit 1`),
  );
  return row?.value ?? null;
}

async function writeSetting(
  tx: ElevatedTx,
  key: string,
  value: Record<string, unknown>,
  userId: string,
) {
  await tx
    .insert(platformSettings)
    .values({ key, value, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { value, updatedAt: new Date(), updatedByUserId: userId },
    });
}

async function audit(
  tx: ElevatedTx,
  claims: SessionClaims,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown>,
  organizationId: string | null = null,
) {
  await tx.insert(auditLogs).values({
    organizationId,
    actorUserId: claims.sub,
    action,
    resourceType,
    resourceId,
    requestId: randomUUID(),
    metadata,
  });
}

function contactEmails(value: unknown): string[] {
  const emails = (value as { emails?: unknown } | null)?.emails;
  return Array.isArray(emails)
    ? emails
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    : [];
}

function readDelegates(value: unknown): AdminDelegate[] {
  const list = (value as { delegates?: unknown } | null)?.delegates;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item): AdminDelegate[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
    const scopes = Array.isArray(row.scopes) ? row.scopes.filter(isAdminScope) : [];
    if (!email || !scopes.length) return [];
    return [
      {
        email,
        scopes: ADMIN_SCOPES.filter((scope) => scopes.includes(scope)),
        note: typeof row.note === 'string' && row.note.trim() ? row.note.trim() : null,
        grantedBy: typeof row.grantedBy === 'string' ? row.grantedBy : null,
        grantedAt: typeof row.grantedAt === 'string' ? row.grantedAt : new Date(0).toISOString(),
      },
    ];
  });
}

async function viewerEmail(tx: ElevatedTx, userId: string): Promise<string | null> {
  const [row] = rowsOf<{ email: string | null }>(
    await tx.execute(
      sql`select lower(email) as email from users where id = ${userId} and disabled_at is null`,
    ),
  );
  return row?.email?.trim() || null;
}

async function accessFor(tx: ElevatedTx, claims: SessionClaims): Promise<SiteAdminAccess | null> {
  if (claims.roles.includes('platform_admin')) return { root: true, scopes: [...ADMIN_SCOPES] };
  const email = await viewerEmail(tx, claims.sub);
  if (email && contactEmails(await readSetting(tx, CONTACTS_KEY)).includes(email)) {
    return { root: true, scopes: [...ADMIN_SCOPES] };
  }
  const granted = new Set<AdminScope>();
  if (claims.roles.includes('platform_support')) {
    granted.add('complaints');
    granted.add('verification');
  }
  if (email) {
    const delegate = readDelegates(await readSetting(tx, DELEGATES_KEY)).find(
      (item) => item.email === email,
    );
    for (const scope of delegate?.scopes ?? []) granted.add(scope);
  }
  if (!granted.size) return null;
  return { root: false, scopes: ADMIN_SCOPES.filter((scope) => granted.has(scope)) };
}

async function requireScope(
  tx: ElevatedTx,
  claims: SessionClaims,
  scope: AdminScope,
): Promise<SiteAdminAccess> {
  const access = await accessFor(tx, claims);
  if (!access?.scopes.includes(scope)) fail('forbidden');
  return access;
}

/** What this account may run in site administration, or null for everyone else. */
export function siteAdminAccess(claims: SessionClaims): Promise<SiteAdminAccess | null> {
  return elevatedTx((tx) => accessFor(tx, claims));
}

export async function hasAdminScope(claims: SessionClaims, scope: AdminScope): Promise<boolean> {
  return Boolean((await siteAdminAccess(claims))?.scopes.includes(scope));
}

/* ── Delegation ─────────────────────────────────────────────────────────── */

export type DelegatesView = {
  access: SiteAdminAccess;
  rootEmails: string[];
  delegates: AdminDelegate[];
};

export function loadDelegates(claims: SessionClaims): Promise<DelegatesView> {
  return elevatedTx(async (tx) => {
    const access = await requireScope(tx, claims, 'delegates');
    return {
      access,
      rootEmails: contactEmails(await readSetting(tx, CONTACTS_KEY)),
      delegates: readDelegates(await readSetting(tx, DELEGATES_KEY)),
    };
  });
}

const sameScopes = (a: readonly AdminScope[] = [], b: readonly AdminScope[] = []) =>
  a.length === b.length && a.every((scope) => b.includes(scope));

/**
 * Replaces the delegate list. Only top-level admins may hand out, change or take away the
 * delegation scope itself, so a delegate can never widen their own reach.
 */
export function saveDelegates(
  claims: SessionClaims,
  input: { email: string; scopes: string[]; note?: string | null | undefined }[],
): Promise<DelegatesView> {
  return elevatedTx(async (tx) => {
    const access = await requireScope(tx, claims, 'delegates');
    const rootEmails = contactEmails(await readSetting(tx, CONTACTS_KEY));
    const previous = readDelegates(await readSetting(tx, DELEGATES_KEY));
    const seen = new Set<string>();
    const next = input.map((item) => {
      const email = item.email.trim().toLowerCase();
      const scopes = ADMIN_SCOPES.filter((scope) => item.scopes.includes(scope));
      const note = item.note?.trim().slice(0, 120) || null;
      if (
        !validAdminEmail(email) ||
        seen.has(email) ||
        rootEmails.includes(email) ||
        !scopes.length ||
        item.scopes.some((scope) => !isAdminScope(scope))
      ) {
        fail('delegates_invalid');
      }
      seen.add(email);
      return { email, scopes, note };
    });
    if (next.length > DELEGATE_LIMIT) fail('delegates_invalid');

    if (!access.root) {
      for (const before of previous) {
        const after = next.find((item) => item.email === before.email);
        const touchesDelegation =
          before.scopes.includes('delegates') || after?.scopes.includes('delegates');
        if (touchesDelegation && !sameScopes(before.scopes, after?.scopes)) {
          fail('delegate_scope_denied');
        }
      }
      for (const item of next) {
        if (
          !previous.some((before) => before.email === item.email) &&
          item.scopes.includes('delegates')
        ) {
          fail('delegate_scope_denied');
        }
      }
    }

    const actor = (await viewerEmail(tx, claims.sub)) ?? claims.sub;
    const now = new Date().toISOString();
    const delegates: AdminDelegate[] = next.map((item) => {
      const before = previous.find((row) => row.email === item.email);
      return before && sameScopes(before.scopes, item.scopes)
        ? { ...before, note: item.note }
        : { ...item, grantedBy: actor, grantedAt: now };
    });
    await writeSetting(tx, DELEGATES_KEY, { delegates }, claims.sub);
    await audit(tx, claims, 'site_admin.delegates.updated', 'platform_setting', null, {
      before: previous.map(({ email, scopes }) => ({ email, scopes })),
      after: delegates.map(({ email, scopes }) => ({ email, scopes })),
    });
    return { access, rootEmails, delegates };
  });
}

/* ── Plans and subscriptions ────────────────────────────────────────────── */

function readCatalog(value: unknown): PlanDefinition[] {
  const list = (value as { plans?: unknown } | null)?.plans;
  if (!Array.isArray(list)) return DEFAULT_PLANS;
  const plans = list.map(parsePlan).filter((plan): plan is PlanDefinition => plan !== null);
  return plans.some((plan) => plan.key === 'starter') ? plans : DEFAULT_PLANS;
}

type StoredSubscription = {
  status: SubscriptionStatus;
  endsOn: string | null;
  note: string | null;
  updatedAt: string | null;
};

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
      note: typeof row.note === 'string' ? row.note : null,
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
    };
  }
  return out;
}

/**
 * Seat limit for an organization from the administration's plan catalogue, falling back to the
 * built-in plans when the catalogue cannot be read. Suspended or cancelled subscriptions add none.
 */
export async function organizationSeatPlan(
  organizationId: string,
  planKey: string | null | undefined,
): Promise<{ key: string; representatives: number; blocked: boolean }> {
  const fallback = entitlementsForPlan(planKey);
  try {
    return await elevatedTx(async (tx) => {
      const catalog = readCatalog(await readSetting(tx, PLANS_KEY));
      const key = (planKey ?? 'starter').trim().toLowerCase();
      const plan =
        catalog.find((item) => item.key === key) ?? catalog.find((item) => item.key === 'starter');
      const subscription = readSubscriptions(await readSetting(tx, SUBSCRIPTIONS_KEY))[
        organizationId
      ];
      return {
        key: plan?.key ?? fallback.key,
        representatives: plan?.representatives ?? fallback.representatives,
        blocked: subscriptionBlocksGrowth(subscription?.status),
      };
    }, 3_000);
  } catch {
    return { key: fallback.key, representatives: fallback.representatives, blocked: false };
  }
}

async function organizationsList(tx: ElevatedTx): Promise<AdminOrganization[]> {
  const subscriptions = readSubscriptions(await readSetting(tx, SUBSCRIPTIONS_KEY));
  const rows = rowsOf<{
    id: string;
    name_ar: string;
    name_en: string | null;
    type: string;
    status: string;
    plan_key: string;
    created_at: Date | string | null;
    members: number;
    properties: number;
    units: number;
    contact: string | null;
  }>(
    await tx.execute(sql`
      select o.id::text, o.display_name_ar as name_ar, o.display_name_en as name_en,
        o.type::text, o.status::text, o.plan_key, o.created_at,
        (select count(*)::int from memberships m
          where m.organization_id = o.id and m.status = 'active') as members,
        (select count(*)::int from properties p
          where p.organization_id = o.id and p.status <> 'archived') as properties,
        (select count(*)::int from units u
          where u.organization_id = o.id and u.status::text <> 'archived') as units,
        (select u.email from memberships m join users u on u.id = m.user_id
          where m.organization_id = o.id and m.status = 'active'
          order by m.created_at limit 1) as contact
      from organizations o
      order by o.created_at desc
      limit 500
    `),
  );
  return rows.map((row) => {
    const subscription = subscriptions[row.id];
    return {
      id: row.id,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      type: row.type,
      status: row.status,
      planKey: row.plan_key,
      createdAt: isoOf(row.created_at),
      contactEmail: row.contact,
      members: Number(row.members),
      properties: Number(row.properties),
      units: Number(row.units),
      subscription: {
        status: subscription?.status ?? 'active',
        endsOn: subscription?.endsOn ?? null,
        note: subscription?.note ?? null,
        updatedAt: subscription?.updatedAt ?? null,
      },
    };
  });
}

export type PlansView = { plans: PlanDefinition[]; organizations: AdminOrganization[] };

export function loadPlansAdmin(claims: SessionClaims): Promise<PlansView> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'plans');
    return {
      plans: readCatalog(await readSetting(tx, PLANS_KEY)),
      organizations: await organizationsList(tx),
    };
  }, 12_000);
}

export function savePlanCatalog(claims: SessionClaims, input: unknown[]): Promise<PlansView> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'plans');
    const plans = input.map(parsePlan);
    const keys = new Set(plans.map((plan) => plan?.key));
    if (
      !plans.length ||
      plans.length > PLAN_LIMIT ||
      plans.some((plan) => plan === null) ||
      keys.size !== plans.length ||
      !keys.has('starter')
    ) {
      fail('plans_invalid');
    }
    const valid = (plans as PlanDefinition[]).map((plan) =>
      plan.key === 'starter' ? { ...plan, active: true } : plan,
    );
    const used = rowsOf<{ plan_key: string }>(
      await tx.execute(sql`select distinct lower(plan_key) as plan_key from organizations`),
    ).map((row) => row.plan_key);
    if (used.some((key) => !keys.has(key) && key !== 'starter')) fail('plan_in_use');
    const before = readCatalog(await readSetting(tx, PLANS_KEY));
    await writeSetting(tx, PLANS_KEY, { plans: valid }, claims.sub);
    await audit(tx, claims, 'site_admin.plans.updated', 'platform_setting', null, {
      before,
      after: valid,
    });
    return { plans: valid, organizations: await organizationsList(tx) };
  }, 12_000);
}

export function updateOrganizationSubscription(
  claims: SessionClaims,
  organizationId: string,
  input: {
    planKey: string;
    status: SubscriptionStatus;
    endsOn: string | null;
    note: string | null;
  },
): Promise<AdminOrganization> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'plans');
    if (!UUID.test(organizationId)) fail('organization_not_found');
    const [current] = rowsOf<{ plan_key: string }>(
      await tx.execute(
        sql`select plan_key from organizations where id = ${organizationId} for update`,
      ),
    );
    if (!current) fail('organization_not_found');
    const planKey = input.planKey.trim().toLowerCase();
    const plan = readCatalog(await readSetting(tx, PLANS_KEY)).find((item) => item.key === planKey);
    if (!plan || (!plan.active && planKey !== current.plan_key)) fail('plan_unknown');
    const endsOn = input.endsOn && /^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) ? input.endsOn : null;
    const note = input.note?.trim().slice(0, 200) || null;

    const subscriptions = readSubscriptions(await readSetting(tx, SUBSCRIPTIONS_KEY));
    const before = { planKey: current.plan_key, ...subscriptions[organizationId] };
    subscriptions[organizationId] = {
      status: input.status,
      endsOn,
      note,
      updatedAt: new Date().toISOString(),
    };
    await tx.execute(
      sql`update organizations set plan_key = ${planKey}, updated_at = now() where id = ${organizationId}`,
    );
    await writeSetting(tx, SUBSCRIPTIONS_KEY, subscriptions, claims.sub);
    await audit(
      tx,
      claims,
      'site_admin.subscription.updated',
      'organization',
      organizationId,
      { before, after: { planKey, status: input.status, endsOn, note } },
      organizationId,
    );
    if (planKey !== current.plan_key || before.status !== input.status) {
      const [org] = rowsOf<{ name: string }>(
        await tx.execute(
          sql`select display_name_ar as name from organizations where id = ${organizationId}::uuid`,
        ),
      );
      const previous = readCatalog(await readSetting(tx, PLANS_KEY)).find(
        (item) => item.key === current.plan_key,
      );
      const upgraded = planKey !== current.plan_key;
      const orgName = org?.name ?? '';
      await notifyInTx(tx, {
        orgId: organizationId,
        aggregateType: 'organization',
        aggregateId: organizationId,
        audience: { managersOf: { orgId: organizationId } },
        content: () => ({
          tone: 'upgrade',
          subject: upgraded
            ? `🚀 باقة ${orgName} الآن: ${plan.nameAr}`
            : `تحديث على اشتراك ${orgName}`,
          title: upgraded ? `أهلاً بك في باقة «${plan.nameAr}»` : 'تحدّث اشتراك منشأتك',
          intro: upgraded
            ? `انتقلت منشأتك «${orgName}» إلى باقة «${plan.nameAr}» بمزاياها وحدودها الجديدة.`
            : `تحدّثت حالة اشتراك منشأتك «${orgName}».`,
          details: [
            ...(previous && upgraded ? [{ label: 'الباقة السابقة', value: previous.nameAr }] : []),
            { label: 'الباقة الحالية', value: plan.nameAr },
            { label: 'حالة الاشتراك', value: SUBSCRIPTION_LABELS[input.status].ar },
            ...(endsOn
              ? [{ label: 'ينتهي في', value: endsOn.split('-').reverse().join('/') }]
              : []),
          ],
          cta: { label: 'فتح لوحة التحكم', url: appLink('/ar/owner') },
        }),
      });
    }
    const updated = (await organizationsList(tx)).find((row) => row.id === organizationId);
    if (!updated) fail('organization_not_found');
    return updated;
  }, 12_000);
}

/* ── Users ──────────────────────────────────────────────────────────────── */

async function adminEmails(tx: ElevatedTx): Promise<{ root: Set<string>; all: Set<string> }> {
  const root = new Set(contactEmails(await readSetting(tx, CONTACTS_KEY)));
  const all = new Set(root);
  for (const delegate of readDelegates(await readSetting(tx, DELEGATES_KEY)))
    all.add(delegate.email);
  return { root, all };
}

export function listAdminUsers(claims: SessionClaims, query: string): Promise<AdminUser[]> {
  return elevatedTx(async (tx) => {
    await requireScope(tx, claims, 'users');
    const { all } = await adminEmails(tx);
    const q = query.trim().slice(0, 80);
    const rows = rowsOf<{
      id: string;
      email: string | null;
      display_name: string;
      created_at: Date | string | null;
      disabled_at: Date | string | null;
      orgs: { nameAr: string; role: string }[] | null;
    }>(
      await tx.execute(sql`
        select u.id::text, u.email, u.display_name, u.created_at, u.disabled_at,
          (select json_agg(json_build_object('nameAr', o.display_name_ar, 'role', m.role_key)
              order by m.created_at)
            from memberships m join organizations o on o.id = m.organization_id
            where m.user_id = u.id and m.status = 'active') as orgs
        from users u
        ${
          q
            ? sql`where u.email ilike ${`%${q}%`} or u.display_name ilike ${`%${q}%`}
                or u.username ilike ${`%${q}%`}`
            : sql``
        }
        order by u.created_at desc
        limit 100
      `),
    );
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      createdAt: isoOf(row.created_at),
      disabledAt: isoOf(row.disabled_at),
      organizations: row.orgs ?? [],
      isSiteAdmin: Boolean(row.email && all.has(row.email.trim().toLowerCase())),
    }));
  });
}

/**
 * Suspends or restores an account. Suspension signs the person out everywhere at once; their
 * records stay intact and restoring lets them sign in again.
 */
export function setUserSuspended(
  claims: SessionClaims,
  userId: string,
  suspended: boolean,
): Promise<{ id: string; disabledAt: string | null }> {
  return elevatedTx(async (tx) => {
    const access = await requireScope(tx, claims, 'users');
    if (!UUID.test(userId)) fail('user_not_found');
    if (userId === claims.sub) fail('user_self');
    const [target] = rowsOf<{ email: string | null; platform: boolean }>(
      await tx.execute(sql`
        select lower(u.email) as email,
          exists (select 1 from memberships m where m.user_id = u.id and m.status = 'active'
            and m.role_key = 'platform_admin') as platform
        from users u where u.id = ${userId} for update
      `),
    );
    if (!target) fail('user_not_found');
    const { root } = await adminEmails(tx);
    if (!access.root && (target.platform || (target.email && root.has(target.email)))) {
      fail('user_protected');
    }
    const [row] = rowsOf<{ disabled_at: Date | string | null }>(
      await tx.execute(
        suspended
          ? sql`update users set disabled_at = coalesce(disabled_at, now()),
              session_version = session_version + 1, updated_at = now()
              where id = ${userId} returning disabled_at`
          : sql`update users set disabled_at = null, updated_at = now()
              where id = ${userId} returning disabled_at`,
      ),
    );
    if (suspended) {
      await tx.execute(
        sql`update sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`,
      );
    }
    await audit(
      tx,
      claims,
      suspended ? 'site_admin.user.suspended' : 'site_admin.user.restored',
      'user',
      userId,
      {},
    );
    return { id: userId, disabledAt: isoOf(row?.disabled_at) };
  });
}
