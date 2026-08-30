import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  createDatabase,
  memberships,
  organizations,
  parties,
  partyRoles,
  sessions,
  users,
  type Database,
} from '@bhd-r/db';
import {
  issueSessionToken,
  permissionsForRoles,
  roleKeySchema,
  sessionClaimsSchema,
  type Permission,
  type SessionClaims,
} from '@bhd-r/authz';
import { requireCsrfSecret } from '@/lib/runtime-env';
import { createCsrfToken } from '@bhd-r/security';
import { verifyBhdIdToken } from '@/lib/bhd/verify-id-token';

export type IssuedSession = {
  token: string;
  csrf: string;
  claims: SessionClaims;
};

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

function sessionSecret(): Uint8Array {
  const raw =
    process.env.BHD_R_SESSION_SECRET?.replace(/^\uFEFF/, '')
      .replace(/\\r\\n$/gi, '')
      .replace(/\\n$/gi, '')
      .replace(/\r\n$/g, '')
      .replace(/\n$/g, '')
      .trim() || '';
  if (raw.length < 32) {
    throw new Error('session_secret_too_short');
  }
  return new TextEncoder().encode(raw);
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

async function issueForUser(tx: Tx, userId: string): Promise<IssuedSession> {
  const user = await tx.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error('User missing after identity login');
  const allMemberships = await tx.query.memberships.findMany({
    where: and(eq(memberships.userId, userId), eq(memberships.status, 'active')),
  });
  if (allMemberships.length === 0) throw new Error('No active organization membership');
  const selectedOrganization = allMemberships[0]!.organizationId;
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
  const roles = organizationMemberships
    .map((membership) => roleKeySchema.safeParse(membership.roleKey))
    .filter((result) => result.success)
    .map((result) => result.data);
  const customPermissions = organizationMemberships
    .flatMap((membership) => membership.permissions)
    .filter(
      (permission): permission is Permission =>
        sessionClaimsSchema.shape.permissions.element.safeParse(permission).success,
    );
  const sid = randomUUID();
  const claims = sessionClaimsSchema.parse({
    sub: user.id,
    sid,
    organizationId: selectedOrganization,
    partyId: organizationMemberships.find((membership) => membership.partyId)?.partyId ?? null,
    roles,
    permissions: [...new Set([...permissionsForRoles(roles), ...customPermissions])],
    locale: user.locale === 'en' ? 'en' : 'ar',
    sessionVersion: user.sessionVersion,
  });
  const token = await issueSessionToken(claims, sessionSecret(), 8 * 60 * 60);
  await tx.insert(sessions).values({
    id: sid,
    userId: user.id,
    tokenIdHash: tokenHash(token),
    expiresAt: new Date(Date.now() + 8 * 60 * 60_000),
  });
  return {
    token,
    csrf: createCsrfToken(sid, requireCsrfSecret()),
    claims,
  };
}

async function provisionIdentityUser(
  tx: Tx,
  identity: { subject: string; email?: string; name?: string },
) {
  const email =
    identity.email?.trim().toLowerCase() ||
    `${identity.subject.replace(/[^a-z0-9]/gi, '').slice(0, 24) || 'user'}@identity.bhd-om.local`;
  const displayName = identity.name?.trim() || email.split('@')[0] || 'BHD user';
  const base =
    email
      .split('@')[0]!
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .slice(0, 16) || 'user';
  const username = `${base}.${randomBytes(3).toString('hex')}`;
  const slug = `sso-${identity.subject.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || randomBytes(6).toString('hex')}`;

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

  const insertedOrgs = await tx
    .insert(organizations)
    .values({
      type: 'individual',
      slug,
      legalName: displayName,
      displayNameAr: displayName,
      displayNameEn: displayName,
      planKey: 'starter',
    })
    .returning();
  const organization = insertedOrgs[0]!;

  const ownerPartyId = await ensureOwnerParty(tx, {
    userId: user.id,
    organizationId: organization.id,
    displayName,
    email,
    membershipPartyId: null,
  });

  await tx.insert(memberships).values({
    organizationId: organization.id,
    userId: user.id,
    partyId: ownerPartyId,
    roleKey: 'organization_owner',
  });

  return user;
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

/** Issue BHD R session from a verified Identity ID token (SSO §0.7). */
export async function issueIdentitySession(input: {
  idToken: string;
  nonce: string;
  accessToken?: string;
  jwksUri?: string;
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
    let user = await tx.query.users.findFirst({
      where: eq(users.identitySubject, identity.subject),
    });

    if (!user && identity.email && identity.emailVerified) {
      const byEmail = await tx.query.users.findFirst({
        where: eq(users.email, identity.email.trim().toLowerCase()),
      });
      if (byEmail && !byEmail.identitySubject) {
        const linked = await tx
          .update(users)
          .set({
            identitySubject: identity.subject,
            displayName: identity.name?.trim() || byEmail.displayName,
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
          ...(identity.email ? { email: identity.email } : {}),
          ...(identity.name ? { name: identity.name } : {}),
        });
      } catch (error) {
        throw new Error(
          `identity_provision:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (!user || user.disabledAt) throw new Error('Identity account cannot sign in');

    if (identity.name?.trim() && identity.name.trim() !== user.displayName) {
      await tx
        .update(users)
        .set({ displayName: identity.name.trim() })
        .where(eq(users.id, user.id));
    }

    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
    await tx
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, user.id));

    try {
      return await issueForUser(tx, user.id);
    } catch (error) {
      throw new Error(
        `identity_session_issue:${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
