import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, count, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { hasPermission, permissionsForRoles, type RoleKey, type SessionClaims } from '@bhd-r/authz';
import {
  auditLogs,
  createDatabase,
  legalCases,
  memberships,
  organizationRoles,
  organizations,
  outboxEvents,
  parties,
  partyRoles,
  properties,
  users,
  type Database,
} from '@bhd-r/db';
import { activeBadgeChips, type BadgeRef } from '@/lib/badge-chips-neon';
import type { BadgeChip } from '@/lib/badges-shared';
import { applySessionSettings } from '@/lib/db-session-settings';
import { emailDeliveryState, sendQueuedEmailsSoon } from '@/lib/email-outbox';
import { queueBrandedEmail } from '@/lib/email-notify';
import { marksForUsers } from '@/lib/identity-marks-neon';
import { publicWebOrigin } from '@/lib/seo';
import { organizationSeatPlan } from '@/lib/site-admin-neon';
import { withTimeoutFallback } from '@/lib/with-timeout';
import {
  assignableRoles,
  canAssignSavedRole,
  canManageMember,
  capabilitiesFromPermissions,
  grantableCapabilities,
  INVITE_RESEND_MINUTES,
  isCustomRoleKey,
  permissionsForCapabilities,
  primaryRole,
  ROLE_RANK,
  roleLabel,
  savedRoleId,
  savedRoleKey,
  STAFF_ROLES,
  TEAM_CAPABILITIES,
  validTeamEmail,
  type LawyerMember,
  type LawyerPartyChoice,
  type OrganizationChoice,
  type OwnerPartyChoice,
  type PropertyOwnerMember,
  type SavedRole,
  type TeamInvite,
  type TeamMember,
  type TeamView,
  type TenantMember,
} from '@/lib/team-shared';

type DbHandle = { db: Database };
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type MembershipRow = typeof memberships.$inferSelect;
type SavedRoleRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  description: string | null;
  permissions: string[];
};

const globalForDb = globalThis as unknown as { __bhdRWebDb?: DbHandle };

/** Rows that are not staff roles: they never take a seat or appear in the staff list. */
const NOT_STAFF = ['organization_owner', 'tenant', 'property_owner', 'lawyer'];
const NOT_STAFF_ROWS = ['tenant', 'property_owner', 'lawyer'];
/** Rows that never get a team invitation email (tenants are invited from their lease). */
const NOT_INVITED = ['organization_owner', 'tenant'];
const MAX_ROLES_PER_MEMBER = 6;
const MAX_SAVED_ROLES = 30;
const CAPABILITY_PERMISSIONS = new Set<string>(
  TEAM_CAPABILITIES.flatMap((capability) => capability.permissions),
);
const CAPABILITY_IDS = new Set(TEAM_CAPABILITIES.map((capability) => capability.id));

function sharedDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRWebDb) {
    const { db } = createDatabase(url, { max: 3 });
    globalForDb.__bhdRWebDb = { db };
  }
  return globalForDb.__bhdRWebDb.db;
}

/** Every query filters by organization explicitly: the app's database role bypasses RLS. */
async function elevated<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return sharedDb().transaction(async (tx) => {
    await applySessionSettings(tx, {
      statement_timeout: '6000',
      'app.platform_admin': 'true',
      'app.public': 'false',
    });
    return work(tx);
  });
}

function requireMembersWrite(claims: SessionClaims) {
  if (!hasPermission(claims, 'organization.members.write')) throw new Error('forbidden');
}

function isOwner(claims: SessionClaims): boolean {
  return claims.roles.includes('organization_owner') || claims.roles.includes('platform_admin');
}

function organizationOf(claims: SessionClaims): string {
  if (!claims.organizationId) throw new Error('organization_required');
  return claims.organizationId;
}

/** Saved roles, or none while the organization_roles table is not migrated yet. */
async function readSavedRoles(tx: Tx, organizationId: string): Promise<SavedRoleRow[]> {
  try {
    return await tx.transaction((savepoint) =>
      savepoint
        .select({
          id: organizationRoles.id,
          nameAr: organizationRoles.nameAr,
          nameEn: organizationRoles.nameEn,
          description: organizationRoles.description,
          permissions: organizationRoles.permissions,
        })
        .from(organizationRoles)
        .where(
          and(
            eq(organizationRoles.organizationId, organizationId),
            eq(organizationRoles.status, 'active'),
          ),
        )
        .orderBy(organizationRoles.nameAr),
    );
  } catch {
    return [];
  }
}

function roleCapabilityMap(savedRoles: readonly SavedRoleRow[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const role of ['organization_owner', 'property_owner', ...STAFF_ROLES]) {
    map[role] = capabilitiesFromPermissions(permissionsForRoles([role as RoleKey]));
  }
  for (const role of savedRoles) {
    map[savedRoleKey(role.id)] = capabilitiesFromPermissions(role.permissions);
  }
  return map;
}

/** Capabilities the actor sent, plus ones already granted that the actor may not touch. */
function mergedPermissions(
  claims: SessionClaims,
  existing: readonly string[],
  requested: readonly string[],
): string[] {
  const grantable = new Set(grantableCapabilities(claims.permissions, claims.roles));
  const kept = capabilitiesFromPermissions(existing).filter((id) => !grantable.has(id));
  const chosen = requested.filter((id) => grantable.has(id));
  const legacy = existing.filter((permission) => !CAPABILITY_PERMISSIONS.has(permission));
  return [...new Set([...legacy, ...permissionsForCapabilities([...kept, ...chosen])])];
}

