import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { hasPermission, permissionsForRoles, type RoleKey, type SessionClaims } from '@bhd-r/authz';
import {
  auditLogs,
  createDatabase,
  memberships,
  organizations,
  outboxEvents,
  users,
  type Database,
} from '@bhd-r/db';
import { entitlementsForPlan } from '@bhd-r/domain';
import { applySessionSettings } from '@/lib/db-session-settings';
import { escapeHtml } from '@/lib/lease-booking-contract';
import { publicWebOrigin } from '@/lib/seo';
import {
  assignableRoles,
  canManageMember,
  capabilitiesFromPermissions,
  grantableCapabilities,
  permissionsForCapabilities,
  ROLE_RANK,
  roleLabel,
  STAFF_ROLES,
  TEAM_CAPABILITIES,
  validTeamEmail,
  type OrganizationChoice,
  type StaffRole,
  type TeamMember,
  type TeamView,
} from '@/lib/team-shared';

type DbHandle = { db: Database };
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type MembershipRow = typeof memberships.$inferSelect;

const globalForDb = globalThis as unknown as { __bhdRWebDb?: DbHandle };

/** Roles that never take a team seat or appear on the team page. */
const NOT_STAFF = ['organization_owner', 'tenant'];
const CAPABILITY_PERMISSIONS = new Set<string>(
  TEAM_CAPABILITIES.flatMap((capability) => capability.permissions),
);

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

function organizationOf(claims: SessionClaims): string {
  if (!claims.organizationId) throw new Error('organization_required');
  return claims.organizationId;
}

function primaryRole(roles: readonly string[]): string {
  return [...roles].sort((a, b) => (ROLE_RANK[b] ?? 0) - (ROLE_RANK[a] ?? 0))[0] ?? '';
}

function roleCapabilityMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const role of ['organization_owner', ...STAFF_ROLES]) {
    map[role] = capabilitiesFromPermissions(permissionsForRoles([role as RoleKey]));
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
  const limit = entitlementsForPlan(planKey).representatives;
  if ((await seatsUsed(tx, organizationId)) >= limit) throw new Error('team_seat_limit');
}

async function audit(
  tx: Tx,
  claims: SessionClaims,
  action: string,
  memberId: string,
  metadata: Record<string, unknown>,
) {
  await tx.insert(auditLogs).values({
    organizationId: claims.organizationId,
    actorUserId: claims.sub,
    action,
    resourceType: 'membership',
    resourceId: memberId,
    requestId: randomUUID(),
    metadata,
  });
}

/** The member's next request re-signs them in silently with the new roles. */
async function refreshMemberSessions(tx: Tx, userId: string) {
  await tx
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function loadTeam(claims: SessionClaims): Promise<TeamView> {
  if (!hasPermission(claims, 'organization.members.read')) throw new Error('forbidden');
  const organizationId = organizationOf(claims);
  return elevated(async (tx) => {
    const [organization] = await tx
      .select({ planKey: organizations.planKey })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    const rows = await tx
      .select({
        userId: memberships.userId,
        roleKey: memberships.roleKey,
        status: memberships.status,
        permissions: memberships.permissions,
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
          ne(memberships.roleKey, 'tenant'),
        ),
      );

    const byUser = new Map<string, typeof rows>();
    for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);

    const members: TeamMember[] = [...byUser.values()].map((userRows) => {
      const first = userRows[0]!;
      const role = primaryRole(userRows.map((row) => row.roleKey));
      const extras = userRows.flatMap((row) => row.permissions);
      const created = userRows.reduce(
        (min, row) => (row.createdAt < min ? row.createdAt : min),
        first.createdAt,
      );
      return {
        userId: first.userId,
        displayName: first.displayName,
        email: first.email,
        role,
        status: userRows.some((row) => row.status === 'active') ? 'active' : 'inactive',
        extras: capabilitiesFromPermissions(extras),
        signedIn: Boolean(first.identitySubject || first.credentialHash),
        createdAt: created.toISOString(),
        isSelf: first.userId === claims.sub,
      };
    });
    members.sort(
      (a, b) =>
        (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0) ||
        a.displayName.localeCompare(b.displayName),
    );

    const canManage = hasPermission(claims, 'organization.members.write');
    return {
      members,
      seats: {
        used: members.filter(
          (member) => member.status === 'active' && member.role !== 'organization_owner',
        ).length,
        limit: entitlementsForPlan(organization?.planKey).representatives,
        plan: entitlementsForPlan(organization?.planKey).key,
      },
      canManage,
      assignableRoles: canManage ? assignableRoles(claims.roles) : [],
      grantableCapabilities: canManage
        ? grantableCapabilities(claims.permissions, claims.roles)
        : [],
      roleCapabilities: roleCapabilityMap(),
    };
  });
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
    role: string;
    invitedBy: string;
  },
) {
  const loginUrl = `${publicWebOrigin()}/ar/login`;
  const subject = `تمت إضافتك إلى فريق ${input.organizationName} على BHD R`;
  const lines = [
    `أضافك ${input.invitedBy} إلى فريق «${input.organizationName}» بصفة ${roleLabel(input.role, true)}.`,
    `ادخل إلى BHD R بحساب BHD المسجّل بهذا البريد (${input.email}) لتظهر لك أعمال الفريق حسب صلاحياتك.`,
    'إن كان لديك أكثر من منشأة فاختر هذا الفريق من قائمة حسابك أعلى الصفحة.',
  ];
  const greeting = input.name ? `مرحباً ${input.name}،` : 'مرحباً،';
  await tx.insert(outboxEvents).values({
    organizationId: input.organizationId,
    topic: 'notification.delivery.requested',
    aggregateType: 'membership',
    aggregateId: input.memberId,
    payload: {
      correlationId: randomUUID(),
      organizationId: input.organizationId,
      notificationId: randomUUID(),
      channel: 'email',
      recipient: input.email,
      subject,
      text: [greeting, '', ...lines, '', `الدخول: ${loginUrl}`, '', 'BHD R'].join('\n'),
      html: `<div dir="rtl"><p>${escapeHtml(greeting)}</p>${lines
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')}<p><a href="${escapeHtml(loginUrl)}">الدخول إلى BHD R</a></p><p>BHD R</p></div>`,
    },
  });
}

