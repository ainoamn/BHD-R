import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import {
  apiKeys,
  credentialTokens,
  memberships,
  organizations,
  outboxEvents,
  parties,
  partyRoles,
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
  type RoleKey,
  type SessionClaims,
} from '@bhd-r/authz';
import {
  createCsrfToken,
  decryptField,
  encryptField,
  generateApiKey,
  generateTotpRecoveryCodes,
  generateTotpSecret,
  hashApiKey,
  hashPassword,
  hashTotpRecoveryCode,
  consumeTotpRecoveryDigest,
  rotateEncryptedField,
  totpUri,
  verifyPassword,
  verifyTotp,
  type Keyring,
} from '@bhd-r/security';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';
import { ensureDefaultContractTemplate } from '../common/default-contract-template.js';

const sessionSecret = () =>
  new TextEncoder().encode(
    process.env.BHD_R_SESSION_SECRET ?? 'development-session-secret-at-least-32-characters',
  );
const apiPepper = () =>
  createHash('sha256')
    .update(`${process.env.BHD_R_SESSION_SECRET ?? 'development'}\0api-keys`)
    .digest('base64url');
const totpRecoveryPepper = () =>
  createHash('sha256')
    .update(`${process.env.BHD_R_SESSION_SECRET ?? 'development'}\0totp-recovery`)
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
        if (!input.totpCode) throw new UnauthorizedException('TOTP code is required');
        const usedRecovery = await this.consumeRecoveryCode(
          transaction,
          user.id,
          user.totpRecoveryDigests ?? [],
          input.totpCode,
        );
        if (!usedRecovery) {
          if (!user.totpSecretEncrypted) throw new UnauthorizedException('TOTP code is required');
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
      }
      return this.issueForUser(transaction, user.id, input.organizationId);
    });
  }

  async loginWithIdentity(
    idToken: string,
    organizationId: string | undefined,
    expectedNonce: string,
    accessToken?: string,
  ): Promise<IssuedSession> {
    const identityTokenSecret =
      process.env.BHD_IDENTITY_TOKEN_SECRET?.trim() ||
      process.env.IDENTITY_TOKEN_SECRET?.trim() ||
      process.env.AUTH_SECRET?.trim() ||
      undefined;
    const identity = await verifyIdentityToken({
      token: idToken,
      issuer: process.env.BHD_IDENTITY_ISSUER ?? 'https://id.bhd-om.com',
      clientId: process.env.BHD_OAUTH_CLIENT_ID ?? process.env.BHD_IDENTITY_CLIENT_ID ?? 'bhd-r',
      expectedNonce,
      ...(identityTokenSecret ? { sharedSecret: identityTokenSecret } : {}),
      ...(accessToken ? { accessToken } : {}),
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
      // BHD-PRODUCT-SSO-ADMIN §3.3 / UNIFIED §0.7 — link by bhd_sub then verified email
      let user = await transaction.query.users.findFirst({
        where: eq(users.identitySubject, identity.subject),
      });

      if (!user && identity.email && identity.emailVerified) {
        const byEmail = await transaction.query.users.findFirst({
          where: eq(users.email, identity.email.trim().toLowerCase()),
        });
        if (byEmail && !byEmail.identitySubject) {
          const linked = await transaction
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
        user = await this.provisionIdentityUser(transaction, {
          subject: identity.subject,
          ...(identity.email ? { email: identity.email } : {}),
          ...(identity.name ? { name: identity.name } : {}),
        });
      }

      if (!user || user.disabledAt)
        throw new UnauthorizedException('No BHD R account is assigned to this identity');

      if (identity.name?.trim() && identity.name.trim() !== user.displayName) {
        await transaction
          .update(users)
          .set({ displayName: identity.name.trim() })
          .where(eq(users.id, user.id));
      }

      await transaction
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
      await transaction
        .update(users)
        .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
        .where(eq(users.id, user.id));

      return this.issueForUser(transaction, user.id, organizationId);
    });
  }

  /** New SSO user: default org owner of a personal STARTER org — never platform_admin. */
  private async provisionIdentityUser(
    transaction: DatabaseTransaction,
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

    const insertedUsers = await transaction
      .insert(users)
      .values({
        username,
        email,
        displayName,
        identitySubject: identity.subject,
      })
      .returning();
    const user = insertedUsers[0]!;

    const insertedOrgs = await transaction
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

    const ownerPartyRows = await transaction
      .insert(parties)
      .values({
        organizationId: organization.id,
        type: 'person',
        displayName,
        email,
      })
      .returning({ id: parties.id });
    const ownerPartyId = ownerPartyRows[0]!.id;
    await transaction.insert(partyRoles).values({
      organizationId: organization.id,
      partyId: ownerPartyId,
      roleKey: 'owner',
    });

    await transaction.insert(memberships).values({
      organizationId: organization.id,
      userId: user.id,
      partyId: ownerPartyId,
      roleKey: 'organization_owner',
    });
    await ensureDefaultContractTemplate(transaction, organization.id);

    return user;
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

  async beginTotp(
    claims: SessionClaims,
    currentCode?: string,
  ): Promise<{ secret: string; uri: string }> {
    const secret = generateTotpSecret();
    await this.database.asSystem(async (transaction) => {
      const user = await transaction.query.users.findFirst({ where: eq(users.id, claims.sub) });
      if (!user) throw new UnauthorizedException();
      // P1-01: re-enroll requires step-up with the existing MFA factor.
      if (user.totpConfirmedAt && user.totpSecretEncrypted) {
        if (!currentCode) {
          throw new UnauthorizedException('Current TOTP or recovery code is required to re-enroll');
        }
        const keyring = encryptionKeyring('totp');
        const existingSecret = decryptField(
          user.totpSecretEncrypted,
          keyring,
          `totp:${user.id}`,
        );
        const verification = verifyTotp({
          code: currentCode,
          secret: existingSecret,
          lastAcceptedCounter: user.totpLastAcceptedCounter,
          window: 1,
        });
        let steppedUp = Boolean(verification.valid && verification.counter !== null);
        if (steppedUp && verification.counter !== null) {
          await transaction
            .update(users)
            .set({ totpLastAcceptedCounter: verification.counter })
            .where(
              and(
                eq(users.id, user.id),
                or(
                  isNull(users.totpLastAcceptedCounter),
                  lt(users.totpLastAcceptedCounter, verification.counter),
                ),
              ),
            );
        } else {
          steppedUp = await this.consumeRecoveryCode(
            transaction,
            user.id,
            user.totpRecoveryDigests ?? [],
            currentCode,
          );
        }
        if (!steppedUp) throw new UnauthorizedException('Invalid step-up code');
      }
      await transaction
        .update(users)
        .set({
          totpSecretEncrypted: encryptField(secret, encryptionKeyring('totp'), `totp:${user.id}`),
          totpConfirmedAt: null,
          totpLastAcceptedCounter: null,
          totpRecoveryDigests: [],
        })
        .where(eq(users.id, user.id));
    });
    return { secret, uri: totpUri({ secret, account: claims.sub }) };
  }

  async confirmTotp(
    claims: SessionClaims,
    code: string,
  ): Promise<{ confirmed: true; recoveryCodes: string[] }> {
    return this.database.asSystem(async (transaction) => {
      const user = await transaction.query.users.findFirst({ where: eq(users.id, claims.sub) });
      if (!user?.totpSecretEncrypted)
        throw new BadRequestException('TOTP enrollment was not started');
      const keyring = encryptionKeyring('totp');
      const secret = decryptField(user.totpSecretEncrypted, keyring, `totp:${user.id}`);
      const verification = verifyTotp({ code, secret, window: 1 });
      if (!verification.valid || verification.counter === null)
        throw new BadRequestException('Invalid TOTP code');
      const recoveryCodes = generateTotpRecoveryCodes(10);
      const digests = recoveryCodes.map((item) => hashTotpRecoveryCode(item, totpRecoveryPepper()));
      await transaction
        .update(users)
        .set({
          totpConfirmedAt: new Date(),
          totpLastAcceptedCounter: verification.counter,
          totpRecoveryDigests: digests,
        })
        .where(eq(users.id, user.id));
      // Invalidate other live sessions after MFA change (keep current sid).
      await transaction
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.userId, user.id),
            isNull(sessions.revokedAt),
            sql`${sessions.id} <> ${claims.sid}`,
          ),
        );
      await transaction.insert(outboxEvents).values({
        topic: 'security.totp_confirmed',
        aggregateType: 'user',
        aggregateId: user.id,
        payload: { sid: claims.sid, at: new Date().toISOString() },
      });
      return { confirmed: true as const, recoveryCodes };
    });
  }

  private async consumeRecoveryCode(
    transaction: DatabaseTransaction,
    userId: string,
    digests: string[],
    code: string,
  ): Promise<boolean> {
    if (!digests.length || /^\d{6}$/.test(code.trim())) return false;
    const result = consumeTotpRecoveryDigest(digests, code, totpRecoveryPepper());
    if (!result.matched) return false;
    const matchedDigest = digests.find((digest) => !result.remaining.includes(digest));
    if (!matchedDigest) return false;
    const updated = await transaction
      .update(users)
      .set({ totpRecoveryDigests: result.remaining })
      .where(
        and(
          eq(users.id, userId),
          sql`EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(${users.totpRecoveryDigests}) AS digest(value)
            WHERE digest.value = ${matchedDigest}
          )`,
        ),
      )
      .returning({ id: users.id });
    if (updated.length === 0) throw new UnauthorizedException('Recovery code was already used');
    return true;
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
    claims: SessionClaims & { authenticationMethod?: 'session' | 'bearer' | 'api_key' },
    input: {
      name: string;
      scopes: Permission[];
      expiresAt?: Date | undefined;
      totpCode?: string | undefined;
    },
  ): Promise<{ id: string; key: string; prefix: string }> {
    await this.assertApiKeyStepUp(claims, input.totpCode);
    if (input.scopes.some((scope) => !claims.permissions.includes(scope)))
      throw new UnauthorizedException('API key scopes cannot exceed the creator permissions');
    const nonDelegable = new Set<Permission>([
      'api_key.write',
      'contract.sign',
      'payment.gateway.write',
      'platform.settings.write',
      'country_pack.write',
    ]);
    if (input.scopes.some((scope) => nonDelegable.has(scope)))
      throw new UnauthorizedException('One or more scopes require an interactive user session');
    const expiresAt = input.expiresAt ?? new Date(Date.now() + 90 * 24 * 60 * 60_000);
    if (
      expiresAt <= new Date(Date.now() + 60 * 60_000) ||
      expiresAt > new Date(Date.now() + 366 * 24 * 60 * 60_000)
    ) {
      throw new BadRequestException('API keys must expire between one hour and one year');
    }
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
          expiresAt,
        })
        .returning({ id: apiKeys.id });
      return { id: rows[0]!.id, key: generated.plaintext, prefix: generated.prefix };
    });
  }

  listApiKeys(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          scopes: apiKeys.scopes,
          createdByUserId: apiKeys.createdByUserId,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          revokedAt: apiKeys.revokedAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.organizationId, claims.organizationId!))
        .orderBy(desc(apiKeys.createdAt));
      return rows.map((row) => ({
        ...row,
        status: row.revokedAt
          ? 'revoked'
          : row.expiresAt && row.expiresAt <= new Date()
            ? 'expired'
            : 'active',
      }));
    });
  }

  async revokeApiKey(
    claims: SessionClaims & { authenticationMethod?: 'session' | 'bearer' | 'api_key' },
    id: string,
    totpCode?: string,
  ): Promise<void> {
    await this.assertApiKeyStepUp(claims, totpCode);
    const revoked = await this.database.withinTenant(claims, (transaction) =>
      transaction
        .update(apiKeys)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, id),
            eq(apiKeys.organizationId, claims.organizationId!),
            isNull(apiKeys.revokedAt),
          ),
        )
        .returning({ id: apiKeys.id }),
    );
    if (!revoked[0]) throw new NotFoundException('Active API key not found');
  }

  private async assertApiKeyStepUp(
    claims: SessionClaims & { authenticationMethod?: 'session' | 'bearer' | 'api_key' },
    totpCode?: string,
  ): Promise<void> {
    if (claims.authenticationMethod === 'api_key') {
      throw new UnauthorizedException('API keys cannot manage other API keys');
    }
    const state = await this.database.asSystem(async (transaction) => {
      const [user, session] = await Promise.all([
        transaction.query.users.findFirst({ where: eq(users.id, claims.sub) }),
        transaction.query.sessions.findFirst({
          where: and(
            eq(sessions.id, claims.sid),
            eq(sessions.userId, claims.sub),
            isNull(sessions.revokedAt),
          ),
        }),
      ]);
      return { mfaEnabled: Boolean(user?.totpConfirmedAt), sessionCreatedAt: session?.createdAt };
    });
    if (!state.sessionCreatedAt || state.sessionCreatedAt < new Date(Date.now() - 10 * 60_000)) {
      throw new UnauthorizedException('A recent sign-in is required');
    }
    if (state.mfaEnabled) {
      if (!totpCode) throw new UnauthorizedException('TOTP confirmation is required');
      await this.verifyTotpChallenge(claims, totpCode);
    }
  }

  async provisionTenantAccess(
    transaction: DatabaseTransaction,
    input: {
      organizationId: string;
      partyId: string;
      displayName: string;
      email: string;
      roleKey?: RoleKey | undefined;
    },
  ): Promise<{ userId: string; username: string; activationRequired: boolean }> {
    const roleKey = input.roleKey ?? 'tenant';
    const existingMembership = await transaction.query.memberships.findFirst({
      where: and(
        eq(memberships.organizationId, input.organizationId),
        eq(memberships.partyId, input.partyId),
        eq(memberships.roleKey, roleKey),
      ),
    });
    const base =
      input.email
        .split('@')[0]!
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase()
        .slice(0, 16) || roleKey.replaceAll('_', '').slice(0, 16);
    const email = input.email.toLowerCase();
    let user = existingMembership
      ? await transaction.query.users.findFirst({ where: eq(users.id, existingMembership.userId) })
      : await transaction.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      const username = `${base}.${randomBytes(3).toString('hex')}`;
      const insertedUsers = await transaction
        .insert(users)
        .values({ username, email, displayName: input.displayName })
        .returning();
      user = insertedUsers[0]!;
    }
    await transaction
      .insert(memberships)
      .values({
        organizationId: input.organizationId,
        userId: user.id,
        partyId: input.partyId,
        roleKey,
      })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId, memberships.roleKey],
        set: { partyId: input.partyId, status: 'active' },
      });
    const activationRequired = !user.credentialHash && !user.identitySubject;
    if (!activationRequired) {
      return { userId: user.id, username: user.username, activationRequired: false };
    }
    await transaction
      .update(credentialTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(credentialTokens.userId, user.id),
          eq(credentialTokens.purpose, 'activation'),
          isNull(credentialTokens.usedAt),
        ),
      );
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
        username: user.username,
        tokenEncrypted: encryptField(
          token,
          encryptionKeyring('notification-token'),
          `credential:${credentials[0]!.id}`,
        ),
      },
    });
    return { userId: user.id, username: user.username, activationRequired: true };
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
    let organizationMemberships = selected.filter(
      (membership) => membership.organizationId === selectedOrganization,
    );
    const ownerMembership = organizationMemberships.find(
      (membership) => membership.roleKey === 'organization_owner',
    );
    if (ownerMembership) {
      let ownerPartyId = ownerMembership.partyId;
      if (!ownerPartyId) {
        const ownerPartyRows = await transaction
          .insert(parties)
          .values({
            organizationId: selectedOrganization,
            type: 'person',
            displayName: user.displayName,
            email: user.email,
          })
          .onConflictDoNothing()
          .returning({ id: parties.id });
        ownerPartyId = ownerPartyRows[0]?.id ?? null;
        if (!ownerPartyId) {
          const existing = await transaction.query.parties.findFirst({
            where: and(
              eq(parties.organizationId, selectedOrganization),
              eq(parties.email, user.email),
            ),
          });
          ownerPartyId = existing?.id ?? null;
        }
        if (!ownerPartyId) throw new UnauthorizedException('Owner party bootstrap failed');
        await transaction
          .update(memberships)
          .set({ partyId: ownerPartyId })
          .where(
            and(
              eq(memberships.organizationId, selectedOrganization),
              eq(memberships.userId, userId),
              eq(memberships.roleKey, 'organization_owner'),
            ),
          );
      }
      await transaction
        .insert(partyRoles)
        .values({
          organizationId: selectedOrganization,
          partyId: ownerPartyId,
          roleKey: 'owner',
        })
        .onConflictDoUpdate({
          target: [partyRoles.organizationId, partyRoles.partyId, partyRoles.roleKey],
          set: { status: 'active', updatedAt: new Date() },
        });
      organizationMemberships = organizationMemberships.map((membership) =>
        membership === ownerMembership ? { ...membership, partyId: ownerPartyId } : membership,
      );
      await ensureDefaultContractTemplate(transaction, selectedOrganization);
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