async function seatsUsed(tx: Tx, organizationId: string): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(distinct ${memberships.userId})::int` })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, 'active'),
        notInArray(memberships.roleKey, NOT_STAFF),
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

async function lockOrganization(tx: Tx, organizationId: string) {
  const rows = await tx
    .select({
      id: organizations.id,
      planKey: organizations.planKey,
      displayNameAr: organizations.displayNameAr,
      displayNameEn: organizations.displayNameEn,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for('update');
  if (!rows[0]) throw new Error('organization_required');
  return rows[0];
}

async function assertSeatAvailable(tx: Tx, organizationId: string, planKey: string) {
  const plan = await organizationSeatPlan(organizationId, planKey);
  if (plan.blocked || (await seatsUsed(tx, organizationId)) >= plan.representatives) {
    throw new Error('team_seat_limit');
  }
}

async function audit(
  tx: Tx,
  claims: SessionClaims,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
  resourceType = 'membership',
) {
  await tx.insert(auditLogs).values({
    organizationId: claims.organizationId,
    actorUserId: claims.sub,
    action,
    resourceType,
    resourceId,
    requestId: randomUUID(),
    metadata,
  });
}

/** The member's next request re-signs them in silently with the new roles. */
async function refreshMemberSessions(tx: Tx, userIds: string | readonly string[]) {
  const ids = typeof userIds === 'string' ? [userIds] : [...new Set(userIds)];
  if (!ids.length) return;
  await tx
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
    .where(inArray(users.id, ids));
}

function signedIn(row: { identitySubject: string | null; credentialHash: string | null }) {
  return Boolean(row.identitySubject || row.credentialHash);
}

async function loadOwnerParties(tx: Tx, organizationId: string): Promise<OwnerPartyChoice[]> {
  const rows = await tx
    .select({
      id: parties.id,
      name: parties.displayName,
      propertyCount: sql<number>`count(distinct ${properties.id})::int`,
    })
    .from(parties)
    .innerJoin(
      partyRoles,
      and(
        eq(partyRoles.partyId, parties.id),
        eq(partyRoles.organizationId, organizationId),
        eq(partyRoles.roleKey, 'owner'),
        eq(partyRoles.status, 'active'),
      ),
    )
    .leftJoin(
      properties,
      and(eq(properties.ownerPartyId, parties.id), ne(properties.status, 'archived')),
    )
    .where(eq(parties.organizationId, organizationId))
    .groupBy(parties.id, parties.displayName)
    .orderBy(parties.displayName)
    .limit(300);
  return rows.map((row) => ({ ...row, propertyCount: Number(row.propertyCount) }));
}

async function loadLawyerParties(tx: Tx, organizationId: string): Promise<LawyerPartyChoice[]> {
  const rows = await tx
    .select({
      id: parties.id,
      name: parties.displayName,
      caseCount: sql<number>`count(distinct ${legalCases.id})::int`,
    })
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
    .leftJoin(
      legalCases,
      and(eq(legalCases.lawyerPartyId, parties.id), eq(legalCases.organizationId, organizationId)),
    )
    .where(eq(parties.organizationId, organizationId))
    .groupBy(parties.id, parties.displayName)
    .orderBy(parties.displayName)
    .limit(300);
  return rows.map((row) => ({ ...row, caseCount: Number(row.caseCount) }));
}

export async function loadTeam(claims: SessionClaims): Promise<TeamView> {
  const view = await loadTeamView(claims);
  const [marks, badges] = await Promise.all([
    marksForUsers([
      ...view.members.map((member) => member.userId),
      ...view.owners.map((owner) => owner.userId),
      ...view.lawyers.map((lawyer) => lawyer.userId),
      ...view.tenants.map((tenant) => tenant.userId),
    ]),
    withTimeoutFallback(
      activeBadgeChips(
        [
          ...view.members.map((member): BadgeRef => ({ type: 'staff', id: member.userId })),
          ...view.owners.map((owner): BadgeRef => ({ type: 'owner', id: owner.partyId })),
        ],
        organizationOf(claims),
      ),
      2_500,
      new Map<string, BadgeChip[]>(),
      'team-badges',
    ),
  ]);
  return { ...view, marks: Object.fromEntries(marks), badges: Object.fromEntries(badges) };
}

async function loadTeamView(claims: SessionClaims): Promise<TeamView> {
  if (!hasPermission(claims, 'organization.members.read')) throw new Error('forbidden');
  const organizationId = organizationOf(claims);
  return elevated(async (tx) => {
    const [organization] = await tx
      .select({
        planKey: organizations.planKey,
        displayNameAr: organizations.displayNameAr,
        displayNameEn: organizations.displayNameEn,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    const rows = await tx
      .select({
        userId: memberships.userId,
        roleKey: memberships.roleKey,
        status: memberships.status,
        permissions: memberships.permissions,
        partyId: memberships.partyId,
        createdAt: memberships.createdAt,
        displayName: users.displayName,
        email: users.email,
        identitySubject: users.identitySubject,
        credentialHash: users.credentialHash,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          inArray(memberships.status, ['active', 'inactive']),
        ),
      )
      .orderBy(desc(memberships.createdAt))
      .limit(2_000);
    const savedRoleRows = await readSavedRoles(tx, organizationId);
    const ownerParties = await loadOwnerParties(tx, organizationId);
    const lawyerParties = await loadLawyerParties(tx, organizationId);

    const staffEntries = rows.filter((row) => !NOT_STAFF_ROWS.includes(row.roleKey));
    const byUser = new Map<string, typeof rows>();
    for (const row of staffEntries)
      byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);

    const members: TeamMember[] = [...byUser.values()].map((userRows) => {
      const first = userRows[0]!;
      const roles = userRows.map((row) => row.roleKey);
      const created = userRows.reduce(
        (min, row) => (row.createdAt < min ? row.createdAt : min),
        first.createdAt,
      );
      return {
        userId: first.userId,
        displayName: first.displayName,
        email: first.email,
        role: primaryRole(roles),
        roles,
        status: userRows.some((row) => row.status === 'active') ? 'active' : 'inactive',
        extras: capabilitiesFromPermissions(userRows.flatMap((row) => row.permissions)),
        signedIn: signedIn(first),
        createdAt: created.toISOString(),
        isSelf: first.userId === claims.sub,
      };
    });
    const rank = (role: string) => ROLE_RANK[isCustomRoleKey(role) ? 'custom_member' : role] ?? 0;
    members.sort(
      (a, b) => rank(b.role) - rank(a.role) || a.displayName.localeCompare(b.displayName),
    );

    const partyNames = new Map(ownerParties.map((party) => [party.id, party]));
    const owners: PropertyOwnerMember[] = rows
      .filter((row) => row.roleKey === 'property_owner')
      .map((row) => {
        const party = row.partyId ? partyNames.get(row.partyId) : undefined;
        return {
          userId: row.userId,
          displayName: row.displayName,
          email: row.email,
          partyId: row.partyId,
          partyName: party?.name ?? null,
          propertyCount: party?.propertyCount ?? 0,
          status: row.status === 'active' ? 'active' : 'inactive',
          signedIn: signedIn(row),
        };
      });

    const lawyerNames = new Map(lawyerParties.map((party) => [party.id, party]));
    const lawyers: LawyerMember[] = rows
      .filter((row) => row.roleKey === 'lawyer')
      .map((row) => {
        const party = row.partyId ? lawyerNames.get(row.partyId) : undefined;
        return {
          userId: row.userId,
          displayName: row.displayName,
          email: row.email,
          partyId: row.partyId,
          partyName: party?.name ?? null,
          caseCount: party?.caseCount ?? 0,
          status: row.status === 'active' ? 'active' : 'inactive',
          signedIn: signedIn(row),
        };
      });

    const tenantRows = rows.filter((row) => row.roleKey === 'tenant');
    const tenantPartyIds = [
      ...new Set(tenantRows.map((row) => row.partyId).filter((id): id is string => Boolean(id))),
    ];
    const tenantParties = tenantPartyIds.length
      ? await tx
          .select({ id: parties.id, name: parties.displayName })
          .from(parties)
          .where(
            and(eq(parties.organizationId, organizationId), inArray(parties.id, tenantPartyIds)),
          )
      : [];
    const tenantPartyNames = new Map(tenantParties.map((party) => [party.id, party.name]));
    const tenants: TenantMember[] = tenantRows.map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      email: row.email,
      partyName: row.partyId ? (tenantPartyNames.get(row.partyId) ?? null) : null,
      status: row.status === 'active' ? 'active' : 'inactive',
      signedIn: signedIn(row),
      createdAt: row.createdAt.toISOString(),
    }));

    const roleHolders = new Map<string, number>();
    for (const row of staffEntries) {
      if (isCustomRoleKey(row.roleKey))
        roleHolders.set(row.roleKey, (roleHolders.get(row.roleKey) ?? 0) + 1);
    }
    const savedRoles: SavedRole[] = savedRoleRows.map((role) => ({
      id: role.id,
      nameAr: role.nameAr,
      nameEn: role.nameEn,
      description: role.description,
      capabilities: capabilitiesFromPermissions(role.permissions),
      memberCount: roleHolders.get(savedRoleKey(role.id)) ?? 0,
    }));

    const canManage = hasPermission(claims, 'organization.members.write');
    const plan = await organizationSeatPlan(organizationId, organization?.planKey);
    const invites = canManage
      ? await latestInvites(
          tx,
          organizationId,
          rows
            .filter((row) => !signedIn(row) && !NOT_INVITED.includes(row.roleKey))
            .map((row) => row.userId),
        )
      : {};
    return {
      members,
      owners,
      ownerParties: canManage ? ownerParties : [],
      lawyers,
      lawyerParties: canManage ? lawyerParties : [],
      tenants,
      savedRoles,
      seats: {
        used: members.filter(
          (member) => member.status === 'active' && member.role !== 'organization_owner',
        ).length,
        limit: plan.blocked ? 0 : plan.representatives,
        plan: plan.key,
      },
      canManage,
      canEditRoles: canManage && isOwner(claims),
      assignableRoles: canManage ? assignableRoles(claims.roles) : [],
      assignableSavedRoles: canManage
        ? savedRoleRows
            .filter((role) =>
              canAssignSavedRole(claims.permissions, claims.roles, role.permissions),
            )
            .map((role) => role.id)
        : [],
      grantableCapabilities: canManage
        ? grantableCapabilities(claims.permissions, claims.roles)
        : [],
      roleCapabilities: roleCapabilityMap(savedRoleRows),
      invites,
      inviteUrl: canManage ? inviteUrlFor(organizationId) : null,
      organizationName: organization?.displayNameAr || organization?.displayNameEn || '',
    };
  });
}

/** Opens BHD R in the inviting organization once the person signs in with BHD. */
function inviteUrlFor(organizationId: string): string {
  return `${publicWebOrigin()}/ar/login?org=${organizationId}`;
}

async function latestInvites(
  tx: Tx,
  organizationId: string,
  userIds: readonly string[],
): Promise<Record<string, TeamInvite>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return {};
  const rows = await tx
    .selectDistinctOn([outboxEvents.aggregateId], {
      userId: outboxEvents.aggregateId,
      occurredAt: outboxEvents.occurredAt,
      publishedAt: outboxEvents.publishedAt,
      attempts: outboxEvents.attempts,
    })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.organizationId, organizationId),
        eq(outboxEvents.topic, 'notification.delivery.requested'),
        eq(outboxEvents.aggregateType, 'membership'),
        inArray(outboxEvents.aggregateId, ids),
      ),
    )
    .orderBy(outboxEvents.aggregateId, desc(outboxEvents.occurredAt));
  return Object.fromEntries(
    rows.map((row) => [
      row.userId,
      {
        state: emailDeliveryState(row),
        at: (row.publishedAt ?? row.occurredAt).toISOString(),
      },
    ]),
  );
}

function usernameFor(email: string): string {
  const base =
    email
      .split('@')[0]!
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(0, 16) || 'user';
  return `${base}.${randomBytes(3).toString('hex')}`;
}

async function queueWelcomeEmail(
  tx: Tx,
  input: {
    organizationId: string;
    organizationName: string;
    memberId: string;
    email: string;
    name: string;
    roleText: string;
    invitedBy: string;
  },
) {
  const loginUrl = inviteUrlFor(input.organizationId);
  const org = input.organizationName;
  const subject = `مرحباً بك في فريق ${org} على BHD R · Welcome to the ${org} team`;
  const queued = await queueBrandedEmail(tx, {
    orgId: input.organizationId,
    recipient: input.email,
    recipientName: input.name,
    subject,
    aggregateType: 'membership',
    aggregateId: input.memberId,
    tone: 'team',
    title: `أنت مدعو لفريق ${org} 🎉`,
    intro: `خبر سار: ${input.invitedBy} دعاك للانضمام إلى فريق «${org}» على منصة BHD R بصفة ${input.roleText}. مرحباً بك معنا — فنجان القهوة الافتراضي جاهز!`,
    lines: [
      'إن لم يكن لديك حساب بعد، اضغط الزر أدناه وسجّل أو فعّل حسابك بنفس هذا البريد، ثم ستظهر لك أعمال الفريق حسب صلاحياتك.',
      'إن كان حسابك في BHD ببريد آخر، اطلب من مدير الفريق إضافتك بذلك البريد.',
      '— English —',
      `Good news: ${input.invitedBy} invited you to join the “${org}” team on BHD R as ${input.roleText}. Welcome aboard — virtual coffee is on us!`,
      `Use the button below to sign in or activate your account with this same email (${input.email}). Your team workspace opens right away.`,
      'If your BHD account uses a different email, ask your team admin to invite that address instead.',
    ],
    details: [
      { label: 'الفريق / Team', value: org },
      { label: 'الدور / Role', value: input.roleText },
      { label: 'البريد / Email', value: input.email },
    ],
    cta: {
      label: 'تفعيل الحساب والدخول · Activate & sign in',
      url: loginUrl,
    },
    footnote:
      'وصلت هذه الدعوة لأن أحد مديري الفريق أضاف بريدك في BHD R. · You received this because a team admin added your email in BHD R.',
  });
  if (queued) sendQueuedEmailsSoon();
}

async function actorName(tx: Tx, claims: SessionClaims): Promise<string> {
  const actor = await tx.query.users.findFirst({
    where: eq(users.id, claims.sub),
    columns: { displayName: true },
  });
  return actor?.displayName ?? 'المالك';
}

/** Find the account for an email, or create one that the person claims at first BHD sign-in. */
async function accountFor(tx: Tx, email: string, displayName: string | undefined) {
  const existing = await tx.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) return { user: existing, existingAccount: true };
  const name = displayName?.trim().slice(0, 160) || email.split('@')[0]!;
  const inserted = await tx
    .insert(users)
    .values({ username: usernameFor(email), email, displayName: name })
    .returning();
  return { user: inserted[0]!, existingAccount: false };
}

/**
 * Checks the requested roles: built-in staff roles and the organization's saved roles. Roles the
 * member already holds stay as they are; adding or removing a role needs the right to give it.
 */
function validateRoles(
  claims: SessionClaims,
  requested: readonly string[],
  current: readonly string[],
  savedRoles: readonly SavedRoleRow[],
): string[] {
  const roles = [...new Set(requested)];
  if (!roles.length) throw new Error('team_roles_required');
  if (roles.length > MAX_ROLES_PER_MEMBER) throw new Error('team_role_invalid');
  const assignable = new Set<string>(assignableRoles(claims.roles));
  const mayGive = (role: string): boolean => {
    const id = savedRoleId(role);
    if (id) {
      const saved = savedRoles.find((item) => item.id === id);
      return (
        Boolean(saved) && canAssignSavedRole(claims.permissions, claims.roles, saved!.permissions)
      );
    }
    return assignable.has(role);
  };
  for (const role of roles) {
    const known = savedRoleId(role)
      ? savedRoles.some((item) => item.id === savedRoleId(role))
      : (STAFF_ROLES as readonly string[]).includes(role);
    if (!known) throw new Error('team_role_invalid');
    if (!current.includes(role) && !mayGive(role)) throw new Error('team_role_not_allowed');
  }
  for (const role of current) {
    if (!roles.includes(role) && !mayGive(role)) throw new Error('team_role_not_allowed');
  }
  return roles;
}

/** One row per role; extra capabilities live on the first row, the rest are archived. */
async function writeStaffRoles(
  tx: Tx,
  input: {
    organizationId: string;
    userId: string;
    roles: readonly string[];
    permissions: string[];
    status: 'active' | 'inactive';
  },
) {
  for (const [index, roleKey] of input.roles.entries()) {
    const permissions = index === 0 ? input.permissions : [];
    await tx
      .insert(memberships)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        roleKey,
        permissions,
        status: input.status,
      })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId, memberships.roleKey],
        set: { permissions, status: input.status },
      });
  }
  await tx
    .update(memberships)
    .set({ status: 'archived' })
    .where(
      and(
        eq(memberships.organizationId, input.organizationId),
        eq(memberships.userId, input.userId),
        notInArray(memberships.roleKey, [...input.roles, ...NOT_STAFF]),
        inArray(memberships.status, ['active', 'inactive']),
      ),
    );
}

function rolesText(roles: readonly string[], savedRoles: readonly SavedRoleRow[]): string {
  return roles
    .map((role) => {
      const ar = roleLabel(role, true, savedRoles);
      const en = roleLabel(role, false, savedRoles);
      return ar === en ? ar : `${ar} / ${en}`;
    })
    .join(' · ');
}

export async function addTeamMember(
  claims: SessionClaims,
  input: { email: string; displayName?: string; roles: string[]; capabilities: string[] },
): Promise<{ userId: string; existingAccount: boolean }> {
  requireMembersWrite(claims);
  const email = input.email.trim().toLowerCase();
  if (!validTeamEmail(email)) throw new Error('team_email_invalid');
  const organizationId = organizationOf(claims);
  return elevated(async (tx) => {
    const organization = await lockOrganization(tx, organizationId);
    const savedRoles = await readSavedRoles(tx, organizationId);
    const roles = validateRoles(claims, input.roles, [], savedRoles);

    const known = await tx.query.users.findFirst({ where: eq(users.email, email) });
    if (known?.id === claims.sub) throw new Error('team_self_change');
    if (known) {
      const current = await staffRows(tx, organizationId, known.id);
      if (current.length > 0) throw new Error('team_member_exists');
    }
    await assertSeatAvailable(tx, organizationId, organization.planKey);
    const { user, existingAccount } = await accountFor(tx, email, input.displayName);

    const permissions = mergedPermissions(claims, [], input.capabilities);
    await writeStaffRoles(tx, {
      organizationId,
      userId: user.id,
      roles,
      permissions,
      status: 'active',
    });
    if (existingAccount) await refreshMemberSessions(tx, user.id);

    await audit(tx, claims, 'organization.member.added', user.id, {
      roles,
      capabilities: capabilitiesFromPermissions(permissions),
    });
    await queueWelcomeEmail(tx, {
      organizationId,
      organizationName: organization.displayNameAr || organization.displayNameEn,
      memberId: user.id,
      email,
      name: user.displayName,
      roleText: rolesText(roles, savedRoles),
      invitedBy: await actorName(tx, claims),
    });
    return { userId: user.id, existingAccount };
  });
}

async function staffRows(tx: Tx, organizationId: string, userId: string) {
  return tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
        inArray(memberships.status, ['active', 'inactive']),
        notInArray(memberships.roleKey, NOT_STAFF_ROWS),
      ),
    )
    .for('update');
}

function assertManageable(claims: SessionClaims, userId: string, rows: MembershipRow[]): string {
  if (userId === claims.sub) throw new Error('team_self_change');
  if (rows.length === 0) throw new Error('team_member_not_found');
  if (rows.some((row) => row.roleKey === 'organization_owner')) {
    throw new Error('team_owner_locked');
  }
  const builtIn = rows.map((row) => row.roleKey).filter((role) => !isCustomRoleKey(role));
  if (!builtIn.every((role) => canManageMember(claims.roles, role))) {
    throw new Error('team_role_not_allowed');
  }
  return primaryRole(rows.map((row) => row.roleKey));
}

export async function updateTeamMember(
  claims: SessionClaims,
  userId: string,
  input: { roles?: string[]; status?: 'active' | 'inactive'; capabilities?: string[] },
): Promise<void> {
  requireMembersWrite(claims);
  const organizationId = organizationOf(claims);
  await elevated(async (tx) => {
    const organization = await lockOrganization(tx, organizationId);
    const rows = await staffRows(tx, organizationId, userId);
    assertManageable(claims, userId, rows);
    const savedRoles = await readSavedRoles(tx, organizationId);
    const currentRoles = rows.map((row) => row.roleKey);
    const roles = input.roles
      ? validateRoles(claims, input.roles, currentRoles, savedRoles)
      : currentRoles;
    const wasActive = rows.some((row) => row.status === 'active');
    const status = input.status ?? (wasActive ? 'active' : 'inactive');
    if (status === 'active' && !wasActive) {
      await assertSeatAvailable(tx, organizationId, organization.planKey);
    }
    const existing = rows.flatMap((row) => row.permissions);
    const permissions = input.capabilities
      ? mergedPermissions(claims, existing, input.capabilities)
      : [...new Set(existing)];

    await writeStaffRoles(tx, { organizationId, userId, roles, permissions, status });
    await refreshMemberSessions(tx, userId);
    await audit(tx, claims, 'organization.member.updated', userId, {
      fromRoles: currentRoles,
      roles,
      status,
      capabilities: capabilitiesFromPermissions(permissions),
    });
  });
}

export async function removeTeamMember(claims: SessionClaims, userId: string): Promise<void> {
  requireMembersWrite(claims);
  const organizationId = organizationOf(claims);
  await elevated(async (tx) => {
    const rows = await staffRows(tx, organizationId, userId);
    const role = assertManageable(claims, userId, rows);
    await tx
      .update(memberships)
      .set({ status: 'archived' })
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          inArray(
            memberships.roleKey,
            rows.map((row) => row.roleKey),
          ),
        ),
      );
    await refreshMemberSessions(tx, userId);
    await audit(tx, claims, 'organization.member.removed', userId, { role });
  });
}

async function assertOwnerParty(tx: Tx, organizationId: string, partyId: string) {
  const [row] = await tx
    .select({ id: partyRoles.partyId })
    .from(partyRoles)
    .where(
      and(
        eq(partyRoles.organizationId, organizationId),
        eq(partyRoles.partyId, partyId),
        eq(partyRoles.roleKey, 'owner'),
        eq(partyRoles.status, 'active'),
      ),
    )
    .limit(1);
  if (!row) throw new Error('team_owner_party_required');
}

async function ownerRow(tx: Tx, organizationId: string, userId: string) {
  const [row] = await tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
        eq(memberships.roleKey, 'property_owner'),
        inArray(memberships.status, ['active', 'inactive']),
      ),
    )
    .for('update');
  return row ?? null;
}

/** Give a building owner portal access limited to the properties of one owner party. */
export async function addPropertyOwner(
  claims: SessionClaims,
  input: { email: string; displayName?: string; partyId: string },
): Promise<{ userId: string; existingAccount: boolean }> {
  requireMembersWrite(claims);
  const email = input.email.trim().toLowerCase();
  if (!validTeamEmail(email)) throw new Error('team_email_invalid');
  const organizationId = organizationOf(claims);
  return elevated(async (tx) => {
    const organization = await lockOrganization(tx, organizationId);
    await assertOwnerParty(tx, organizationId, input.partyId);
    const known = await tx.query.users.findFirst({ where: eq(users.email, email) });
    if (known?.id === claims.sub) throw new Error('team_self_change');
    if (known && (await ownerRow(tx, organizationId, known.id))) {
      throw new Error('team_member_exists');
    }
    const { user, existingAccount } = await accountFor(tx, email, input.displayName);
    await tx
      .insert(memberships)
      .values({
        organizationId,
        userId: user.id,
        roleKey: 'property_owner',
        partyId: input.partyId,
        permissions: [],
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId, memberships.roleKey],
        set: { partyId: input.partyId, permissions: [], status: 'active' },
      });
    if (existingAccount) await refreshMemberSessions(tx, user.id);
    await audit(tx, claims, 'organization.property_owner.added', user.id, {
      partyId: input.partyId,
    });
    await queueWelcomeEmail(tx, {
      organizationId,
      organizationName: organization.displayNameAr || organization.displayNameEn,
      memberId: user.id,
      email,
      name: user.displayName,
      roleText: `${roleLabel('property_owner', true)} / ${roleLabel('property_owner', false)}`,
      invitedBy: await actorName(tx, claims),
    });
    return { userId: user.id, existingAccount };
  });
}

const LAWYER_ROLE_TEXT = 'محامٍ يتابع القضايا المسندة إليه / Lawyer following assigned cases';

/** Sends the invitation email again to someone in this team who has not signed in yet. */
export async function resendTeamInvite(
  claims: SessionClaims,
  userId: string,
): Promise<{ queued: true }> {
  requireMembersWrite(claims);
  const organizationId = organizationOf(claims);
  if (userId === claims.sub) throw new Error('team_self_change');
  return elevated(async (tx) => {
    const organization = await lockOrganization(tx, organizationId);
    const rows = await tx
      .select({
        roleKey: memberships.roleKey,
        email: users.email,
        displayName: users.displayName,
        identitySubject: users.identitySubject,
        credentialHash: users.credentialHash,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
          notInArray(memberships.roleKey, NOT_INVITED),
        ),
      );
    const first = rows[0];
    if (!first) throw new Error('team_member_not_found');
    if (signedIn(first)) throw new Error('team_invite_not_needed');
    if (!validTeamEmail(first.email)) throw new Error('team_email_invalid');
    const [recent] = await tx
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, organizationId),
          eq(outboxEvents.topic, 'notification.delivery.requested'),
          eq(outboxEvents.aggregateType, 'membership'),
          eq(outboxEvents.aggregateId, userId),
          sql`${outboxEvents.occurredAt} > now() - make_interval(mins => ${INVITE_RESEND_MINUTES})`,
        ),
      )
      .limit(1);
    if (recent) throw new Error('team_invite_too_soon');

    const roles = rows.map((row) => row.roleKey);
    const staff = roles.filter((role) => !NOT_STAFF_ROWS.includes(role));
    const savedRoles = staff.some(isCustomRoleKey) ? await readSavedRoles(tx, organizationId) : [];
    const roleText = [
      ...(staff.length ? [rolesText(staff, savedRoles)] : []),
      ...(roles.includes('property_owner') ? [roleLabel('property_owner', true)] : []),
      ...(roles.includes('lawyer') ? [LAWYER_ROLE_TEXT] : []),
    ].join(' و');
    await queueWelcomeEmail(tx, {
      organizationId,
      organizationName: organization.displayNameAr || organization.displayNameEn,
      memberId: userId,
      email: first.email,
      name: first.displayName,
      roleText,
      invitedBy: await actorName(tx, claims),
    });
    await audit(tx, claims, 'organization.member.invite_resent', userId, { roles });
    return { queued: true as const };
  });
}

export async function updatePropertyOwner(
  claims: SessionClaims,
  userId: string,
  input: { status?: 'active' | 'inactive'; partyId?: string },
): Promise<void> {
  requireMembersWrite(claims);
  if (userId === claims.sub) throw new Error('team_self_change');
  const organizationId = organizationOf(claims);
  await elevated(async (tx) => {
    const row = await ownerRow(tx, organizationId, userId);
    if (!row) throw new Error('team_member_not_found');
    if (input.partyId) await assertOwnerParty(tx, organizationId, input.partyId);
    await tx
      .update(memberships)
      .set({
        ...(input.partyId ? { partyId: input.partyId } : {}),
        ...(input.status ? { status: input.status } : {}),
      })
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.roleKey, 'property_owner'),
        ),
      );
    await refreshMemberSessions(tx, userId);
    await audit(tx, claims, 'organization.property_owner.updated', userId, input);
  });
}

export async function removePropertyOwner(claims: SessionClaims, userId: string): Promise<void> {
  requireMembersWrite(claims);
  if (userId === claims.sub) throw new Error('team_self_change');
  const organizationId = organizationOf(claims);
  await elevated(async (tx) => {
    const row = await ownerRow(tx, organizationId, userId);
    if (!row) throw new Error('team_member_not_found');
    await tx
      .update(memberships)
      .set({ status: 'archived' })
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.roleKey, 'property_owner'),
        ),
      );
    await refreshMemberSessions(tx, userId);
    await audit(tx, claims, 'organization.property_owner.removed', userId, {});
  });
}

async function assertLawyerParty(tx: Tx, organizationId: string, partyId: string) {
  const [row] = await tx
    .select({ id: partyRoles.id })
    .from(partyRoles)
    .where(
      and(
        eq(partyRoles.organizationId, organizationId),
        eq(partyRoles.partyId, partyId),
        eq(partyRoles.roleKey, 'lawyer'),
        eq(partyRoles.status, 'active'),
      ),
    )
    .limit(1);
  if (!row) throw new Error('team_lawyer_invalid');
}

/** The lawyer's contact (an existing one with the same email, or a new one) marked as lawyer. */
async function lawyerPartyFor(
  tx: Tx,
  organizationId: string,
  input: { email: string; name: string; type: 'person' | 'company' },
): Promise<string> {
  const [existing] = await tx
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.organizationId, organizationId), eq(parties.email, input.email)))
    .limit(1);
  const partyId =
    existing?.id ??
    (
      await tx
        .insert(parties)
        .values({
          organizationId,
          type: input.type,
          displayName: input.name,
          email: input.email,
          status: 'active',
        })
        .returning({ id: parties.id })
    )[0]!.id;
  await tx
    .insert(partyRoles)
    .values({ organizationId, partyId, roleKey: 'lawyer', status: 'active' })
    .onConflictDoUpdate({
      target: [partyRoles.organizationId, partyRoles.partyId, partyRoles.roleKey],
      set: { status: 'active', updatedAt: new Date() },
    });
  return partyId;
}

async function lawyerRow(tx: Tx, organizationId: string, userId: string) {
  const [row] = await tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
        eq(memberships.roleKey, 'lawyer'),
        inArray(memberships.status, ['active', 'inactive']),
      ),
    )
    .for('update');
  return row ?? null;
}

/**
 * Give an external lawyer access to the cases of one lawyer contact: a new contact from their
 * name (or firm), or an existing firm other lawyers already work for.
 */
export async function addLawyer(
  claims: SessionClaims,
  input: {
    email: string;
    displayName?: string;
    partyId?: string;
    firmName?: string;
    partyType?: 'person' | 'company';
  },
): Promise<{ userId: string; partyId: string; existingAccount: boolean }> {
  requireMembersWrite(claims);
  const email = input.email.trim().toLowerCase();
  if (!validTeamEmail(email)) throw new Error('team_email_invalid');
  const organizationId = organizationOf(claims);
  return elevated(async (tx) => {
    const organization = await lockOrganization(tx, organizationId);
    const known = await tx.query.users.findFirst({ where: eq(users.email, email) });
    if (known?.id === claims.sub) throw new Error('team_self_change');
    if (known && (await lawyerRow(tx, organizationId, known.id))) {
      throw new Error('team_member_exists');
    }
    let partyId: string;
    if (input.partyId) {
      await assertLawyerParty(tx, organizationId, input.partyId);
      partyId = input.partyId;
    } else {
      const name =
        input.firmName?.trim().slice(0, 200) ||
        input.displayName?.trim().slice(0, 200) ||
        email.split('@')[0]!;
      partyId = await lawyerPartyFor(tx, organizationId, {
        email,
        name,
        type: input.partyType ?? (input.firmName?.trim() ? 'company' : 'person'),
      });
    }
    const { user, existingAccount } = await accountFor(tx, email, input.displayName);
    await tx
      .insert(memberships)
      .values({
        organizationId,
        userId: user.id,
        roleKey: 'lawyer',
        partyId,
        permissions: [],
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId, memberships.roleKey],
        set: { partyId, permissions: [], status: 'active' },
      });
    if (existingAccount) await refreshMemberSessions(tx, user.id);
    await audit(tx, claims, 'organization.lawyer.added', user.id, { partyId });
    await queueWelcomeEmail(tx, {
      organizationId,
      organizationName: organization.displayNameAr || organization.displayNameEn,
      memberId: user.id,
      email,
      name: user.displayName,
      roleText: LAWYER_ROLE_TEXT,
      invitedBy: await actorName(tx, claims),
    });
    return { userId: user.id, partyId, existingAccount };
  });
}

export async function updateLawyer(
  claims: SessionClaims,
  userId: string,
  input: { status?: 'active' | 'inactive'; partyId?: string },
): Promise<void> {
  requireMembersWrite(claims);
  if (userId === claims.sub) throw new Error('team_self_change');
  const organizationId = organizationOf(claims);
  await elevated(async (tx) => {
    const row = await lawyerRow(tx, organizationId, userId);
    if (!row) throw new Error('team_member_not_found');
    if (input.partyId) await assertLawyerParty(tx, organizationId, input.partyId);
    await tx
      .update(memberships)
      .set({
        ...(input.partyId ? { partyId: input.partyId } : {}),
        ...(input.status ? { status: input.status } : {}),
      })
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.roleKey, 'lawyer'),
        ),
      );
    await refreshMemberSessions(tx, userId);
    await audit(tx, claims, 'organization.lawyer.updated', userId, input);
  });
}

/** End a lawyer's access; their cases, messages and files stay with the organization. */
export async function removeLawyer(claims: SessionClaims, userId: string): Promise<void> {
  requireMembersWrite(claims);
  if (userId === claims.sub) throw new Error('team_self_change');
  const organizationId = organizationOf(claims);
  await elevated(async (tx) => {
    const row = await lawyerRow(tx, organizationId, userId);
    if (!row) throw new Error('team_member_not_found');
    await tx
      .update(memberships)
      .set({ status: 'archived' })
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.roleKey, 'lawyer'),
        ),
      );
    await refreshMemberSessions(tx, userId);
    await audit(tx, claims, 'organization.lawyer.removed', userId, {});
  });
}

/** Pause or restore a tenant's access to the tenant portal of this organization. */
export async function setTenantAccess(
  claims: SessionClaims,
  userId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  requireMembersWrite(claims);
  if (userId === claims.sub) throw new Error('team_self_change');
  const organizationId = organizationOf(claims);
  await elevated(async (tx) => {
    const updated = await tx
      .update(memberships)
      .set({ status })
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.roleKey, 'tenant'),
          inArray(memberships.status, ['active', 'inactive']),
        ),
      )
      .returning({ userId: memberships.userId });
    if (!updated.length) throw new Error('team_member_not_found');
    await refreshMemberSessions(tx, userId);
    await audit(tx, claims, 'organization.tenant_access.updated', userId, { status });
  });
}

type SavedRoleInput = {
  nameAr: string;
  nameEn?: string | undefined;
  description?: string | undefined;
  capabilities: string[];
};

function cleanSavedRole(input: SavedRoleInput) {
  const nameAr = input.nameAr.trim().slice(0, 80);
  const capabilities = [...new Set(input.capabilities)].filter((id) => CAPABILITY_IDS.has(id));
  if (nameAr.length < 2 || !capabilities.length) throw new Error('team_role_invalid');
  return {
    nameAr,
    nameEn: input.nameEn?.trim().slice(0, 80) || nameAr,
    description: input.description?.trim().slice(0, 300) || null,
    permissions: permissionsForCapabilities(capabilities) as string[],
  };
}

function requireRoleEditor(claims: SessionClaims) {
  requireMembersWrite(claims);
  if (!isOwner(claims)) throw new Error('forbidden');
}

async function roleHolders(tx: Tx, organizationId: string, roleId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.roleKey, savedRoleKey(roleId)),
        inArray(memberships.status, ['active', 'inactive']),
      ),
    );
  return rows.map((row) => row.userId);
}

async function lockSavedRole(tx: Tx, organizationId: string, roleId: string) {
  const [row] = await tx
    .select({ id: organizationRoles.id })
    .from(organizationRoles)
    .where(
      and(
        eq(organizationRoles.organizationId, organizationId),
        eq(organizationRoles.id, roleId),
        eq(organizationRoles.status, 'active'),
      ),
    )
    .for('update');
  if (!row) throw new Error('team_role_not_found');
}

export async function createSavedRole(
  claims: SessionClaims,
  input: SavedRoleInput,
): Promise<{ id: string }> {
  requireRoleEditor(claims);
  const organizationId = organizationOf(claims);
  const values = cleanSavedRole(input);
  return elevated(async (tx) => {
    await lockOrganization(tx, organizationId);
    const [existing] = await tx
      .select({ value: count() })
      .from(organizationRoles)
      .where(
        and(
          eq(organizationRoles.organizationId, organizationId),
          eq(organizationRoles.status, 'active'),
        ),
      );
    if (Number(existing?.value ?? 0) >= MAX_SAVED_ROLES) throw new Error('team_role_limit');
    const [created] = await tx
      .insert(organizationRoles)
      .values({ organizationId, ...values, createdByUserId: claims.sub })
      .returning({ id: organizationRoles.id });
    await audit(
      tx,
      claims,
      'organization.role.created',
      created!.id,
      { name: values.nameAr, permissions: values.permissions },
      'organization_role',
    );
    return { id: created!.id };
  });
}

export async function updateSavedRole(
  claims: SessionClaims,
  roleId: string,
  input: SavedRoleInput,
): Promise<void> {
  requireRoleEditor(claims);
  const organizationId = organizationOf(claims);
  const values = cleanSavedRole(input);
  await elevated(async (tx) => {
    await lockSavedRole(tx, organizationId, roleId);
    await tx
      .update(organizationRoles)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(eq(organizationRoles.organizationId, organizationId), eq(organizationRoles.id, roleId)),
      );
    await refreshMemberSessions(tx, await roleHolders(tx, organizationId, roleId));
    await audit(
      tx,
      claims,
      'organization.role.updated',
      roleId,
      { name: values.nameAr, permissions: values.permissions },
      'organization_role',
    );
  });
}

/** Retire a saved role; members who held it lose it (and its permissions) at once. */
export async function archiveSavedRole(claims: SessionClaims, roleId: string): Promise<void> {
  requireRoleEditor(claims);
  const organizationId = organizationOf(claims);
  await elevated(async (tx) => {
    await lockSavedRole(tx, organizationId, roleId);
    const holders = await roleHolders(tx, organizationId, roleId);
    await tx
      .update(organizationRoles)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(
        and(eq(organizationRoles.organizationId, organizationId), eq(organizationRoles.id, roleId)),
      );
    await tx
      .update(memberships)
      .set({ status: 'archived' })
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.roleKey, savedRoleKey(roleId)),
        ),
      );
    await refreshMemberSessions(tx, holders);
    await audit(
      tx,
      claims,
      'organization.role.archived',
      roleId,
      { holders: holders.length },
      'organization_role',
    );
  });
}

/** Organizations the account can work in, for the account menu switcher. */
export async function listMyOrganizations(claims: SessionClaims): Promise<OrganizationChoice[]> {
  return elevated(async (tx) => {
    const rows = await tx
      .select({
        organizationId: memberships.organizationId,
        roleKey: memberships.roleKey,
        nameAr: organizations.displayNameAr,
        nameEn: organizations.displayNameEn,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(
        and(
          eq(memberships.userId, claims.sub),
          eq(memberships.status, 'active'),
          eq(organizations.status, 'active'),
        ),
      );
    const byOrganization = new Map<string, typeof rows>();
    for (const row of rows) {
      byOrganization.set(row.organizationId, [
        ...(byOrganization.get(row.organizationId) ?? []),
        row,
      ]);
    }
    return [...byOrganization.entries()]
      .map(([organizationId, orgRows]) => ({
        organizationId,
        nameAr: orgRows[0]!.nameAr,
        nameEn: orgRows[0]!.nameEn,
        role: primaryRole(orgRows.map((row) => row.roleKey)),
        current: organizationId === claims.organizationId,
      }))
      .filter((choice) => choice.current || choice.role !== 'tenant')
      .sort((a, b) => Number(b.current) - Number(a.current) || a.nameAr.localeCompare(b.nameAr));
  });
}
