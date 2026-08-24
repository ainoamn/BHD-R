import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, count, desc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { entitlementsForPlan } from '@bhd-r/domain';
import {
  memberships,
  organizationInvitations,
  organizations,
  parties,
  partyRoles,
  sessions,
  users,
} from '@bhd-r/db';
import type { RoleKey, SessionClaims } from '@bhd-r/authz';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';
import { AuthService } from '../auth/auth.service.js';

const digestInviteToken = (token: string) => createHash('sha256').update(token).digest('hex');

const ROLE_RANK: Record<RoleKey, number> = {
  organization_owner: 50,
  organization_admin: 40,
  developer_admin: 40,
  property_manager: 30,
  finance_manager: 30,
  maintenance_agent: 20,
  auditor: 10,
  tenant: 0,
  platform_admin: 100,
  platform_support: 5,
};

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  getCurrent(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const row = await transaction.query.organizations.findFirst({
        where: eq(organizations.id, claims.organizationId!),
      });
      if (!row) throw new NotFoundException('Organization not found');
      return row;
    });
  }

  listMembers(claims: SessionClaims) {
    return this.database.asSystem(async (transaction) =>
      transaction
        .select({
          userId: users.id,
          displayName: users.displayName,
          email: users.email,
          roleKey: memberships.roleKey,
          status: memberships.status,
          partyId: memberships.partyId,
          createdAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.organizationId, claims.organizationId!)),
    );
  }

  private assertAssignableRole(claims: SessionClaims, roleKey: RoleKey) {
    const actorRank = Math.max(...claims.roles.map((role) => ROLE_RANK[role] ?? 0));
    const targetRank = ROLE_RANK[roleKey] ?? 0;
    if (
      targetRank > actorRank ||
      (['organization_owner', 'organization_admin', 'developer_admin'].includes(roleKey) &&
        !claims.roles.includes('organization_owner') &&
        !claims.roles.includes('platform_admin'))
    ) {
      throw new ForbiddenException('You cannot assign a role at or above this authority level');
    }
  }

  private async assertTeamSeatAvailable(
    transaction: DatabaseTransaction,
    organizationId: string,
    planKey: string,
  ) {
    const limit = entitlementsForPlan(planKey).representatives;
    const memberCount = await transaction
      .select({ count: count() })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, 'active'),
          notInArray(memberships.roleKey, ['organization_owner', 'tenant']),
        ),
      );
    const pendingInvites = await transaction
      .select({ count: count() })
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, organizationId),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.revokedAt),
          sql`${organizationInvitations.expiresAt} > now()`,
        ),
      );
    const used = Number(memberCount[0]?.count ?? 0) + Number(pendingInvites[0]?.count ?? 0);
    if (used >= limit) {
      throw new ConflictException(
        `Plan ${entitlementsForPlan(planKey).key} allows at most ${limit} representatives; requested total would be ${used + 1}`,
      );
    }
  }

  async addRepresentative(
    claims: SessionClaims,
    input: { email: string; displayName: string; roleKey: RoleKey; partyId?: string | undefined },
  ): Promise<{ userId: string }> {
    this.assertAssignableRole(claims, input.roleKey);
    return this.database.asSystem(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${claims.organizationId!}, 7))`,
      );
      const organization = await transaction.query.organizations.findFirst({
        where: eq(organizations.id, claims.organizationId!),
      });
      if (!organization) throw new NotFoundException('Organization not found');
      await this.assertTeamSeatAvailable(transaction, claims.organizationId!, organization.planKey);
      const normalizedEmail = input.email.trim().toLowerCase();
      let partyId = input.partyId;
      if (input.partyId) {
        const party = await transaction.query.parties.findFirst({
          where: and(
            eq(parties.id, input.partyId),
            eq(parties.organizationId, claims.organizationId!),
          ),
        });
        if (!party) throw new NotFoundException('Representative party not found');
      } else {
        const existingParty = await transaction.query.parties.findFirst({
          where: and(
            eq(parties.organizationId, claims.organizationId!),
            eq(parties.email, normalizedEmail),
          ),
        });
        const party =
          existingParty ??
          (
            await transaction
              .insert(parties)
              .values({
                organizationId: claims.organizationId!,
                type: 'person',
                displayName: input.displayName,
                email: normalizedEmail,
                metadata: { source: 'team_invitation' },
              })
              .returning()
          )[0];
        if (!party) throw new ConflictException('Could not create representative party');
        partyId = party.id;
        await transaction
          .insert(partyRoles)
          .values({
            organizationId: claims.organizationId!,
            partyId,
            roleKey: 'authorized_representative',
          })
          .onConflictDoNothing();
      }
      return this.auth.provisionTenantAccess(transaction, {
        organizationId: claims.organizationId!,
        partyId: partyId!,
        displayName: input.displayName,
        email: normalizedEmail,
        roleKey: input.roleKey,
      });
    });
  }

  createInvitation(
    claims: SessionClaims,
    input: {
      email: string;
      roleKey: RoleKey;
      principalPartyId?: string | undefined;
      scopes?: string[] | undefined;
      expiresInHours?: number | undefined;
    },
  ) {
    this.assertAssignableRole(claims, input.roleKey);
    if (!claims.sub) throw new UnauthorizedException('Authenticated actor required');
    return this.database.asSystem(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${claims.organizationId!}, 7))`,
      );
      const organization = await transaction.query.organizations.findFirst({
        where: eq(organizations.id, claims.organizationId!),
      });
      if (!organization) throw new NotFoundException('Organization not found');
      if (input.principalPartyId) {
        const principal = await transaction.query.parties.findFirst({
          where: and(
            eq(parties.id, input.principalPartyId),
            eq(parties.organizationId, claims.organizationId!),
          ),
        });
        if (!principal) throw new NotFoundException('Principal party not found');
      }
      const email = input.email.trim().toLowerCase();
      await transaction
        .update(organizationInvitations)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(organizationInvitations.organizationId, claims.organizationId!),
            eq(organizationInvitations.email, email),
            isNull(organizationInvitations.acceptedAt),
            isNull(organizationInvitations.revokedAt),
          ),
        );
      await this.assertTeamSeatAvailable(transaction, claims.organizationId!, organization.planKey);
      const token = randomBytes(32).toString('base64url');
      const hours = input.expiresInHours ?? 72;
      const rows = await transaction
        .insert(organizationInvitations)
        .values({
          organizationId: claims.organizationId!,
          email,
          roleKey: input.roleKey,
          principalPartyId: input.principalPartyId,
          scopes: input.scopes ?? [],
          tokenDigest: digestInviteToken(token),
          invitedByUserId: claims.sub,
          expiresAt: new Date(Date.now() + hours * 60 * 60_000),
        })
        .returning();
      const invitation = rows[0]!;
      return {
        id: invitation.id,
        email: invitation.email,
        roleKey: invitation.roleKey,
        expiresAt: invitation.expiresAt,
        token,
      };
    });
  }

  listInvitations(claims: SessionClaims) {
    return this.database.asSystem(async (transaction) =>
      transaction
        .select({
          id: organizationInvitations.id,
          email: organizationInvitations.email,
          roleKey: organizationInvitations.roleKey,
          principalPartyId: organizationInvitations.principalPartyId,
          scopes: organizationInvitations.scopes,
          expiresAt: organizationInvitations.expiresAt,
          acceptedAt: organizationInvitations.acceptedAt,
          revokedAt: organizationInvitations.revokedAt,
          createdAt: organizationInvitations.createdAt,
        })
        .from(organizationInvitations)
        .where(eq(organizationInvitations.organizationId, claims.organizationId!))
        .orderBy(desc(organizationInvitations.createdAt)),
    );
  }

  revokeInvitation(claims: SessionClaims, invitationId: string) {
    return this.database.asSystem(async (transaction) => {
      const rows = await transaction
        .update(organizationInvitations)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(organizationInvitations.id, invitationId),
            eq(organizationInvitations.organizationId, claims.organizationId!),
            isNull(organizationInvitations.acceptedAt),
            isNull(organizationInvitations.revokedAt),
          ),
        )
        .returning({
          id: organizationInvitations.id,
          email: organizationInvitations.email,
          revokedAt: organizationInvitations.revokedAt,
        });
      if (!rows[0]) throw new NotFoundException('Open invitation not found');
      return rows[0];
    });
  }

  acceptInvitation(claims: SessionClaims, token: string) {
    if (!claims.sub) throw new UnauthorizedException('Authenticated actor required');
    return this.database.asSystem(async (transaction) => {
      const digest = digestInviteToken(token);
      const invitation = await transaction.query.organizationInvitations.findFirst({
        where: eq(organizationInvitations.tokenDigest, digest),
      });
      if (!invitation || invitation.revokedAt || invitation.acceptedAt) {
        throw new NotFoundException('Invitation not found');
      }
      if (invitation.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException('Invitation has expired');
      }
      const user = await transaction.query.users.findFirst({
        where: eq(users.id, claims.sub),
      });
      if (!user?.email || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new ForbiddenException('Signed-in email does not match the invitation');
      }
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${invitation.organizationId}, 7))`,
      );
      let partyId = invitation.principalPartyId;
      if (!partyId) {
        const existingParty = await transaction.query.parties.findFirst({
          where: and(
            eq(parties.organizationId, invitation.organizationId),
            eq(parties.email, invitation.email),
          ),
        });
        const party =
          existingParty ??
          (
            await transaction
              .insert(parties)
              .values({
                organizationId: invitation.organizationId,
                type: 'person',
                displayName: user.displayName,
                email: invitation.email,
                metadata: { source: 'organization_invitation' },
              })
              .returning()
          )[0];
        if (!party) throw new ConflictException('Could not create invited party');
        partyId = party.id;
        await transaction
          .insert(partyRoles)
          .values({
            organizationId: invitation.organizationId,
            partyId,
            roleKey: 'authorized_representative',
          })
          .onConflictDoNothing();
      }
      const provisioned = await this.auth.provisionTenantAccess(transaction, {
        organizationId: invitation.organizationId,
        partyId,
        displayName: user.displayName,
        email: invitation.email,
        roleKey: invitation.roleKey as RoleKey,
      });
      await transaction
        .update(organizationInvitations)
        .set({ acceptedAt: new Date(), updatedAt: new Date() })
        .where(eq(organizationInvitations.id, invitation.id));
      return {
        organizationId: invitation.organizationId,
        invitationId: invitation.id,
        ...provisioned,
      };
    });
  }

  updateMember(
    claims: SessionClaims,
    userId: string,
    input: { roleKey: RoleKey; status: 'active' | 'inactive' },
  ) {
    if (userId === claims.sub) throw new ForbiddenException('You cannot disable your own access');
    if (input.roleKey === 'organization_owner' && !claims.roles.includes('platform_admin'))
      throw new ForbiddenException('Only a platform administrator can change an owner membership');
    return this.database.asSystem(async (transaction) => {
      const rows = await transaction
        .update(memberships)
        .set({ status: input.status })
        .where(
          and(
            eq(memberships.organizationId, claims.organizationId!),
            eq(memberships.userId, userId),
            eq(memberships.roleKey, input.roleKey),
          ),
        )
        .returning({
          userId: memberships.userId,
          roleKey: memberships.roleKey,
          status: memberships.status,
        });
      if (!rows[0]) throw new NotFoundException('Membership not found');
      if (input.status === 'inactive') {
        await transaction
          .update(users)
          .set({ sessionVersion: sql`${users.sessionVersion} + 1`, updatedAt: new Date() })
          .where(eq(users.id, userId));
        await transaction
          .update(sessions)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(sessions.userId, userId), sql`${sessions.revokedAt} IS NULL`));
      }
      return rows[0];
    });
  }
}
