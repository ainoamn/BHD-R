import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import {
  contractSignatures,
  contractTemplates,
  contracts,
  holds,
  leases,
  outboxEvents,
  parties,
  reservations,
  sessions,
  signatureChallenges,
  units,
} from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import type { CreateHoldInput, CreateLeaseInput } from '@bhd-r/contracts';
import { currencyMinorUnits, signatureEvidenceSchema } from '@bhd-r/contracts';
import { sanitizeRichText } from '@bhd-r/security';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';
import { AuthService } from '../auth/auth.service.js';

export function signingRoleForParty(
  contract: { ownerPartyId: string; tenantPartyId: string },
  partyId: string | null,
): 'owner' | 'tenant' {
  if (partyId === contract.ownerPartyId) return 'owner';
  if (partyId === contract.tenantPartyId) return 'tenant';
  throw new ForbiddenException('Signer is not a contract party');
}

@Injectable()
export class LeasingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authService: AuthService,
  ) {}

  createHold(claims: SessionClaims, input: CreateHoldInput) {
    return this.database.withinTenant(claims, async (transaction) => {
      await this.lockAndAssertAvailable(transaction, claims.organizationId!, input.unitId);
      if (input.prospectPartyId) {
        const prospect = await transaction.query.parties.findFirst({
          where: and(
            eq(parties.id, input.prospectPartyId),
            eq(parties.organizationId, claims.organizationId!),
          ),
        });
        if (!prospect) throw new NotFoundException('Prospect not found in this organization');
      }
      const rows = await transaction
        .insert(holds)
        .values({
          organizationId: claims.organizationId!,
          unitId: input.unitId,
          prospectPartyId: input.prospectPartyId,
          expiresAt: new Date(input.expiresAt),
          note: input.note,
        })
        .returning();
      return rows[0];
    });
  }

  createReservation(
    claims: SessionClaims,
    input: { unitId: string; tenantPartyId: string; expiresAt: string },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      await this.lockAndAssertAvailable(transaction, claims.organizationId!, input.unitId);
      const tenant = await transaction.query.parties.findFirst({
        where: and(
          eq(parties.id, input.tenantPartyId),
          eq(parties.organizationId, claims.organizationId!),
        ),
      });
      if (!tenant) throw new NotFoundException('Tenant not found in this organization');
      const rows = await transaction
        .insert(reservations)
        .values({
          organizationId: claims.organizationId!,
          unitId: input.unitId,
          tenantPartyId: input.tenantPartyId,
          expiresAt: new Date(input.expiresAt),
          status: 'confirmed',
        })
        .returning();
      return rows[0];
    });
  }

  createLeaseAndContract(
    claims: SessionClaims,
    input: CreateLeaseInput & { additionalTerms?: string | undefined },
  ) {
    return this.database.asSystem(async (transaction) => {
      await this.lockAndAssertAvailable(transaction, claims.organizationId!, input.unitId);
      const tenant = await transaction.query.parties.findFirst({
        where: and(
          eq(parties.id, input.tenantPartyId),
          eq(parties.organizationId, claims.organizationId!),
        ),
      });
      if (!tenant?.email)
        throw new ConflictException('Tenant requires an email address for account activation');
      const owner = await transaction.query.parties.findFirst({
        where: and(
          eq(parties.id, input.ownerPartyId),
          eq(parties.organizationId, claims.organizationId!),
        ),
      });
      if (!owner) throw new NotFoundException('Owner not found in this organization');
      const template = await transaction.query.contractTemplates.findFirst({
        where: and(
          eq(contractTemplates.id, input.templateVersionId),
          eq(contractTemplates.organizationId, claims.organizationId!),
        ),
      });
      if (!template)
        throw new NotFoundException('Contract template not found in this organization');
      const unit = await transaction.query.units.findFirst({
        where: and(eq(units.id, input.unitId), eq(units.organizationId, claims.organizationId!)),
      });
      if (!unit) throw new NotFoundException('Unit not found');
      if (
        input.rent.currency !== unit.currency ||
        (input.deposit && input.deposit.currency !== unit.currency)
      )
        throw new ConflictException('Lease currency mismatch');
      const payload = {
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        billingDay: input.billingDay,
        rent: input.rent,
        deposit: input.deposit,
        additionalTerms: input.additionalTerms ? sanitizeRichText(input.additionalTerms) : null,
      };
      const contractRows = await transaction
        .insert(contracts)
        .values({
          organizationId: claims.organizationId!,
          templateVersionId: input.templateVersionId,
          unitId: input.unitId,
          ownerPartyId: input.ownerPartyId,
          tenantPartyId: input.tenantPartyId,
          payloadSnapshot: payload,
        })
        .returning();
      const contract = contractRows[0]!;
      const leaseRows = await transaction
        .insert(leases)
        .values({
          organizationId: claims.organizationId!,
          contractId: contract.id,
          unitId: input.unitId,
          ownerPartyId: input.ownerPartyId,
          tenantPartyId: input.tenantPartyId,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          rentMinor: BigInt(input.rent.amountMinor),
          depositMinor: input.deposit ? BigInt(input.deposit.amountMinor) : null,
          currency: input.rent.currency,
          minorUnit: currencyMinorUnits[input.rent.currency],
          billingDay: input.billingDay,
        })
        .returning();
      const access = await this.authService.provisionTenantAccess(transaction, {
        organizationId: claims.organizationId!,
        partyId: tenant.id,
        displayName: tenant.displayName,
        email: tenant.email,
      });
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'lease.created',
        aggregateType: 'lease',
        aggregateId: leaseRows[0]!.id,
        payload: { contractId: contract.id, unitId: input.unitId },
      });
      return {
        contract,
        lease: {
          ...leaseRows[0],
          rentMinor: leaseRows[0]!.rentMinor.toString(),
          depositMinor: leaseRows[0]!.depositMinor?.toString() ?? null,
        },
        tenantAccess: access,
      };
    });
  }

  async sendContract(claims: SessionClaims, contractId: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .update(contracts)
        .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(contracts.id, contractId),
            eq(contracts.organizationId, claims.organizationId!),
            eq(contracts.status, 'draft'),
          ),
        )
        .returning();
      const contract = rows[0];
      if (!contract) throw new ConflictException('Only a draft contract can be sent');
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'contract.signature-requested',
        aggregateType: 'contract',
        aggregateId: contract.id,
        payload: { tenantPartyId: contract.tenantPartyId },
      });
      return contract;
    });
  }

  async createSignatureChallenge(
    claims: SessionClaims,
    contractId: string,
    authenticationMethod: 'oidc_reauthentication' | 'totp',
    totpCode?: string,
  ) {
    if (authenticationMethod === 'totp') {
      if (!totpCode) throw new ForbiddenException('TOTP code is required');
      await this.authService.verifyTotpChallenge(claims, totpCode);
    }
    return this.database.withinTenant(claims, async (transaction) => {
      const contract = await transaction.query.contracts.findFirst({
        where: and(
          eq(contracts.id, contractId),
          eq(contracts.organizationId, claims.organizationId!),
        ),
      });
      if (!contract || !['sent', 'partially_signed'].includes(contract.status))
        throw new ConflictException('Contract is not ready for signing');
      if (
        !claims.partyId ||
        ![contract.ownerPartyId, contract.tenantPartyId].includes(claims.partyId)
      )
        throw new ForbiddenException('Signer is not a contract party');
      if (authenticationMethod === 'oidc_reauthentication') {
        const session = await transaction.query.sessions.findFirst({
          where: and(
            eq(sessions.id, claims.sid),
            gt(sessions.createdAt, new Date(Date.now() - 10 * 60_000)),
            isNull(sessions.revokedAt),
          ),
        });
        if (!session) throw new ForbiddenException('Recent sign-in is required');
      }
      const rows = await transaction
        .insert(signatureChallenges)
        .values({
          organizationId: claims.organizationId!,
          contractId,
          userId: claims.sub,
          authenticationMethod,
          verifiedAt: new Date(),
          expiresAt: new Date(Date.now() + 5 * 60_000),
        })
        .returning();
      return { challengeId: rows[0]!.id, expiresAt: rows[0]!.expiresAt };
    });
  }

  signContract(
    claims: SessionClaims,
    contractId: string,
    input: { challengeId: string; consentTextVersion: string; ip: string; userAgent: string },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const contract = await transaction.query.contracts.findFirst({
        where: and(
          eq(contracts.id, contractId),
          eq(contracts.organizationId, claims.organizationId!),
        ),
      });
      if (!contract?.renderedPdfHash || !['sent', 'partially_signed'].includes(contract.status))
        throw new ConflictException('A rendered, sent contract is required');
      const signerPartyId = claims.partyId;
      if (!signerPartyId) throw new ForbiddenException('Signer is not a contract party');
      const signingRole = signingRoleForParty(contract, signerPartyId);
      const challengeRows = await transaction
        .update(signatureChallenges)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(signatureChallenges.id, input.challengeId),
            eq(signatureChallenges.contractId, contract.id),
            eq(signatureChallenges.userId, claims.sub),
            isNull(signatureChallenges.usedAt),
            gt(signatureChallenges.expiresAt, new Date()),
          ),
        )
        .returning();
      const challenge = challengeRows[0];
      if (!challenge)
        throw new ForbiddenException('Signature challenge is invalid, expired or already used');
      const signatureId = randomUUID();
      const signedAt = new Date();
      const evidence = signatureEvidenceSchema.parse({
        signatureId,
        contractId: contract.id,
        contractVersionId: contract.templateVersionId,
        signerPartyId,
        signerUserId: claims.sub,
        signingRole,
        authenticationMethod: challenge.authenticationMethod,
        sessionId: claims.sid,
        consentTextVersion: input.consentTextVersion,
        documentSha256: contract.renderedPdfHash,
        ipHash: createHash('sha256').update(input.ip).digest('hex'),
        userAgentHash: createHash('sha256').update(input.userAgent).digest('hex'),
        signedAt: signedAt.toISOString(),
        challengeId: challenge.id,
      });
      const signatureHash = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
      await transaction.insert(contractSignatures).values({
        id: signatureId,
        organizationId: claims.organizationId!,
        contractId: contract.id,
        signerPartyId,
        signerRole: signingRole,
        method: challenge.authenticationMethod,
        evidence,
        signatureHash,
        signedAt,
      });
      const signatures = await transaction
        .select({ partyId: contractSignatures.signerPartyId })
        .from(contractSignatures)
        .where(eq(contractSignatures.contractId, contract.id));
      const completed =
        new Set(signatures.map((row) => row.partyId)).has(contract.ownerPartyId) &&
        new Set(signatures.map((row) => row.partyId)).has(contract.tenantPartyId);
      await transaction
        .update(contracts)
        .set({
          status: completed ? 'signed' : 'partially_signed',
          completedAt: completed ? signedAt : null,
          updatedAt: signedAt,
        })
        .where(eq(contracts.id, contract.id));
      if (completed)
        await transaction
          .update(leases)
          .set({ status: 'active', updatedAt: signedAt })
          .where(eq(leases.contractId, contract.id));
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'contract.signed',
        aggregateType: 'contract',
        aggregateId: contract.id,
        payload: { signatureId, completed },
      });
      return { signatureId, signatureHash, completed };
    });
  }

  listTenantLeases(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select()
        .from(leases)
        .where(eq(leases.organizationId, claims.organizationId!));
      return rows.map((row) => ({
        ...row,
        rentMinor: row.rentMinor.toString(),
        depositMinor: row.depositMinor?.toString() ?? null,
      }));
    });
  }

  private async lockAndAssertAvailable(
    transaction: DatabaseTransaction,
    organizationId: string,
    unitId: string,
  ): Promise<void> {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${unitId}, 0))`);
    const unit = await transaction.query.units.findFirst({
      where: and(
        eq(units.id, unitId),
        eq(units.organizationId, organizationId),
        eq(units.status, 'active'),
      ),
    });
    if (!unit) throw new NotFoundException('Unit not found');
    const [activeHold, activeReservation, activeLease] = await Promise.all([
      transaction.query.holds.findFirst({
        where: and(
          eq(holds.unitId, unitId),
          eq(holds.status, 'active'),
          gt(holds.expiresAt, new Date()),
        ),
      }),
      transaction.query.reservations.findFirst({
        where: and(
          eq(reservations.unitId, unitId),
          inArray(reservations.status, ['pending', 'confirmed']),
          gt(reservations.expiresAt, new Date()),
        ),
      }),
      transaction.query.leases.findFirst({
        where: and(eq(leases.unitId, unitId), inArray(leases.status, ['draft', 'active'])),
      }),
    ]);
    if (activeHold || activeReservation || activeLease)
      throw new ConflictException('Unit is no longer available');
  }
}
