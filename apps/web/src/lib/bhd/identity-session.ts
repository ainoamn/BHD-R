import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  createDatabase,
  memberships,
  organizations,
  parties,
  partyRoles,
  properties,
  sessions,
  users,
  type Database,
} from '@bhd-r/db';
import {
  accessFromMemberships,
  customRoleIds,
  issueSessionToken,
  sessionClaimsSchema,
  type SessionClaims,
} from '@bhd-r/authz';
import { loadSavedRolePermissions } from '@/lib/organization-roles-read';
import { requireCsrfSecret, requireSessionSecret } from '@/lib/runtime-env';
import { createCsrfToken } from '@bhd-r/security';
import { inferProviders, type RosterAccount } from '@/lib/bhd/account-roster-shared';
import { identitySessionMaxAgeSecCached } from '@/lib/bhd/runtime';
import { verifyBhdIdToken } from '@/lib/bhd/verify-id-token';

export type IssuedSession = {
  token: string;
  csrf: string;
  claims: SessionClaims;
  /** Identity `sub` mirror for multi-account roster (BHD-SESSION-POLICY §0.2). */
  rosterAccount?: RosterAccount;
};

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Stand-in email domain for accounts without a verified address of their own. */
const PLACEHOLDER_EMAIL_DOMAIN = 'identity.bhd-om.local';
/** Moved by hand in mergeUnclaimedAccount, or meaningless to move. */
const MERGE_SKIPPED_TABLES = new Set(['users', 'memberships', 'sessions']);

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

async function withSystem<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL?.replace(/^\uFEFF/, '')
    .replace(/\\r\\n$/gi, '')
    .replace(/\\n$/gi, '')
    .replace(/\r\n$/g, '')
    .replace(/\n$/g, '')
    .trim();
  if (!url) throw new Error('DATABASE_URL is required');
  const { client, db } = createDatabase(url, { max: 1 });
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.platform_admin', 'true', true)`);
      await tx.execute(sql`select set_config('app.public', 'false', true)`);
      return work(tx);
    });
  } finally {
    await client.end();
  }
}

async function ensureOwnerParty(
  tx: Tx,
  input: {
    userId: string;
    organizationId: string;
    displayName: string;
    email: string;
    membershipPartyId: string | null;
  },
): Promise<string> {
  let ownerPartyId = input.membershipPartyId;
  if (!ownerPartyId) {
    const inserted = await tx
      .insert(parties)
      .values({
        organizationId: input.organizationId,
        type: 'person',
        displayName: input.displayName,
        email: input.email,
      })
      .onConflictDoNothing()
      .returning({ id: parties.id });
    ownerPartyId = inserted[0]?.id ?? null;
    if (!ownerPartyId) {
      const existing = await tx.query.parties.findFirst({
        where: and(
          eq(parties.organizationId, input.organizationId),
          eq(parties.email, input.email),
        ),
      });
      ownerPartyId = existing?.id ?? null;
    }
    if (!ownerPartyId) throw new Error('Owner party bootstrap failed');
    await tx
      .update(memberships)
      .set({ partyId: ownerPartyId })
      .where(
        and(
          eq(memberships.organizationId, input.organizationId),
          eq(memberships.userId, input.userId),
          eq(memberships.roleKey, 'organization_owner'),
        ),
      );
  }
  await tx
    .insert(partyRoles)
    .values({
      organizationId: input.organizationId,
      partyId: ownerPartyId,
      roleKey: 'owner',
    })
    .onConflictDoUpdate({
      target: [partyRoles.organizationId, partyRoles.partyId, partyRoles.roleKey],
      set: { status: 'active', updatedAt: new Date() },
    });
  return ownerPartyId;
}

type MembershipRow = typeof memberships.$inferSelect;

