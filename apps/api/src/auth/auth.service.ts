import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import {
  apiKeys,
  credentialTokens,
  memberships,
  organizations,
  outboxEvents,
  sessions,
  users,
} from '@bhd-r/db';
import {
  issueSessionToken,
  permissionsForRoles,
  roleKeySchema,
  sessionClaimsSchema,
  verifyIdentityToken,
  verifySessionToken,
  type Permission,
  type SessionClaims,
} from '@bhd-r/authz';
import {
  createCsrfToken,
  decryptField,
  encryptField,
  generateApiKey,
  generateTotpSecret,
  hashApiKey,
  hashPassword,
  rotateEncryptedField,
  totpUri,
  verifyPassword,
  verifyTotp,
  type Keyring,
} from '@bhd-r/security';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';

const sessionSecret = () =>
  new TextEncoder().encode(
    process.env.BHD_R_SESSION_SECRET ?? 'development-session-secret-at-least-32-characters',
  );
const apiPepper = () =>
  createHash('sha256')
    .update(`${process.env.BHD_R_SESSION_SECRET ?? 'development'}\0api-keys`)
    .digest('base64url');
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

function encryptionKeyring(purpose: string): Keyring {
  const entries = Object.entries(process.env).filter(
    ([key, value]) => /^FIELD_ENCRYPTION_KEY_V\d+$/.test(key) && value,
  );
  if (entries.length === 0)
    entries.push(['FIELD_ENCRYPTION_KEY_V1', 'development-field-key-change-in-production']);
  const keys = Object.fromEntries(
    entries.map(([name, value]) => {
      const version = name.replace('FIELD_ENCRYPTION_KEY_', '').toLowerCase();
      return [version, createHash('sha256').update(`${value!}\0${purpose}`).digest()];
    }),
  );
  return { activeVersion: process.env.FIELD_ENCRYPTION_ACTIVE_VERSION ?? 'v1', keys };
}