export async function addTeamMember(
  claims: SessionClaims,
  input: { email: string; displayName?: string; role: string; capabilities: string[] },
): Promise<{ userId: string; existingAccount: boolean }> {
  requireMembersWrite(claims);
  const email = input.email.trim().toLowerCase();
  if (!validTeamEmail(email)) throw new Error('team_email_invalid');
  if (!assignableRoles(claims.roles).includes(input.role as StaffRole)) {
    throw new Error('team_role_not_allowed');
  }
  const organizationId = organizationOf(claims);
  return elevated(async (tx) => {
    const organization = await lockOrganization(tx, organizationId);

    let user = await tx.query.users.findFirst({ where: eq(users.email, email) });
    const existingAccount = Boolean(user);
    if (user?.id === claims.sub) throw new Error('team_self_change');
    if (user) {
      const current = await tx
        .select({ roleKey: memberships.roleKey })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.userId, user.id),
            inArray(memberships.status, ['active', 'inactive']),
            ne(memberships.roleKey, 'tenant'),
          ),
        );
      if (current.length > 0) throw new Error('team_member_exists');
    }

    await assertSeatAvailable(tx, organizationId, organization.planKey);

    if (!user) {
      const name = input.displayName?.trim().slice(0, 160) || email.split('@')[0]!;
      const inserted = await tx
        .insert(users)
        .values({ username: usernameFor(email), email, displayName: name })
        .returning();
      user = inserted[0]!;
    }

    const permissions = mergedPermissions(claims, [], input.capabilities);
    await tx
      .insert(memberships)
      .values({
        organizationId,
        userId: user.id,
        roleKey: input.role,
        permissions,
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId, memberships.roleKey],
        set: { permissions, status: 'active' },
      });

    await audit(tx, claims, 'organization.member.added', user.id, {
      role: input.role,
      capabilities: capabilitiesFromPermissions(permissions),
    });
    const actor = await tx.query.users.findFirst({
      where: eq(users.id, claims.sub),
      columns: { displayName: true },
    });
    await queueWelcomeEmail(tx, {
      organizationId,
      organizationName: organization.displayNameAr || organization.displayNameEn,
      memberId: user.id,
      email,
      name: user.displayName,
      role: input.role,
      invitedBy: actor?.displayName ?? 'المالك',
    });
    return { userId: user.id, existingAccount };
  });
}

async function memberRows(tx: Tx, organizationId: string, userId: string) {
  return tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
        inArray(memberships.status, ['active', 'inactive']),
        ne(memberships.roleKey, 'tenant'),
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
  const role = primaryRole(rows.map((row) => row.roleKey));
  if (!canManageMember(claims.roles, role)) throw new Error('team_role_not_allowed');
  return role;
}

export async function updateTeamMember(
  claims: SessionClaims,
  userId: string,
  input: { role?: string; status?: 'active' | 'inactive'; capabilities?: string[] },
): Promise<void> {
  requireMembersWrite(claims);
  const organizationId = organizationOf(claims);
  await elevated(async (tx) => {
    const organization = await lockOrganization(tx, organizationId);
    const rows = await memberRows(tx, organizationId, userId);
    const currentRole = assertManageable(claims, userId, rows);
    const nextRole = input.role ?? currentRole;
    if (
      nextRole !== currentRole &&
      !assignableRoles(claims.roles).includes(nextRole as StaffRole)
    ) {
      throw new Error('team_role_not_allowed');
    }
    const wasActive = rows.some((row) => row.status === 'active');
    const nextStatus = input.status ?? (wasActive ? 'active' : 'inactive');
    if (nextStatus === 'active' && !wasActive) {
      await assertSeatAvailable(tx, organizationId, organization.planKey);
    }
    const existing = rows.flatMap((row) => row.permissions);
    const permissions = input.capabilities
      ? mergedPermissions(claims, existing, input.capabilities)
      : [...new Set(existing)];

    // A removed earlier membership in the target role is revived rather than duplicated.
    const [archived] = await tx
      .select({ roleKey: memberships.roleKey })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.roleKey, nextRole),
          eq(memberships.status, 'archived'),
        ),
      );
    const keepRole = archived
      ? nextRole
      : (rows.find((row) => row.roleKey === nextRole) ?? rows[0]!).roleKey;
    await tx
      .update(memberships)
      .set({ roleKey: nextRole, permissions, status: nextStatus })
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.userId, userId),
          eq(memberships.roleKey, keepRole),
        ),
      );
    const others = rows.filter((row) => row.roleKey !== keepRole).map((row) => row.roleKey);
    if (others.length > 0) {
      await tx
        .update(memberships)
        .set({ status: 'archived' })
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.userId, userId),
            inArray(memberships.roleKey, others),
          ),
        );
    }

    await refreshMemberSessions(tx, userId);
    await audit(tx, claims, 'organization.member.updated', userId, {
      fromRole: currentRole,
      role: nextRole,
      status: nextStatus,
      capabilities: capabilitiesFromPermissions(permissions),
    });
  });
}

export async function removeTeamMember(claims: SessionClaims, userId: string): Promise<void> {
  requireMembersWrite(claims);
  const organizationId = organizationOf(claims);
  await elevated(async (tx) => {
    const rows = await memberRows(tx, organizationId, userId);
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