function newest(rows: MembershipRow[]): MembershipRow | undefined {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

/**
 * Remembered choice first; otherwise an owner's organization that has properties, then the
 * newest staff membership (a team member lands in the employer, not their empty personal org).
 */
async function chooseOrganization(
  tx: Tx,
  active: MembershipRow[],
  preferredOrganizationId: string | undefined,
): Promise<string> {
  const organizationIds = [...new Set(active.map((membership) => membership.organizationId))];
  if (preferredOrganizationId && organizationIds.includes(preferredOrganizationId)) {
    return preferredOrganizationId;
  }
  if (organizationIds.length === 1) return organizationIds[0]!;
  const owned = active
    .filter((membership) => membership.roleKey === 'organization_owner')
    .map((membership) => membership.organizationId);
  if (owned.length > 0) {
    const withProperties = await tx
      .select({ organizationId: properties.organizationId })
      .from(properties)
      .where(inArray(properties.organizationId, owned))
      .limit(1);
    if (withProperties[0]) return withProperties[0].organizationId;
  }
  const staff = active.filter(
    (membership) => membership.roleKey !== 'organization_owner' && membership.roleKey !== 'tenant',
  );
  return (newest(staff) ?? newest(active))!.organizationId;
}

export type SessionClientContext = {
  ipHash?: string | null;
  userAgentHash?: string | null;
  countryCode?: string | null;
};

async function issueForUser(
  tx: Tx,
  userId: string,
  organization: { preferred?: string; strict?: boolean } = {},
  client: SessionClientContext = {},
): Promise<IssuedSession> {
  const user = await tx.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error('User missing after identity login');
  if (user.securityLockedAt) throw new Error('account_security_locked');
  const allMemberships = await tx.query.memberships.findMany({
    where: and(eq(memberships.userId, userId), eq(memberships.status, 'active')),
  });
  if (allMemberships.length === 0) throw new Error('No active organization membership');
  if (
    organization.strict &&
    !allMemberships.some((membership) => membership.organizationId === organization.preferred)
  ) {
    throw new Error('organization_not_member');
  }
  const selectedOrganization = await chooseOrganization(tx, allMemberships, organization.preferred);
  let organizationMemberships = allMemberships.filter(
    (membership) => membership.organizationId === selectedOrganization,
  );
  const ownerMembership = organizationMemberships.find(
    (membership) => membership.roleKey === 'organization_owner',
  );
  if (ownerMembership) {
    const ownerPartyId = await ensureOwnerParty(tx, {
      userId,
      organizationId: selectedOrganization,
      displayName: user.displayName,
      email: user.email,
      membershipPartyId: ownerMembership.partyId,
    });
    organizationMemberships = organizationMemberships.map((membership) =>
      membership === ownerMembership ? { ...membership, partyId: ownerPartyId } : membership,
    );
  }
  const savedRoles = await loadSavedRolePermissions(
    tx,
    selectedOrganization,
    customRoleIds(organizationMemberships),
  );
  const access = accessFromMemberships(organizationMemberships, savedRoles);
  const sid = randomUUID();
  const claims = sessionClaimsSchema.parse({
    sub: user.id,
    sid,
    organizationId: selectedOrganization,
    partyId: access.partyId,
    roles: access.roles,
    permissions: access.permissions,
    locale: user.locale === 'en' ? 'en' : 'ar',
    sessionVersion: user.sessionVersion,
  });
  const maxAgeSec = identitySessionMaxAgeSecCached();
  const token = await issueSessionToken(claims, sessionSecret(), maxAgeSec);
  await tx.insert(sessions).values({
    id: sid,
    userId: user.id,
    tokenIdHash: tokenHash(token),
    expiresAt: new Date(Date.now() + maxAgeSec * 1000),
    ...(client.ipHash ? { ipHash: client.ipHash } : {}),
    ...(client.userAgentHash ? { userAgentHash: client.userAgentHash } : {}),
    ...(client.countryCode ? { countryCode: client.countryCode } : {}),
  });
  const identitySub = user.identitySubject?.trim();
  return {
    token,
    csrf: createCsrfToken(sid, requireCsrfSecret()),
    claims,
    ...(identitySub
      ? {
          rosterAccount: {
            sub: identitySub,
            name: user.displayName || user.email || 'BHD',
            email: user.email || '',
            username: user.username || null,
            phone: null,
            picture: null,
            providers: inferProviders({ hasPassword: Boolean(user.credentialHash) }),
          },
        }
      : {}),
  };
}

async function provisionIdentityUser(
  tx: Tx,
  identity: { subject: string; email?: string; name?: string },
) {
  const email =
    identity.email?.trim().toLowerCase() ||
    `${identity.subject.replace(/[^a-z0-9]/gi, '').slice(0, 24) || 'user'}@${PLACEHOLDER_EMAIL_DOMAIN}`;
  const displayName = identity.name?.trim() || email.split('@')[0] || 'BHD user';
  const base =
    email
      .split('@')[0]!
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(0, 16) || 'user';
  const username = `${base}.${randomBytes(3).toString('hex')}`;

  const insertedUsers = await tx
    .insert(users)
    .values({
      username,
      email,
      displayName,
      identitySubject: identity.subject,
    })
    .returning();
  const user = insertedUsers[0]!;
  await provisionPersonalOrganization(tx, user, identity.subject);
  return user;
}

/** Every account owns a personal organization (also for staff left with no active team). */
async function provisionPersonalOrganization(
  tx: Tx,
  user: { id: string; email: string; displayName: string },
  subject: string,
) {
  const slug = `sso-${subject.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || randomBytes(6).toString('hex')}`;
  const insertedOrgs = await tx
    .insert(organizations)
    .values({
      type: 'individual',
      slug,
      legalName: user.displayName,
      displayNameAr: user.displayName,
      displayNameEn: user.displayName,
      planKey: 'starter',
    })
    .onConflictDoNothing()
    .returning();
  const organization =
    insertedOrgs[0] ??
    (
      await tx
        .insert(organizations)
        .values({
          type: 'individual',
          slug: `sso-${randomBytes(8).toString('hex')}`,
          legalName: user.displayName,
          displayNameAr: user.displayName,
          displayNameEn: user.displayName,
          planKey: 'starter',
        })
        .returning()
    )[0]!;

  const ownerPartyId = await ensureOwnerParty(tx, {
    userId: user.id,
    organizationId: organization.id,
    displayName: user.displayName,
    email: user.email,
    membershipPartyId: null,
  });

  await tx.insert(memberships).values({
    organizationId: organization.id,
    userId: user.id,
    partyId: ownerPartyId,
    roleKey: 'organization_owner',
  });
}

/** Repair SSO accounts created without an owner party (needed for property wizard). */
export async function ensureOwnerPartyId(input: {
  userId: string;
  organizationId: string;
  displayName: string;
  email: string;
  partyId: string | null;
}): Promise<string> {
  if (input.partyId) return input.partyId;
  return withSystem((tx) =>
    ensureOwnerParty(tx, {
      userId: input.userId,
      organizationId: input.organizationId,
      displayName: input.displayName,
      email: input.email,
      membershipPartyId: null,
    }),
  );
}

/**
 * Keeps the account's email in step with its verified BHD email. When a team invitation is
 * waiting on that email (an account nobody has signed in to), it is merged into this account.
 * An email held by someone who did sign in stays theirs.
 */
async function adoptVerifiedEmail(tx: Tx, userId: string, email: string): Promise<boolean> {
  const [holder] = await tx.select().from(users).where(eq(users.email, email)).for('update');
  if (holder?.id === userId) return true;
  if (holder) {
    if (holder.identitySubject || holder.credentialHash) return false;
    await mergeUnclaimedAccount(tx, holder.id, userId);
    await tx
      .update(users)
      .set({
        email: `merged-${holder.id}@${PLACEHOLDER_EMAIL_DOMAIN}`,
        disabledAt: new Date(),
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, holder.id));
  }
  await tx
    .update(users)
    .set({
      email,
      updatedAt: new Date(),
      // Other devices re-sign silently with the merged memberships (they are not signed out).
      ...(holder ? { sessionVersion: sql`${users.sessionVersion} + 1` } : {}),
    })
    .where(eq(users.id, userId));
  return true;
}

/** Moves an invited, never-used account's memberships and assignments onto the real account. */
async function mergeUnclaimedAccount(tx: Tx, fromId: string, toId: string) {
  await tx.execute(sql`
    update memberships target
    set status = source.status, permissions = source.permissions,
        party_id = coalesce(source.party_id, target.party_id)
    from memberships source
    where source.user_id = ${fromId}::uuid and target.user_id = ${toId}::uuid
      and target.organization_id = source.organization_id and target.role_key = source.role_key
      and source.status in ('active', 'inactive') and target.status not in ('active', 'inactive')
  `);
  await tx.execute(sql`
    update memberships source set user_id = ${toId}::uuid
    where source.user_id = ${fromId}::uuid and not exists (
      select 1 from memberships target
      where target.user_id = ${toId}::uuid
        and target.organization_id = source.organization_id and target.role_key = source.role_key
    )
  `);
  await tx.execute(sql`
    update memberships set status = 'archived'
    where user_id = ${fromId}::uuid and status <> 'archived'
  `);

  const references = (await tx.execute(sql`
    select n.nspname as "schema", r.relname as "table", a.attname as "column"
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.users'::regclass
      and array_length(c.conkey, 1) = 1
  `)) as unknown as
    | { schema: string; table: string; column: string }[]
    | { rows: { schema: string; table: string; column: string }[] };
  const rows = Array.isArray(references) ? references : references.rows;
  for (const ref of rows) {
    if (MERGE_SKIPPED_TABLES.has(ref.table)) continue;
    const table = sql`${sql.identifier(ref.schema)}.${sql.identifier(ref.table)}`;
    const column = sql.identifier(ref.column);
    try {
      // A savepoint per column: a per-user unique row that both accounts have stays where it is.
      await tx.transaction((savepoint) =>
        savepoint.execute(
          sql`update ${table} set ${column} = ${toId}::uuid where ${column} = ${fromId}::uuid`,
        ),
      );
    } catch {
      // Left on the disabled invitation account.
    }
  }
}

/** Issue BHD R session from a verified Identity ID token (SSO §0.7). */
export async function issueIdentitySession(input: {
  idToken: string;
  nonce: string;
  accessToken?: string;
  jwksUri?: string;
  /** Organization remembered on this device (`bhd_r_org`). */
  preferredOrganizationId?: string;
  client?: SessionClientContext;
}): Promise<IssuedSession> {
  const cleanEnv = (value: string | undefined) =>
    value
      ?.replace(/^\uFEFF/, '')
      .replace(/\\r\\n$/gi, '')
      .replace(/\\n$/gi, '')
      .replace(/\r\n$/g, '')
      .replace(/\n$/g, '')
      .trim() || undefined;
  const identityTokenSecret =
    cleanEnv(process.env.BHD_IDENTITY_TOKEN_SECRET) ||
    cleanEnv(process.env.IDENTITY_TOKEN_SECRET) ||
    cleanEnv(process.env.AUTH_SECRET) ||
    undefined;
  const identity = await verifyBhdIdToken({
    token: input.idToken,
    issuer:
      cleanEnv(process.env.BHD_IDENTITY_ISSUER)?.replace(/\/$/, '') ?? 'https://id.bhd-om.com',
    clientId:
      cleanEnv(process.env.BHD_OAUTH_CLIENT_ID) ||
      cleanEnv(process.env.BHD_IDENTITY_CLIENT_ID) ||
      'bhd-r',
    expectedNonce: input.nonce,
    ...(identityTokenSecret ? { sharedSecret: identityTokenSecret } : {}),
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
    ...(input.jwksUri ? { jwksUri: input.jwksUri } : {}),
  });

  // Skip redundant decodeJwt nonce check — verifyBhdIdToken already enforced nonce.

  return withSystem(async (tx) => {
    const userId = await resolveIdentityUser(tx, identity);
    // Signing in on another device must not end existing sessions (BHD-SESSION-POLICY).
    try {
      const issued = await issueForUser(
        tx,
        userId,
        {
          ...(input.preferredOrganizationId ? { preferred: input.preferredOrganizationId } : {}),
        },
        input.client ?? {},
      );
      if (!issued.rosterAccount) return issued;
      const picture = identity.picture?.trim() || null;
      const providers = inferProviders({
        picture,
        ...(identity.providers ? { providers: identity.providers } : {}),
        hasPassword: issued.rosterAccount.providers.includes('password'),
      });
      return {
        ...issued,
        rosterAccount: {
          ...issued.rosterAccount,
          name: identity.name?.trim() || issued.rosterAccount.name,
          email: identity.email?.trim().toLowerCase() || issued.rosterAccount.email,
          username: identity.username?.trim() || issued.rosterAccount.username,
          phone: identity.phone?.trim() || issued.rosterAccount.phone,
          picture,
          providers: providers.length ? providers : ['password'],
        },
      };
    } catch (error) {
      throw new Error(
        `identity_session_issue:${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  });
}

/**
 * The BHD R account for a verified BHD identity: found by subject, linked to the account waiting
 * on its verified email, or created. Returns the user id.
 */
export async function resolveIdentityUser(
  tx: Tx,
  identity: { subject: string; email?: string; emailVerified: boolean; name?: string },
): Promise<string> {
  const email = identity.email?.trim().toLowerCase() || undefined;
  const verified = Boolean(email && identity.emailVerified);
  let user = await tx.query.users.findFirst({
    where: eq(users.identitySubject, identity.subject),
  });

  if (!user && email) {
    const [byEmail] = await tx.select().from(users).where(eq(users.email, email)).for('update');
    if (byEmail?.identitySubject) {
      // Another BHD account holds this email here; an unverified claim just gets its own account.
      if (verified) throw new Error('identity_email_taken');
    } else if (byEmail) {
      // A team invitation (or an older account) waits on this email: only its verified owner may take it.
      if (!verified) throw new Error('identity_email_unverified');
      const linked = await tx
        .update(users)
        .set({
          identitySubject: identity.subject,
          displayName: identity.name?.trim() || byEmail.displayName,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, byEmail.id), isNull(users.identitySubject)))
        .returning();
      user = linked[0] ?? byEmail;
    }
  }

  if (!user) {
    try {
      user = await provisionIdentityUser(tx, {
        subject: identity.subject,
        // An unverified address is never stored: a later invitation to it must not reach this account.
        ...(email && verified ? { email } : {}),
        ...(identity.name ? { name: identity.name } : {}),
      });
    } catch (error) {
      throw new Error(
        `identity_provision:${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  if (!user || user.disabledAt) throw new Error('Identity account cannot sign in');

  if (email && verified && email !== user.email && (await adoptVerifiedEmail(tx, user.id, email))) {
    user = { ...user, email };
  }

  if (identity.name?.trim() && identity.name.trim() !== user.displayName) {
    await tx.update(users).set({ displayName: identity.name.trim() }).where(eq(users.id, user.id));
  }

  const active = await tx
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'active')))
    .limit(1);
  if (active.length === 0) await provisionPersonalOrganization(tx, user, identity.subject);
  return user.id;
}

/**
 * Move the current session to another organization the user belongs to: a new session with
 * that organization's roles replaces this one (only this device; other sessions stay).
 */
export async function switchOrganizationSession(input: {
  userId: string;
  sessionId: string;
  organizationId: string;
  client?: SessionClientContext;
}): Promise<IssuedSession> {
  return withSystem(async (tx) => {
    const issued = await issueForUser(
      tx,
      input.userId,
      {
        preferred: input.organizationId,
        strict: true,
      },
      input.client ?? {},
    );
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)));
    return issued;
  });
}