export interface IssuedSession {
  token: string;
  csrf: string;
  claims: SessionClaims;
}

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}

  async authenticateSession(
    token: string,
    method: 'session' | 'bearer',
  ): Promise<SessionClaims & { authenticationMethod: 'session' | 'bearer' }> {
    try {
      const claims = await verifySessionToken(token, sessionSecret());
      await this.database.asSystem(async (transaction) => {
        const [user, session] = await Promise.all([
          transaction.query.users.findFirst({ where: eq(users.id, claims.sub) }),
          transaction.query.sessions.findFirst({
            where: and(
              eq(sessions.id, claims.sid),
              isNull(sessions.revokedAt),
              gt(sessions.expiresAt, new Date()),
            ),
          }),
        ]);
        if (
          !user ||
          user.disabledAt ||
          user.sessionVersion !== claims.sessionVersion ||
          !session ||
          session.tokenIdHash !== tokenHash(token)
        ) {
          throw new UnauthorizedException('Session is no longer valid');
        }
      });
      return { ...claims, authenticationMethod: method };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired session');
    }
  }

  async authenticateApiKey(
    value: string,
  ): Promise<SessionClaims & { authenticationMethod: 'api_key' }> {
    const digest = hashApiKey(value, apiPepper());
    const row = await this.database.asSystem((transaction) =>
      transaction.query.apiKeys.findFirst({
        where: and(eq(apiKeys.secretDigest, digest), isNull(apiKeys.revokedAt)),
      }),
    );
    if (!row || (row.expiresAt && row.expiresAt <= new Date()))
      throw new UnauthorizedException('Invalid API key');
    const principal = await this.database.asSystem(async (transaction) => {
      const [user, organization, currentMemberships] = await Promise.all([
        transaction.query.users.findFirst({ where: eq(users.id, row.createdByUserId) }),
        transaction.query.organizations.findFirst({
          where: eq(organizations.id, row.organizationId),
        }),
        transaction.query.memberships.findMany({
          where: and(
            eq(memberships.userId, row.createdByUserId),
            eq(memberships.organizationId, row.organizationId),
            eq(memberships.status, 'active'),
          ),
        }),
      ]);
      if (
        !user ||
        user.disabledAt ||
        !organization ||
        organization.status !== 'active' ||
        currentMemberships.length === 0
      )
        throw new UnauthorizedException('API key principal is no longer active');
      const roles = currentMemberships
        .map((membership) => roleKeySchema.safeParse(membership.roleKey))
        .filter((result) => result.success)
        .map((result) => result.data);
      const currentPermissions = new Set([
        ...permissionsForRoles(roles),
        ...currentMemberships.flatMap((membership) => membership.permissions),
      ]);
      if (!row.lastUsedAt || row.lastUsedAt < new Date(Date.now() - 5 * 60_000)) {
        await transaction
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(
            and(
              eq(apiKeys.id, row.id),
              or(
                isNull(apiKeys.lastUsedAt),
                lt(apiKeys.lastUsedAt, new Date(Date.now() - 5 * 60_000)),
              ),
            ),
          );
      }
      return { roles, currentPermissions };
    });
    const permissions = row.scopes.filter(
      (scope): scope is Permission =>
        sessionClaimsSchema.shape.permissions.element.safeParse(scope).success &&
        principal.currentPermissions.has(scope),
    );
    const claims = sessionClaimsSchema.parse({
      sub: row.createdByUserId,
      sid: row.id,
      organizationId: row.organizationId,
      partyId: null,
      roles: principal.roles.filter(
        (role) => role !== 'platform_admin' && role !== 'platform_support',
      ),
      permissions,
      locale: 'en',
      sessionVersion: 0,
    });
    return { ...claims, authenticationMethod: 'api_key' };
  }

  async login(input: {
    username: string;
    password: string;
    organizationId?: string | undefined;
    totpCode?: string | undefined;
  }): Promise<IssuedSession> {
    this.assertLocalAuthEnabled();
    const normalized = input.username.trim().toLowerCase();
    return this.database.asSystem(async (transaction) => {
      const user = await transaction.query.users.findFirst({
        where: eq(users.username, normalized),
      });
      if (
        !user?.credentialHash ||
        user.disabledAt ||
        !(await verifyPassword(input.password, user.credentialHash))
      )
        throw new UnauthorizedException('Invalid credentials');
      if (user.totpConfirmedAt) {
        if (!input.totpCode || !user.totpSecretEncrypted)
          throw new UnauthorizedException('TOTP code is required');
        const keyring = encryptionKeyring('totp');
        const encrypted = rotateEncryptedField(
          user.totpSecretEncrypted,
          keyring,
          `totp:${user.id}`,
        );
        const secret = decryptField(encrypted, keyring, `totp:${user.id}`);
        const verification = verifyTotp({
          code: input.totpCode,
          secret,
          lastAcceptedCounter: user.totpLastAcceptedCounter,
        });
        if (!verification.valid || verification.counter === null)
          throw new UnauthorizedException('Invalid or replayed TOTP code');
        const accepted = await transaction
          .update(users)
          .set({ totpLastAcceptedCounter: verification.counter, totpSecretEncrypted: encrypted })
          .where(
            and(
              eq(users.id, user.id),
              or(
                isNull(users.totpLastAcceptedCounter),
                lt(users.totpLastAcceptedCounter, verification.counter),
              ),
            ),
          )
          .returning({ id: users.id });
        if (accepted.length === 0) throw new UnauthorizedException('TOTP code was already used');
      }
      return this.issueForUser(transaction, user.id, input.organizationId);
    });
  }

  async loginWithIdentity(
    idToken: string,
    organizationId: string | undefined,
    expectedNonce: string,
  ): Promise<IssuedSession> {
    const identityTokenSecret =
      process.env.BHD_IDENTITY_TOKEN_SECRET ?? process.env.IDENTITY_TOKEN_SECRET;
    const identity = await verifyIdentityToken({
      token: idToken,
      issuer: process.env.BHD_IDENTITY_ISSUER ?? 'https://id.bhd-om.com',
      clientId: process.env.BHD_OAUTH_CLIENT_ID ?? process.env.BHD_IDENTITY_CLIENT_ID ?? 'bhd-r',
      expectedNonce,
      ...(identityTokenSecret ? { sharedSecret: identityTokenSecret } : {}),
    });
    const verifiedClaims = decodeJwt(idToken);
    if (verifiedClaims.nonce !== expectedNonce)
      throw new UnauthorizedException('Identity nonce mismatch');
    const clientId =
      process.env.BHD_OAUTH_CLIENT_ID ?? process.env.BHD_IDENTITY_CLIENT_ID ?? 'bhd-r';
    if (
      Array.isArray(verifiedClaims.aud) &&
      verifiedClaims.aud.length > 1 &&
      verifiedClaims.azp !== clientId
    ) {
      throw new UnauthorizedException('Identity authorized party mismatch');
    }
    return this.database.asSystem(async (transaction) => {
      const user = await transaction.query.users.findFirst({
        where: eq(users.identitySubject, identity.subject),
      });
      if (!user || user.disabledAt)
        throw new UnauthorizedException('No BHD R account is assigned to this identity');
      return this.issueForUser(transaction, user.id, organizationId);
    });
  }

  async activate(token: string, password: string): Promise<IssuedSession> {
    this.assertLocalAuthEnabled();
    return this.database.asSystem(async (transaction) => {
      const claimed = await transaction
        .update(credentialTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(credentialTokens.tokenHash, tokenHash(token)),
            eq(credentialTokens.purpose, 'activation'),
            isNull(credentialTokens.usedAt),
            gt(credentialTokens.expiresAt, new Date()),
          ),
        )
        .returning();
      const credential = claimed[0];
      if (!credential) throw new BadRequestException('Activation link is invalid or expired');
      const credentialHash = await hashPassword(password);
      await transaction
        .update(users)
        .set({ credentialHash, sessionVersion: sql`${users.sessionVersion} + 1` })
        .where(eq(users.id, credential.userId));
      return this.issueForUser(transaction, credential.userId);
    });
  }

  async requestPasswordReset(email: string): Promise<void> {
    this.assertLocalAuthEnabled();
    await this.database.asSystem(async (transaction) => {
      const user = await transaction.query.users.findFirst({
        where: eq(users.email, email.trim().toLowerCase()),
      });
      if (!user || user.disabledAt) return;
      const token = randomBytes(32).toString('base64url');
      const rows = await transaction
        .insert(credentialTokens)
        .values({
          userId: user.id,
          purpose: 'password_reset',
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 30 * 60_000),
        })
        .returning();
      await transaction.insert(outboxEvents).values({
        topic: 'notification.requested',
        aggregateType: 'credential_token',
        aggregateId: rows[0]!.id,
        payload: {
          kind: 'password_reset',
          userId: user.id,
          tokenEncrypted: encryptField(
            token,
            encryptionKeyring('notification-token'),
            `credential:${rows[0]!.id}`,
          ),
        },
      });
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    this.assertLocalAuthEnabled();
    await this.database.asSystem(async (transaction) => {
      const claimed = await transaction
        .update(credentialTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(credentialTokens.tokenHash, tokenHash(token)),
            eq(credentialTokens.purpose, 'password_reset'),
            isNull(credentialTokens.usedAt),
            gt(credentialTokens.expiresAt, new Date()),
          ),
        )
        .returning();
      const credential = claimed[0];
      if (!credential) throw new BadRequestException('Reset link is invalid or expired');
      await transaction
        .update(users)
        .set({
          credentialHash: await hashPassword(password),
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(eq(users.id, credential.userId));
      await transaction
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.userId, credential.userId));
      await transaction
        .update(credentialTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(credentialTokens.userId, credential.userId),
            eq(credentialTokens.purpose, 'password_reset'),
            isNull(credentialTokens.usedAt),
          ),
        );
    });
  }

  async revokeAll(claims: SessionClaims): Promise<void> {
    await this.database.asSystem(async (transaction) => {
      const user = await transaction.query.users.findFirst({ where: eq(users.id, claims.sub) });
      if (!user) return;
      await transaction
        .update(users)
        .set({ sessionVersion: user.sessionVersion + 1 })
        .where(eq(users.id, claims.sub));
      await transaction
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.userId, claims.sub));
    });
  }

  async revokeCurrent(claims: SessionClaims): Promise<void> {
    await this.database.asSystem(async (transaction) => {
      await transaction
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.id, claims.sid), eq(sessions.userId, claims.sub)));
    });
  }

  async me(claims: SessionClaims) {
    return this.database.asSystem(async (transaction) => {
      const user = await transaction.query.users.findFirst({
        where: eq(users.id, claims.sub),
        columns: {
          id: true,
          username: true,
          email: true,
          displayName: true,
          locale: true,
          totpConfirmedAt: true,
        },
      });
      if (!user) throw new UnauthorizedException();
      return {
        ...user,
        organizationId: claims.organizationId,
        partyId: claims.partyId,
        roles: claims.roles,
        permissions: claims.permissions,
        mfaEnabled: Boolean(user.totpConfirmedAt),
      };
    });
  }

  async beginTotp(claims: SessionClaims): Promise<{ secret: string; uri: string }> {
    const secret = generateTotpSecret();
    await this.database.asSystem(async (transaction) => {
      const user = await transaction.query.users.findFirst({ where: eq(users.id, claims.sub) });
      if (!user) throw new UnauthorizedException();
      await transaction
        .update(users)
        .set({
          totpSecretEncrypted: encryptField(secret, encryptionKeyring('totp'), `totp:${user.id}`),
          totpConfirmedAt: null,
          totpLastAcceptedCounter: null,
        })
        .where(eq(users.id, user.id));
    });
    return { secret, uri: totpUri({ secret, account: claims.sub }) };
  }

  async confirmTotp(claims: SessionClaims, code: string): Promise<void> {
    await this.database.asSystem(async (transaction) => {
      const user = await transaction.query.users.findFirst({ where: eq(users.id, claims.sub) });
      if (!user?.totpSecretEncrypted)
        throw new BadRequestException('TOTP enrollment was not started');
      const keyring = encryptionKeyring('totp');
      const secret = decryptField(user.totpSecretEncrypted, keyring, `totp:${user.id}`);
      const verification = verifyTotp({ code, secret, window: 1 });
      if (!verification.valid || verification.counter === null)
        throw new BadRequestException('Invalid TOTP code');
      await transaction
        .update(users)
        .set({ totpConfirmedAt: new Date(), totpLastAcceptedCounter: verification.counter })
        .where(eq(users.id, user.id));
    });
  }

  async verifyTotpChallenge(claims: SessionClaims, code: string): Promise<void> {
    await this.database.asSystem(async (transaction) => {
      const user = await transaction.query.users.findFirst({ where: eq(users.id, claims.sub) });
      if (!user?.totpSecretEncrypted || !user.totpConfirmedAt)
        throw new UnauthorizedException('TOTP is not enabled');
      const keyring = encryptionKeyring('totp');
      const encrypted = rotateEncryptedField(user.totpSecretEncrypted, keyring, `totp:${user.id}`);
      const secret = decryptField(encrypted, keyring, `totp:${user.id}`);
      const verification = verifyTotp({
        code,
        secret,
        lastAcceptedCounter: user.totpLastAcceptedCounter,
        window: 1,
      });
      if (!verification.valid || verification.counter === null)
        throw new UnauthorizedException('Invalid or replayed TOTP code');
      const updated = await transaction
        .update(users)
        .set({ totpLastAcceptedCounter: verification.counter, totpSecretEncrypted: encrypted })
        .where(
          and(
            eq(users.id, user.id),
            or(
              isNull(users.totpLastAcceptedCounter),
              lt(users.totpLastAcceptedCounter, verification.counter),
            ),
          ),
        )
        .returning({ id: users.id });
      if (updated.length === 0) throw new UnauthorizedException('TOTP code was already used');
    });
  }

  async createApiKey(
    claims: SessionClaims,
    input: { name: string; scopes: Permission[]; expiresAt?: Date | undefined },
  ): Promise<{ id: string; key: string; prefix: string }> {
    if (input.scopes.some((scope) => !claims.permissions.includes(scope)))
      throw new UnauthorizedException('API key scopes cannot exceed the creator permissions');
    const generated = generateApiKey(apiPepper());
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .insert(apiKeys)
        .values({
          organizationId: claims.organizationId!,
          createdByUserId: claims.sub,
          name: input.name,
          prefix: generated.prefix,
          secretDigest: generated.digest,
          scopes: input.scopes,
          expiresAt: input.expiresAt,
        })
        .returning({ id: apiKeys.id });
      return { id: rows[0]!.id, key: generated.plaintext, prefix: generated.prefix };
    });
  }

  async provisionTenantAccess(
    transaction: DatabaseTransaction,
    input: { organizationId: string; partyId: string; displayName: string; email: string },
  ): Promise<{ userId: string; username: string }> {
    const existingMembership = await transaction.query.memberships.findFirst({
      where: and(
        eq(memberships.organizationId, input.organizationId),
        eq(memberships.partyId, input.partyId),
        eq(memberships.roleKey, 'tenant'),
      ),
    });
    if (existingMembership) {
      const user = await transaction.query.users.findFirst({
        where: eq(users.id, existingMembership.userId),
      });
      return { userId: existingMembership.userId, username: user?.username ?? '' };
    }
    const base =
      input.email
        .split('@')[0]!
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase()
        .slice(0, 16) || 'tenant';
    const username = `${base}.${randomBytes(3).toString('hex')}`;
    const insertedUsers = await transaction
      .insert(users)
      .values({ username, email: input.email.toLowerCase(), displayName: input.displayName })
      .returning();
    const user = insertedUsers[0]!;
    await transaction.insert(memberships).values({
      organizationId: input.organizationId,
      userId: user.id,
      partyId: input.partyId,
      roleKey: 'tenant',
    });
    const token = randomBytes(32).toString('base64url');
    const credentials = await transaction
      .insert(credentialTokens)
      .values({
        userId: user.id,
        purpose: 'activation',
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
      })
      .returning();
    await transaction.insert(outboxEvents).values({
      organizationId: input.organizationId,
      topic: 'tenant.activation-requested',
      aggregateType: 'credential_token',
      aggregateId: credentials[0]!.id,
      payload: {
        userId: user.id,
        partyId: input.partyId,
        username,
        tokenEncrypted: encryptField(
          token,
          encryptionKeyring('notification-token'),
          `credential:${credentials[0]!.id}`,
        ),
      },
    });
    return { userId: user.id, username };
  }

  private async issueForUser(
    transaction: DatabaseTransaction,
    userId: string,
    organizationId?: string,
  ): Promise<IssuedSession> {
    const user = await transaction.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new UnauthorizedException();
    const allMemberships = await transaction.query.memberships.findMany({
      where: and(eq(memberships.userId, userId), eq(memberships.status, 'active')),
    });
    const selected = organizationId
      ? allMemberships.filter((membership) => membership.organizationId === organizationId)
      : allMemberships;
    if (selected.length === 0) throw new UnauthorizedException('No active organization membership');
    const selectedOrganization = organizationId ?? selected[0]!.organizationId;
    const organizationMemberships = selected.filter(
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
    await transaction.insert(sessions).values({
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

  private assertLocalAuthEnabled(): void {
    if (process.env.NODE_ENV === 'production' && process.env.LOCAL_AUTH_ENABLED !== 'true') {
      throw new UnauthorizedException('Local credentials are disabled; use BHD Identity');
    }
  }
}
