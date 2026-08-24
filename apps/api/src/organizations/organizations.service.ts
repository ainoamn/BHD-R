import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, notInArray, sql } from 'drizzle-orm';
import { memberships, organizations, parties, partyRoles, sessions, users } from '@bhd-r/db';
import type { RoleKey, SessionClaims } from '@bhd-r/authz';
import { DatabaseService } from '../database/database.service.js';
import { AuthService } from '../auth/auth.service.js';

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

  async addRepresentative(
    claims: SessionClaims,
    input: { email: string; displayName: string; roleKey: RoleKey; partyId?: string | undefined },
  ): Promise<{ userId: string }> {
    return this.database.asSystem(async (transaction) => {
      const actorRank = Math.max(
        ...claims.roles.map(
          (role) =>
            (
              ({
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
              }) satisfies Record<RoleKey, number>
            )[role],
        ),
      );
      const targetRank = (
        {
          organization_owner: 50,
          organization_admin: 40,
          developer_admin: 40,
          property_manager: 30,
          finance_manager: 30,
          maintenance_agent: 20,
          auditor: 10,
          tenant: 0,
          platform_admin: 100,
          platform_support: 90,
        } satisfies Record<RoleKey, number>
      )[input.roleKey];
      if (
        targetRank > actorRank ||
        (['organization_owner', 'organization_admin', 'developer_admin'].includes(input.roleKey) &&
          !claims.roles.includes('organization_owner') &&
          !claims.roles.includes('platform_admin'))
      ) {
        throw new ForbiddenException('You cannot assign a role at or above this authority level');
      }
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${claims.organizationId!}, 7))`,
      );
      const organization = await transaction.query.organizations.findFirst({
        where: eq(organizations.id, claims.organizationId!),
      });
      if (!organization) throw new NotFoundException('Organization not found');
      const limits: Record<string, number> = {
        starter: 1,
        growth: 5,
        business: 15,
        enterprise: 100,
      };
      const limit = limits[organization.planKey] ?? 1;
      const memberCount = await transaction
        .select({ count: count() })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, claims.organizationId!),
            eq(memberships.status, 'active'),
            notInArray(memberships.roleKey, ['organization_owner', 'tenant']),
          ),
        );
      if ((memberCount[0]?.count ?? 0) >= limit)
        throw new ConflictException('Representative limit for this plan has been reached');
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