/**
 * Switch this device's product session to another identity `sub` already on the roster
 * (BHD-ACCOUNT-SWITCHER §5 — no full page reload; cookies rewritten, JSON returned).
 */
export async function switchIdentityAccountSession(input: {
  identitySubject: string;
  previousSessionId?: string;
  previousUserId?: string;
  preferredOrganizationId?: string;
  client?: SessionClientContext;
}): Promise<IssuedSession> {
  return withSystem(async (tx) => {
    const user = await tx.query.users.findFirst({
      where: eq(users.identitySubject, input.identitySubject),
      columns: { id: true, disabledAt: true, securityLockedAt: true },
    });
    if (!user || user.disabledAt) throw new Error('identity_account_missing');
    if (user.securityLockedAt) throw new Error('account_security_locked');
    const issued = await issueForUser(
      tx,
      user.id,
      {
        ...(input.preferredOrganizationId ? { preferred: input.preferredOrganizationId } : {}),
      },
      input.client ?? {},
    );
    if (input.previousSessionId && input.previousUserId) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.id, input.previousSessionId),
            eq(sessions.userId, input.previousUserId),
            isNull(sessions.revokedAt),
          ),
        );
    }
    return issued;
  });
}

export function hasDatabaseUrl(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.replace(/^\uFEFF/, '')
      .replace(/\\r\\n$/gi, '')
      .replace(/\\n$/gi, '')
      .trim(),
  );
}

/** Rebind product session to identity profile from window Bearer (/api/auth/me). */
export async function rebindProductSessionFromProfile(input: {
  identitySubject: string;
  email: string;
  name?: string;
  previousSessionId?: string;
  previousUserId?: string;
  preferredOrganizationId?: string;
  client?: SessionClientContext;
}): Promise<IssuedSession> {
  return withSystem(async (tx) => {
    const userId = await resolveIdentityUser(tx, {
      subject: input.identitySubject,
      email: input.email,
      emailVerified: true,
      ...(input.name !== undefined ? { name: input.name } : {}),
    });
    const issued = await issueForUser(
      tx,
      userId,
      {
        ...(input.preferredOrganizationId ? { preferred: input.preferredOrganizationId } : {}),
      },
      input.client ?? {},
    );
    if (input.previousSessionId && input.previousUserId) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.id, input.previousSessionId),
            eq(sessions.userId, input.previousUserId),
            isNull(sessions.revokedAt),
          ),
        );
    }
    return issued;
  });
}
