import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import {
  createDatabase,
  memberships,
  organizations,
  sessions,
  users,
  type Database,
} from '@bhd-r/db';
import {
  issueSessionToken,
  permissionsForRoles,
  roleKeySchema,
  sessionClaimsSchema,
  verifyIdentityToken,
  type Permission,
  type SessionClaims,
} from '@bhd-r/authz';
import { createCsrfToken } from '@bhd-r/security';

export type IssuedSession = {
  token: string;
  csrf: string;
  claims: SessionClaims;
};

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

function sessionSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.BHD_R_SESSION_SECRET ?? 'development-session-secret-at-least-32-characters',
  );
}

async function withSystem<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
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

async function issueForUser(tx: Tx, userId: string): Promise<IssuedSession> {
  const user = await tx.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error('User missing after identity login');
  const allMemberships = await tx.query.memberships.findMany({
    where: and(eq(memberships.userId, userId), eq(memberships.status, 'active')),
  });
  if (allMemberships.length === 0) throw new Error('No active organization membership');
  const selectedOrganization = allMemberships[0]!.organizationId;
  const organizationMemberships = allMemberships.filter(
    (membership) => membership.organizationId === selectedOrganization,
  );
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
    csrf: createCsrfToken(
      sid,
      process.env.CSRF_SECRET ?? 'development-csrf-secret-must-be-at-least-32-chars',
    ),
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

  await tx.insert(memberships).values({
    organizationId: organization.id,
    userId: user.id,
    roleKey: 'organization_owner',
  });

  return user;
}

/** Issue BHD R session from a verified Identity ID token (SSO §0.7). */
export async function issueIdentitySession(input: {
  idToken: string;
  nonce: string;
  accessToken?: string;
}): Promise<IssuedSession> {
  const cleanSecret = (value: string | undefined) =>
    value?.replace(/^\uFEFF/, '').replace(/\\r\\n$/i, '').trim() || undefined;
  const identityTokenSecret =
    cleanSecret(process.env.BHD_IDENTITY_TOKEN_SECRET) ||
    cleanSecret(process.env.IDENTITY_TOKEN_SECRET) ||
    cleanSecret(process.env.AUTH_SECRET) ||
    undefined;
  const identity = await verifyIdentityToken({
    token: input.idToken,
    issuer: process.env.BHD_IDENTITY_ISSUER ?? 'https://id.bhd-om.com',
    clientId: process.env.BHD_OAUTH_CLIENT_ID ?? process.env.BHD_IDENTITY_CLIENT_ID ?? 'bhd-r',
    expectedNonce: input.nonce,
    ...(identityTokenSecret ? { sharedSecret: identityTokenSecret } : {}),
    ...(input.accessToken ? { accessToken: input.accessToken } : {}),
  });
  const verifiedClaims = decodeJwt(input.idToken);
  if (verifiedClaims.nonce !== input.nonce) throw new Error('Identity nonce mismatch');
  const clientId =
    process.env.BHD_OAUTH_CLIENT_ID ?? process.env.BHD_IDENTITY_CLIENT_ID ?? 'bhd-r';
  if (
    Array.isArray(verifiedClaims.aud) &&
    verifiedClaims.aud.length > 1 &&
    verifiedClaims.azp !== clientId
  ) {
    throw new Error('Identity authorized party mismatch');
  }

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
      user = await provisionIdentityUser(tx, {
        subject: identity.subject,
        ...(identity.email ? { email: identity.email } : {}),
        ...(identity.name ? { name: identity.name } : {}),
      });
    }

    if (!user || user.disabledAt) throw new Error('Identity account cannot sign in');

    if (identity.name?.trim() && identity.name.trim() !== user.displayName) {
      await tx.update(users).set({ displayName: identity.name.trim() }).where(eq(users.id, user.id));
    }

    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
    await tx
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, user.id));

    return issueForUser(tx, user.id);
  });
}

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}
