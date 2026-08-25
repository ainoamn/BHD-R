import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  approvalRequests,
  billingSchedules,
  contractSignatures,
  contractTemplates,
  contracts,
  cheques,
  holds,
  invoices,
  leases,
  legalCases,
  mediaAssets,
  maintenanceTickets,
  expenses,
  outboxEvents,
  parties,
  partyAddresses,
  partyIdentityDocuments,
  partyRoles,
  properties,
  reservations,
  reservationDocuments,
  reservationRequirements,
  sessions,
  signatureChallenges,
  units,
  workTasks,
  workflowEvents,
} from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import { hasPermission, type Permission } from '@bhd-r/authz';
import type { CreateHoldInput, CreateLeaseInput, CurrencyCode } from '@bhd-r/contracts';
import { currencyMinorUnits, signatureEvidenceSchema } from '@bhd-r/contracts';
import { sanitizeDocumentTemplate, sanitizeRichText } from '@bhd-r/security';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';
import { AuthService } from '../auth/auth.service.js';
import { FinanceService } from '../finance/finance.service.js';

export function signingRoleForParty(
  contract: { ownerPartyId: string; tenantPartyId: string },
  partyId: string | null,
): 'owner' | 'tenant' {
  if (partyId === contract.ownerPartyId) return 'owner';
  if (partyId === contract.tenantPartyId) return 'tenant';
  throw new ForbiddenException('Signer is not a contract party');
}

export function assertReservationRequirementsApproved(
  requirements: ReadonlyArray<{ status: string }>,
): void {
  if (
    requirements.length === 0 ||
    requirements.some((item) => !['approved', 'waived'].includes(item.status))
  ) {
    throw new ConflictException(
      'All required reservation documents must be approved before conversion',
    );
  }
}

const APPROVAL_CHAIN_STAGES = {
  accountant: [
    {
      type: 'contract_approval_accountant',
      subjectAr: 'اعتماد المحاسب للعقد والمبالغ',
      subjectEn: 'Accountant approval of contract amounts',
    },
  ],
  accountant_finance: [
    {
      type: 'contract_approval_accountant',
      subjectAr: 'اعتماد المحاسب للعقد والمبالغ',
      subjectEn: 'Accountant approval of contract amounts',
    },
    {
      type: 'contract_approval_finance',
      subjectAr: 'اعتماد المدير المالي',
      subjectEn: 'Finance manager approval',
    },
  ],
  accountant_finance_admin: [
    {
      type: 'contract_approval_accountant',
      subjectAr: 'اعتماد المحاسب للعقد والمبالغ',
      subjectEn: 'Accountant approval of contract amounts',
    },
    {
      type: 'contract_approval_finance',
      subjectAr: 'اعتماد المدير المالي',
      subjectEn: 'Finance manager approval',
    },
    {
      type: 'contract_approval_admin',
      subjectAr: 'اعتماد مسؤول الإدارة',
      subjectEn: 'Administration manager approval',
    },
  ],
} as const;

type ApprovalChainKey = keyof typeof APPROVAL_CHAIN_STAGES;

function isTenantFacingClaims(claims: SessionClaims): boolean {
  const staffRoles = new Set([
    'organization_owner',
    'organization_admin',
    'property_manager',
    'finance_manager',
    'maintenance_agent',
    'auditor',
    'platform_admin',
    'platform_support',
    'developer_admin',
  ]);
  return (
    Boolean(claims.partyId) &&
    claims.roles.includes('tenant') &&
    !claims.roles.some((role) => staffRoles.has(role))
  );
}

export function assertRenewalTerms(
  current: { endsOn: string; currency: string },
  proposed: { endsOn: string; currency?: string | undefined },
): void {
  if (proposed.endsOn <= current.endsOn)
    throw new ConflictException('Renewal date must extend the current lease');
  if (proposed.currency && proposed.currency !== current.currency)
    throw new ConflictException('Renewal currency must match the lease currency');
}

export type LeaseLifecycleAction =
  | 'activate'
  | 'end'
  | 'terminate'
  | 'request_cancellation'
  | 'approve_cancellation'
  | 'clear_cancellation'
  | 'confirm_renewal'
  | 'waive_renewal_gate';

export function permissionForLeaseAction(action: LeaseLifecycleAction): Permission {
  switch (action) {
    case 'request_cancellation':
      return 'lease.cancel.request';
    case 'approve_cancellation':
      return 'lease.cancel.approve';
    case 'clear_cancellation':
      return 'lease.cancel.clear';
    case 'confirm_renewal':
      return 'lease.renew.confirm';
    case 'waive_renewal_gate':
      return 'lease.renew.waive';
    default:
      return 'lease.update';
  }
}

export function assertLeaseActionPermission(
  claims: SessionClaims,
  action: LeaseLifecycleAction,
): void {
  const needed = permissionForLeaseAction(action);
  if (hasPermission(claims, needed)) return;
  if (needed !== 'lease.update' && hasPermission(claims, 'lease.update')) return;
  throw new ForbiddenException(`Missing permission for lease action: ${action}`);
}

export function assertDepositClearanceNote(
  depositMinor: bigint | null | undefined,
  note: string | undefined,
): void {
  if (depositMinor && depositMinor > 0n && !note?.trim()) {
    throw new ConflictException(
      'Accountant clearance requires a note confirming deposit/settlement when a security deposit exists',
    );
  }
}

@Injectable()
export class LeasingService {
  readonly #s3 = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    ...(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_KEY,
          },
        }
      : {}),
  });

  constructor(
    private readonly database: DatabaseService,
    private readonly authService: AuthService,
    private readonly financeService: FinanceService,
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
      await this.assertAddressBookReadyForReservation(
        transaction,
        claims.organizationId!,
        tenant.id,
      );
      const unit = await transaction.query.units.findFirst({
        where: and(eq(units.id, input.unitId), eq(units.organizationId, claims.organizationId!)),
      });
      if (!unit) throw new NotFoundException('Unit not found');
      // OM parity: reservation starts pending until accountant confirms deposit.
      const rows = await transaction
        .insert(reservations)
        .values({
          organizationId: claims.organizationId!,
          unitId: input.unitId,
          tenantPartyId: input.tenantPartyId,
          expiresAt: new Date(input.expiresAt),
          status: 'pending',
          rentMinor: unit.rentMinor,
          currency: unit.currency,
          termsSnapshot: {
            listingPurpose: unit.listingPurpose,
            depositMinor: unit.depositMinor?.toString() ?? null,
            rentMinor: unit.rentMinor?.toString() ?? null,
            currency: unit.currency,
            capturedAt: new Date().toISOString(),
            awaitingAccountantDeposit: true,
          },
        })
        .returning();
      await transaction.insert(reservationRequirements).values([
        {
          organizationId: claims.organizationId!,
          reservationId: rows[0]!.id,
          code: 'deposit_receipt',
          labelAr: 'تأكيد استلام مبلغ الضمان',
          labelEn: 'Security deposit receipt confirmation',
          required: true,
          dueAt: new Date(input.expiresAt),
        },
        {
          organizationId: claims.organizationId!,
          reservationId: rows[0]!.id,
          code: 'identity_document',
          labelAr: 'إثبات الهوية',
          labelEn: 'Identity document',
          required: true,
          dueAt: new Date(input.expiresAt),
        },
        {
          organizationId: claims.organizationId!,
          reservationId: rows[0]!.id,
          code: 'proof_of_address',
          labelAr: 'إثبات العنوان',
          labelEn: 'Proof of address',
          required: true,
          dueAt: new Date(input.expiresAt),
        },
      ]);
      await transaction.insert(workflowEvents).values({
        organizationId: claims.organizationId!,
        actorUserId: claims.sub,
        resourceType: 'reservation',
        resourceId: rows[0]!.id,
        eventType: 'reservation.created',
        toStatus: 'pending',
        note: 'Awaiting accountant deposit confirmation',
      });
      return rows[0];
    });
  }

  createLeaseAndContract(
    claims: SessionClaims,
    input: CreateLeaseInput & {
      additionalTerms?: string | undefined;
      reservationId?: string | undefined;
    },
  ) {
    return this.database.asSystem(async (transaction) => {
      await this.lockAndAssertAvailable(
        transaction,
        claims.organizationId!,
        input.unitId,
        input.reservationId,
      );
      if (input.reservationId) {
        const reservation = await transaction.query.reservations.findFirst({
          where: and(
            eq(reservations.id, input.reservationId),
            eq(reservations.organizationId, claims.organizationId!),
          ),
        });
        if (!reservation) throw new NotFoundException('Reservation not found');
        if (reservation.status !== 'confirmed') {
          throw new ConflictException(
            'Accountant must confirm the reservation deposit before creating a lease',
          );
        }
        const requiredRequirements = await transaction
          .select({ status: reservationRequirements.status })
          .from(reservationRequirements)
          .where(
            and(
              eq(reservationRequirements.organizationId, claims.organizationId!),
              eq(reservationRequirements.reservationId, input.reservationId),
              eq(reservationRequirements.required, true),
            ),
          );
        assertReservationRequirementsApproved(requiredRequirements);
      }
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
      const property = await transaction.query.properties.findFirst({
        where: and(
          eq(properties.id, unit.propertyId),
          eq(properties.organizationId, claims.organizationId!),
        ),
      });
      if (!property) throw new NotFoundException('Property not found');
      if (
        input.rent.currency !== unit.currency ||
        (input.deposit && input.deposit.currency !== unit.currency)
      )
        throw new ConflictException('Lease currency mismatch');
      const graceDays = input.graceDays ?? 0;
      const approvalChain = (input.approvalChain ?? 'accountant') as ApprovalChainKey;
      const stages = APPROVAL_CHAIN_STAGES[approvalChain];
      const otherCharges = input.otherCharges ?? [];
      const chequeInputs = input.cheques ?? [];
      for (const charge of otherCharges) {
        if (charge.amount.currency !== input.rent.currency)
          throw new ConflictException('Other charge currency mismatch');
      }
      for (const cheque of chequeInputs) {
        if (cheque.amount.currency !== input.rent.currency)
          throw new ConflictException('Cheque currency mismatch');
      }
      if (input.graceAmount && input.graceAmount.currency !== input.rent.currency)
        throw new ConflictException('Grace amount currency mismatch');
      const contractYear = Number(input.startsOn.slice(0, 4));
      const sequence = await transaction.execute(sql<{ allocated: bigint }>`
        insert into contract_sequences (organization_id, year, next_value)
        values (${claims.organizationId!}, ${contractYear}, 2)
        on conflict (organization_id, year)
        do update set next_value = contract_sequences.next_value + 1
        returning next_value - 1 as allocated
      `);
      const allocated = BigInt(String(sequence[0]!.allocated));
      const contractReference = `CTR-${contractYear}-${allocated.toString().padStart(6, '0')}`;
      const payload = {
        contract: { reference: contractReference },
        owner: { id: owner.id, displayName: owner.displayName },
        tenant: { id: tenant.id, displayName: tenant.displayName },
        property: {
          id: property.id,
          nameAr: property.nameAr,
          nameEn: property.nameEn,
        },
        unit: {
          id: unit.id,
          code: unit.code,
          nameAr: unit.nameAr,
          nameEn: unit.nameEn,
        },
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        billingDay: input.billingDay,
        rent: input.rent,
        deposit: input.deposit,
        graceDays,
        graceAmount: input.graceAmount ?? null,
        handoverOn: input.handoverOn ?? null,
        otherCharges,
        cheques: chequeInputs,
        approvalChain,
        approvalStages: stages.map((stage) => stage.type),
        lifecycleStatus: 'in_progress',
        additionalTerms: input.additionalTerms ? sanitizeRichText(input.additionalTerms) : null,
      };
      const contractRows = await transaction
        .insert(contracts)
        .values({
          organizationId: claims.organizationId!,
          reference: contractReference,
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
      await transaction.insert(billingSchedules).values({
        organizationId: claims.organizationId!,
        leaseId: leaseRows[0]!.id,
        billingDay: input.billingDay,
        dueDays: graceDays,
        descriptionAr: `إيجار الوحدة ${unit.code}`,
        descriptionEn: `Rent for unit ${unit.code}`,
        nextIssueOn: input.startsOn,
      });
      for (const [index, stage] of stages.entries()) {
        await transaction.insert(approvalRequests).values({
          organizationId: claims.organizationId!,
          reference: `APR-${contractReference}-${index + 1}`,
          type: stage.type,
          subject: `${stage.subjectEn} · ${contractReference}`,
          resourceType: 'contract',
          resourceId: contract.id,
          requestedByUserId: claims.sub,
          status: index === 0 ? 'pending' : 'on_hold',
        });
      }
      if (chequeInputs.length) {
        await transaction.insert(cheques).values(
          chequeInputs.map((cheque) => ({
            organizationId: claims.organizationId!,
            leaseId: leaseRows[0]!.id,
            reservationId: input.reservationId,
            ownerPartyId: input.tenantPartyId,
            bankName: cheque.bankName,
            chequeNumber: cheque.chequeNumber,
            amountMinor: BigInt(cheque.amount.amountMinor),
            currency: cheque.amount.currency,
            dueOn: cheque.dueOn,
          })),
        );
      }
      const access = await this.authService.provisionTenantAccess(transaction, {
        organizationId: claims.organizationId!,
        partyId: tenant.id,
        displayName: tenant.displayName,
        email: tenant.email,
      });
      if (input.reservationId) {
        const reservationRows = await transaction
          .update(reservations)
          .set({
            status: 'converted',
            convertedLeaseId: leaseRows[0]!.id,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(reservations.id, input.reservationId),
              eq(reservations.organizationId, claims.organizationId!),
              eq(reservations.unitId, input.unitId),
              inArray(reservations.status, ['pending', 'confirmed']),
            ),
          )
          .returning({ id: reservations.id });
        if (!reservationRows[0])
          throw new ConflictException('Reservation cannot be converted to this lease');
      }
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'lease.created',
        aggregateType: 'lease',
        aggregateId: leaseRows[0]!.id,
        payload: {
          contractId: contract.id,
          unitId: input.unitId,
          contractReference,
          approvalChain,
          chequeCount: chequeInputs.length,
        },
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

  createRenewalContract(
    claims: SessionClaims,
    leaseId: string,
    input: {
      templateVersionId: string;
      endsOn: string;
      rent?: { amountMinor: string; currency: string } | undefined;
      additionalTerms?: string | undefined;
      cheques?: ReadonlyArray<{
        bankName: string;
        chequeNumber: string;
        amount: { amountMinor: string; currency: string };
        dueOn: string;
      }>;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${leaseId}, 19))`,
      );
      const lease = await transaction.query.leases.findFirst({
        where: and(eq(leases.id, leaseId), eq(leases.organizationId, claims.organizationId!)),
      });
      if (!lease || lease.status !== 'active' || !lease.contractId)
        throw new ConflictException('Only an active lease with a signed contract can be renewed');
      assertRenewalTerms(lease, { endsOn: input.endsOn, currency: input.rent?.currency });
      const [parentContract, template, owner, tenant, unit] = await Promise.all([
        transaction.query.contracts.findFirst({
          where: and(
            eq(contracts.id, lease.contractId),
            eq(contracts.organizationId, claims.organizationId!),
            eq(contracts.status, 'signed'),
          ),
        }),
        transaction.query.contractTemplates.findFirst({
          where: and(
            eq(contractTemplates.id, input.templateVersionId),
            eq(contractTemplates.organizationId, claims.organizationId!),
          ),
        }),
        transaction.query.parties.findFirst({ where: eq(parties.id, lease.ownerPartyId) }),
        transaction.query.parties.findFirst({ where: eq(parties.id, lease.tenantPartyId) }),
        transaction.query.units.findFirst({ where: eq(units.id, lease.unitId) }),
      ]);
      if (!parentContract) throw new ConflictException('The original signed contract is required');
      if (!template) throw new NotFoundException('Contract template not found');
      if (!owner || !tenant || !unit)
        throw new ConflictException('Lease parties or unit are missing');
      const pendingRenewal = await transaction.query.contracts.findFirst({
        where: and(
          eq(contracts.organizationId, claims.organizationId!),
          eq(contracts.parentContractId, parentContract.id),
          eq(contracts.kind, 'renewal'),
          inArray(contracts.status, ['draft', 'sent', 'partially_signed']),
        ),
      });
      if (pendingRenewal)
        throw new ConflictException('An unfinished renewal already exists for this lease');
      const property = await transaction.query.properties.findFirst({
        where: and(
          eq(properties.id, unit.propertyId),
          eq(properties.organizationId, claims.organizationId!),
        ),
      });
      if (!property) throw new NotFoundException('Property not found');
      const effectiveDate = new Date(`${lease.endsOn}T00:00:00.000Z`);
      effectiveDate.setUTCDate(effectiveDate.getUTCDate() + 1);
      const startsOn = effectiveDate.toISOString().slice(0, 10);
      const contractYear = Number(startsOn.slice(0, 4));
      const sequence = await transaction.execute(sql<{ allocated: bigint }>`
        insert into contract_sequences (organization_id, year, next_value)
        values (${claims.organizationId!}, ${contractYear}, 2)
        on conflict (organization_id, year)
        do update set next_value = contract_sequences.next_value + 1
        returning next_value - 1 as allocated
      `);
      const allocated = BigInt(String(sequence[0]!.allocated));
      const contractReference = `CTR-${contractYear}-${allocated.toString().padStart(6, '0')}`;
      const rentMinor = input.rent?.amountMinor ?? lease.rentMinor.toString();
      const payload = {
        contract: {
          reference: contractReference,
          kind: 'renewal',
          parentReference: parentContract.reference,
        },
        owner: { id: owner.id, displayName: owner.displayName },
        tenant: { id: tenant.id, displayName: tenant.displayName },
        property: { id: property.id, nameAr: property.nameAr, nameEn: property.nameEn },
        unit: { id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn },
        startsOn,
        endsOn: input.endsOn,
        billingDay: lease.billingDay,
        rent: { amountMinor: rentMinor, currency: lease.currency },
        previous: { endsOn: lease.endsOn, rentMinor: lease.rentMinor.toString() },
        additionalTerms: input.additionalTerms ? sanitizeRichText(input.additionalTerms) : null,
      };
      const contractRows = await transaction
        .insert(contracts)
        .values({
          organizationId: claims.organizationId!,
          reference: contractReference,
          kind: 'renewal',
          parentContractId: parentContract.id,
          templateVersionId: input.templateVersionId,
          unitId: lease.unitId,
          ownerPartyId: lease.ownerPartyId,
          tenantPartyId: lease.tenantPartyId,
          payloadSnapshot: payload,
        })
        .returning();
      const contract = contractRows[0]!;
      await transaction.insert(approvalRequests).values({
        organizationId: claims.organizationId!,
        reference: `APR-${contractReference}`,
        type: 'contract_approval',
        subject: `Renewal ${contractReference}`,
        resourceType: 'contract',
        resourceId: contract.id,
        requestedByUserId: claims.sub,
      });
      await transaction.insert(workflowEvents).values({
        organizationId: claims.organizationId!,
        actorUserId: claims.sub,
        resourceType: 'lease',
        resourceId: lease.id,
        eventType: 'lease.renewal_requested',
        fromStatus: lease.status,
        toStatus: lease.status,
        metadata: {
          contractId: contract.id,
          previousEndsOn: lease.endsOn,
          proposedEndsOn: input.endsOn,
          previousRentMinor: lease.rentMinor.toString(),
          proposedRentMinor: rentMinor,
          currency: lease.currency,
          chequeCount: input.cheques?.length ?? 0,
        },
      });
      const chequeInputs = input.cheques ?? [];
      if (chequeInputs.length) {
        await transaction.insert(cheques).values(
          chequeInputs.map((cheque) => ({
            organizationId: claims.organizationId!,
            leaseId: lease.id,
            ownerPartyId: lease.tenantPartyId,
            bankName: cheque.bankName,
            chequeNumber: cheque.chequeNumber,
            amountMinor: BigInt(cheque.amount.amountMinor),
            currency: cheque.amount.currency,
            dueOn: cheque.dueOn,
          })),
        );
      }
      return {
        contract,
        leaseId: lease.id,
        proposedStartsOn: startsOn,
        chequeCount: chequeInputs.length,
      };
    });
  }

  listContractTemplates(claims: SessionClaims, includeInactive = false) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select({
          id: contractTemplates.id,
          key: contractTemplates.key,
          version: contractTemplates.version,
          language: contractTemplates.language,
          active: contractTemplates.active,
          contentHash: contractTemplates.contentHash,
          createdAt: contractTemplates.createdAt,
        })
        .from(contractTemplates)
        .where(
          and(
            eq(contractTemplates.organizationId, claims.organizationId!),
            ...(includeInactive ? [] : [eq(contractTemplates.active, true)]),
          ),
        )
        .orderBy(desc(contractTemplates.createdAt)),
    );
  }

  createContractTemplate(
    claims: SessionClaims,
    input: { key: string; language: 'ar' | 'en'; html: string; active: boolean },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${claims.organizationId}:${input.key}:${input.language}`}, 11))`,
      );
      const html = sanitizeDocumentTemplate(input.html);
      if (html.replace(/<[^>]+>/g, '').trim().length < 20) {
        throw new ConflictException('Contract template content is too short after sanitization');
      }
      const versions = await transaction.execute(sql<{ version: number }>`
        select coalesce(max(version), 0)::integer + 1 as version
        from contract_templates
        where organization_id = ${claims.organizationId!}
          and key = ${input.key}
          and language = ${input.language}
      `);
      if (input.active) {
        await transaction
          .update(contractTemplates)
          .set({ active: false, updatedAt: new Date() })
          .where(
            and(
              eq(contractTemplates.organizationId, claims.organizationId!),
              eq(contractTemplates.key, input.key),
              eq(contractTemplates.language, input.language),
              eq(contractTemplates.active, true),
            ),
          );
      }
      const rows = await transaction
        .insert(contractTemplates)
        .values({
          organizationId: claims.organizationId!,
          key: input.key,
          version: Number(versions[0]!.version),
          language: input.language,
          html,
          contentHash: createHash('sha256').update(html).digest('hex'),
          active: input.active,
        })
        .returning({
          id: contractTemplates.id,
          key: contractTemplates.key,
          version: contractTemplates.version,
          language: contractTemplates.language,
          active: contractTemplates.active,
          contentHash: contractTemplates.contentHash,
        });
      return rows[0]!;
    });
  }

  requestContractApproval(claims: SessionClaims, contractId: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const contract = await transaction.query.contracts.findFirst({
        where: and(
          eq(contracts.id, contractId),
          eq(contracts.organizationId, claims.organizationId!),
          eq(contracts.status, 'draft'),
        ),
      });
      if (!contract) throw new ConflictException('Only a draft contract can request approval');
      const existing = await transaction.query.approvalRequests.findFirst({
        where: and(
          eq(approvalRequests.organizationId, claims.organizationId!),
          eq(approvalRequests.resourceType, 'contract'),
          eq(approvalRequests.resourceId, contractId),
          inArray(approvalRequests.status, ['pending', 'approved']),
        ),
        orderBy: desc(approvalRequests.createdAt),
      });
      if (existing) return existing;
      const rows = await transaction
        .insert(approvalRequests)
        .values({
          organizationId: claims.organizationId!,
          reference: `APR-${contract.reference ?? contract.id.slice(0, 18)}-${randomUUID().slice(0, 6).toUpperCase()}`,
          type: 'contract_approval',
          subject: `Contract ${contract.reference ?? contract.id}`,
          resourceType: 'contract',
          resourceId: contract.id,
          requestedByUserId: claims.sub,
        })
        .returning();
      return rows[0]!;
    });
  }

  async contractDetail(claims: SessionClaims, contractId: string) {
    const detail = await this.database.withinTenant(claims, async (transaction) => {
      const contract = await transaction.query.contracts.findFirst({
        where: and(
          eq(contracts.id, contractId),
          eq(contracts.organizationId, claims.organizationId!),
        ),
      });
      if (!contract) throw new NotFoundException('Contract not found');
      const linkedContractId =
        contract.kind === 'renewal' ? contract.parentContractId : contract.id;
      const [lease, owner, tenant, unit, signatures, approval] = await Promise.all([
        linkedContractId
          ? transaction.query.leases.findFirst({ where: eq(leases.contractId, linkedContractId) })
          : Promise.resolve(undefined),
        transaction.query.parties.findFirst({ where: eq(parties.id, contract.ownerPartyId) }),
        transaction.query.parties.findFirst({ where: eq(parties.id, contract.tenantPartyId) }),
        transaction.query.units.findFirst({ where: eq(units.id, contract.unitId) }),
        transaction
          .select({
            id: contractSignatures.id,
            signerPartyId: contractSignatures.signerPartyId,
            signerRole: contractSignatures.signerRole,
            method: contractSignatures.method,
            signatureHash: contractSignatures.signatureHash,
            signedAt: contractSignatures.signedAt,
          })
          .from(contractSignatures)
          .where(eq(contractSignatures.contractId, contract.id)),
        transaction.query.approvalRequests.findFirst({
          where: and(
            eq(approvalRequests.resourceType, 'contract'),
            eq(approvalRequests.resourceId, contract.id),
          ),
          orderBy: desc(approvalRequests.createdAt),
        }),
      ]);
      const property = unit
        ? await transaction.query.properties.findFirst({
            where: eq(properties.id, unit.propertyId),
          })
        : null;
      const signerPartyId = claims.partyId;
      const snapshot = contract.payloadSnapshot as Record<string, unknown>;
      return {
        id: contract.id,
        reference: contract.reference ?? `CTR-${contract.id.slice(0, 8).toUpperCase()}`,
        kind: contract.kind,
        parentContractId: contract.parentContractId,
        status: contract.status,
        startsOn:
          typeof snapshot.startsOn === 'string' ? snapshot.startsOn : (lease?.startsOn ?? ''),
        endsOn: typeof snapshot.endsOn === 'string' ? snapshot.endsOn : (lease?.endsOn ?? ''),
        sentAt: contract.sentAt,
        completedAt: contract.completedAt,
        renderedPdfObjectKey: contract.renderedPdfObjectKey,
        documentHash: contract.renderedPdfHash,
        approval: approval
          ? {
              id: approval.id,
              reference: approval.reference,
              status: approval.status,
              decisionNote: approval.decisionNote,
              decidedAt: approval.decidedAt,
            }
          : null,
        parties: {
          owner: owner ? { id: owner.id, displayName: owner.displayName } : null,
          tenant: tenant ? { id: tenant.id, displayName: tenant.displayName } : null,
        },
        property: property
          ? { id: property.id, nameAr: property.nameAr, nameEn: property.nameEn }
          : null,
        unit: unit
          ? { id: unit.id, code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn }
          : null,
        signatures,
        canSign:
          Boolean(signerPartyId) &&
          [contract.ownerPartyId, contract.tenantPartyId].includes(signerPartyId!) &&
          Boolean(contract.renderedPdfHash) &&
          ['sent', 'partially_signed'].includes(contract.status) &&
          !signatures.some((signature) => signature.signerPartyId === signerPartyId),
      };
    });
    const documentUrl = detail.renderedPdfObjectKey
      ? await getSignedUrl(
          this.#s3,
          new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_PRIVATE ?? 'bhd-r-private',
            Key: detail.renderedPdfObjectKey,
            ResponseContentDisposition: `inline; filename="${detail.reference}.pdf"`,
          }),
          { expiresIn: 180 },
        )
      : null;
    const { renderedPdfObjectKey, ...safe } = detail;
    void renderedPdfObjectKey;
    return { ...safe, documentUrl, documentUrlExpiresInSeconds: documentUrl ? 180 : null };
  }

  async sendContract(claims: SessionClaims, contractId: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const contract = await transaction.query.contracts.findFirst({
        where: and(
          eq(contracts.id, contractId),
          eq(contracts.organizationId, claims.organizationId!),
        ),
      });
      if (!contract) throw new NotFoundException('Contract not found');
      const snapshot = (contract.payloadSnapshot ?? {}) as {
        approvalStages?: string[];
      };
      const requiredTypes =
        snapshot.approvalStages?.length && snapshot.approvalStages.length > 0
          ? snapshot.approvalStages
          : ['contract_approval', 'contract_approval_accountant'];
      const approvals = await transaction
        .select({
          type: approvalRequests.type,
          status: approvalRequests.status,
        })
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.organizationId, claims.organizationId!),
            eq(approvalRequests.resourceType, 'contract'),
            eq(approvalRequests.resourceId, contractId),
          ),
        );
      for (const type of requiredTypes) {
        const row = approvals.find((item) => item.type === type);
        if (!row || row.status !== 'approved') {
          throw new ConflictException(
            `Contract approval stage "${type}" must be approved before sending for e-signature`,
          );
        }
      }
      const lease = await transaction.query.leases.findFirst({
        where: and(
          eq(leases.contractId, contractId),
          eq(leases.organizationId, claims.organizationId!),
        ),
      });
      if (lease) {
        const pendingCheques = await transaction
          .select({ id: cheques.id, reviewStatus: cheques.reviewStatus })
          .from(cheques)
          .where(
            and(eq(cheques.organizationId, claims.organizationId!), eq(cheques.leaseId, lease.id)),
          );
        const blocked = pendingCheques.filter(
          (row) => !['accepted', 'deposited', 'cleared'].includes(row.reviewStatus),
        );
        if (blocked.length) {
          throw new ConflictException(
            'Accountant must accept all contract cheques before sending for e-signature',
          );
        }
      }
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
      const sent = rows[0];
      if (!sent) throw new ConflictException('Only a draft contract can be sent');
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'contract.signature-requested',
        aggregateType: 'contract',
        aggregateId: sent.id,
        payload: { tenantPartyId: sent.tenantPartyId },
      });
      return sent;
    });
  }

  async createSignatureChallenge(
    claims: SessionClaims,
    contractId: string,
    authenticationMethod: 'recent_sign_in' | 'oidc_reauthentication' | 'totp',
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
      if (
        authenticationMethod === 'recent_sign_in' ||
        authenticationMethod === 'oidc_reauthentication'
      ) {
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
      if (completed && contract.kind === 'renewal') {
        if (!contract.parentContractId)
          throw new ConflictException('Renewal is missing its original contract reference');
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${contract.parentContractId}, 23))`,
        );
        const currentLease = await transaction.query.leases.findFirst({
          where: and(
            eq(leases.contractId, contract.parentContractId),
            eq(leases.organizationId, claims.organizationId!),
          ),
        });
        if (!currentLease || currentLease.status !== 'active')
          throw new ConflictException('The active lease for this renewal was not found');
        const snapshot = contract.payloadSnapshot as Record<string, unknown>;
        const proposedEndsOn =
          typeof snapshot.endsOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.endsOn)
            ? snapshot.endsOn
            : null;
        const proposedRent =
          snapshot.rent && typeof snapshot.rent === 'object'
            ? (snapshot.rent as Record<string, unknown>)
            : null;
        const proposedRentMinor =
          typeof proposedRent?.amountMinor === 'string' && /^\d+$/.test(proposedRent.amountMinor)
            ? proposedRent.amountMinor
            : null;
        const proposedCurrency =
          typeof proposedRent?.currency === 'string' ? proposedRent.currency : null;
        if (
          !proposedEndsOn ||
          proposedEndsOn <= currentLease.endsOn ||
          !proposedRentMinor ||
          proposedCurrency !== currentLease.currency
        )
          throw new ConflictException('The signed renewal terms are no longer valid');
        // Cycle v1.1 R3: hold terms until accountant confirms (or manager waives).
        await transaction
          .update(leases)
          .set({
            renewalPendingContractId: contract.id,
            renewalPendingEndsOn: proposedEndsOn,
            renewalPendingRentMinor: BigInt(proposedRentMinor),
            updatedAt: signedAt,
          })
          .where(eq(leases.id, currentLease.id));
        await transaction.insert(workflowEvents).values({
          organizationId: claims.organizationId!,
          actorUserId: claims.sub,
          resourceType: 'lease',
          resourceId: currentLease.id,
          eventType: 'lease.renewal_pending_clearance',
          fromStatus: currentLease.status,
          toStatus: currentLease.status,
          metadata: {
            renewalContractId: contract.id,
            previousEndsOn: currentLease.endsOn,
            nextEndsOn: proposedEndsOn,
            previousRentMinor: currentLease.rentMinor.toString(),
            nextRentMinor: proposedRentMinor,
            currency: currentLease.currency,
          },
        });
      } else if (completed) {
        await Promise.all([
          transaction
            .update(leases)
            .set({ status: 'active', updatedAt: signedAt })
            .where(eq(leases.contractId, contract.id)),
          transaction
            .update(billingSchedules)
            .set({ status: 'active', updatedAt: signedAt })
            .where(
              sql`${billingSchedules.leaseId} IN (SELECT id FROM leases WHERE contract_id = ${contract.id})`,
            ),
        ]);
      }
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'contract.signed',
        aggregateType: 'contract',
        aggregateId: contract.id,
        payload: { signatureId, completed, kind: contract.kind },
      });
      return { signatureId, signatureHash, completed };
    });
  }

  listTenantLeases(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const scopedToTenant = isTenantFacingClaims(claims);
      const rows = await transaction
        .select()
        .from(leases)
        .where(
          and(
            eq(leases.organizationId, claims.organizationId!),
            ...(scopedToTenant && claims.partyId
              ? [eq(leases.tenantPartyId, claims.partyId)]
              : []),
          ),
        )
        .orderBy(desc(leases.createdAt));
      return rows.map((row) => ({
        ...row,
        rentMinor: row.rentMinor.toString(),
        depositMinor: row.depositMinor?.toString() ?? null,
        renewalPendingRentMinor: row.renewalPendingRentMinor?.toString() ?? null,
      }));
    });
  }

  listHolds(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction.select().from(holds).where(eq(holds.organizationId, claims.organizationId!)),
    );
  }

  listReservations(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(reservations)
        .where(eq(reservations.organizationId, claims.organizationId!)),
    );
  }

  reservationCompliance(claims: SessionClaims, reservationId: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const reservation = await transaction.query.reservations.findFirst({
        where: and(
          eq(reservations.id, reservationId),
          eq(reservations.organizationId, claims.organizationId!),
        ),
      });
      if (!reservation) throw new NotFoundException('Reservation not found');
      const [requirements, documents] = await Promise.all([
        transaction
          .select()
          .from(reservationRequirements)
          .where(
            and(
              eq(reservationRequirements.organizationId, claims.organizationId!),
              eq(reservationRequirements.reservationId, reservationId),
            ),
          )
          .orderBy(reservationRequirements.createdAt),
        transaction
          .select({
            id: reservationDocuments.id,
            requirementId: reservationDocuments.requirementId,
            mediaAssetId: reservationDocuments.mediaAssetId,
            documentType: reservationDocuments.documentType,
            status: reservationDocuments.status,
            reviewNotes: reservationDocuments.reviewNotes,
            reviewedAt: reservationDocuments.reviewedAt,
            submittedAt: reservationDocuments.createdAt,
            mimeType: mediaAssets.mimeType,
            processingStatus: mediaAssets.processingStatus,
            scanStatus: mediaAssets.scanStatus,
          })
          .from(reservationDocuments)
          .innerJoin(mediaAssets, eq(mediaAssets.id, reservationDocuments.mediaAssetId))
          .where(
            and(
              eq(reservationDocuments.organizationId, claims.organizationId!),
              eq(reservationDocuments.reservationId, reservationId),
            ),
          )
          .orderBy(desc(reservationDocuments.createdAt)),
      ]);
      return { reservation, requirements, documents };
    });
  }

  addReservationRequirement(
    claims: SessionClaims,
    reservationId: string,
    input: {
      code: string;
      labelAr: string;
      labelEn: string;
      required: boolean;
      dueAt?: string | undefined;
      notes?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const reservation = await transaction.query.reservations.findFirst({
        where: and(
          eq(reservations.id, reservationId),
          eq(reservations.organizationId, claims.organizationId!),
        ),
      });
      if (!reservation || !['pending', 'confirmed'].includes(reservation.status))
        throw new ConflictException('Reservation is not open for requirements');
      const rows = await transaction
        .insert(reservationRequirements)
        .values({
          organizationId: claims.organizationId!,
          reservationId,
          ...input,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
        })
        .returning();
      return rows[0]!;
    });
  }

  submitReservationDocument(
    claims: SessionClaims,
    reservationId: string,
    input: {
      requirementId?: string | undefined;
      mediaAssetId: string;
      documentType: string;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const reservation = await transaction.query.reservations.findFirst({
        where: and(
          eq(reservations.id, reservationId),
          eq(reservations.organizationId, claims.organizationId!),
        ),
      });
      if (!reservation || !['pending', 'confirmed'].includes(reservation.status))
        throw new ConflictException('Reservation is not open for documents');
      const asset = await transaction.query.mediaAssets.findFirst({
        where: and(
          eq(mediaAssets.id, input.mediaAssetId),
          eq(mediaAssets.organizationId, claims.organizationId!),
        ),
      });
      const metadata = asset?.metadata as Record<string, unknown> | undefined;
      if (
        !asset ||
        metadata?.purpose !== 'reservation_document' ||
        metadata.reservationId !== reservationId
      )
        throw new ConflictException('Media asset does not belong to this reservation');
      if (input.requirementId) {
        const requirement = await transaction.query.reservationRequirements.findFirst({
          where: and(
            eq(reservationRequirements.id, input.requirementId),
            eq(reservationRequirements.reservationId, reservationId),
            eq(reservationRequirements.organizationId, claims.organizationId!),
          ),
        });
        if (!requirement) throw new NotFoundException('Reservation requirement not found');
      }
      const rows = await transaction
        .insert(reservationDocuments)
        .values({
          organizationId: claims.organizationId!,
          reservationId,
          requirementId: input.requirementId,
          mediaAssetId: input.mediaAssetId,
          documentType: input.documentType,
          submittedByUserId: claims.sub,
        })
        .returning();
      if (input.requirementId) {
        await transaction
          .update(reservationRequirements)
          .set({ status: 'submitted', updatedAt: new Date() })
          .where(eq(reservationRequirements.id, input.requirementId));
      }
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'reservation.document-submitted',
        aggregateType: 'reservation_document',
        aggregateId: rows[0]!.id,
        payload: { reservationId, requirementId: input.requirementId ?? null },
      });
      return rows[0]!;
    });
  }

  reviewReservationDocument(
    claims: SessionClaims,
    documentId: string,
    input: { decision: 'approved' | 'rejected'; notes?: string | undefined },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const document = await transaction.query.reservationDocuments.findFirst({
        where: and(
          eq(reservationDocuments.id, documentId),
          eq(reservationDocuments.organizationId, claims.organizationId!),
        ),
      });
      if (!document || document.status !== 'submitted')
        throw new ConflictException('Submitted reservation document not found');
      const asset = await transaction.query.mediaAssets.findFirst({
        where: and(
          eq(mediaAssets.id, document.mediaAssetId),
          eq(mediaAssets.organizationId, claims.organizationId!),
        ),
      });
      if (
        input.decision === 'approved' &&
        (!asset || asset.processingStatus !== 'ready' || asset.scanStatus !== 'clean')
      )
        throw new ConflictException('Document must pass processing and malware scanning first');
      const now = new Date();
      const rows = await transaction
        .update(reservationDocuments)
        .set({
          status: input.decision,
          reviewedByUserId: claims.sub,
          reviewNotes: input.notes,
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(reservationDocuments.id, documentId))
        .returning();
      if (document.requirementId) {
        await transaction
          .update(reservationRequirements)
          .set({ status: input.decision, notes: input.notes, updatedAt: now })
          .where(eq(reservationRequirements.id, document.requirementId));
      }
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: `reservation.document-${input.decision}`,
        aggregateType: 'reservation_document',
        aggregateId: documentId,
        payload: { reservationId: document.reservationId },
      });
      return rows[0]!;
    });
  }

  listContracts(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) => {
      const scopedToTenant = isTenantFacingClaims(claims);
      return transaction
        .select({
          id: contracts.id,
          reference: contracts.reference,
          kind: contracts.kind,
          parentContractId: contracts.parentContractId,
          status: contracts.status,
          unitId: contracts.unitId,
          ownerPartyId: contracts.ownerPartyId,
          tenantPartyId: contracts.tenantPartyId,
          sentAt: contracts.sentAt,
          completedAt: contracts.completedAt,
          renderedPdfHash: contracts.renderedPdfHash,
          createdAt: contracts.createdAt,
          approvalStatus: sql<string | null>`(
            SELECT ar.status::text
            FROM approval_requests ar
            WHERE ar.organization_id = ${contracts.organizationId}
              AND ar.resource_type = 'contract'
              AND ar.resource_id = ${contracts.id}
            ORDER BY ar.created_at DESC
            LIMIT 1
          )`,
        })
        .from(contracts)
        .where(
          and(
            eq(contracts.organizationId, claims.organizationId!),
            ...(scopedToTenant && claims.partyId
              ? [eq(contracts.tenantPartyId, claims.partyId)]
              : []),
          ),
        )
        .orderBy(desc(contracts.createdAt));
    });
  }

  cancelHold(claims: SessionClaims, id: string) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .update(holds)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(holds.id, id),
            eq(holds.organizationId, claims.organizationId!),
            eq(holds.status, 'active'),
          ),
        )
        .returning();
      if (!rows[0]) throw new ConflictException('Only an active hold can be cancelled');
      await transaction.insert(workflowEvents).values({
        organizationId: claims.organizationId!,
        actorUserId: claims.sub,
        resourceType: 'hold',
        resourceId: id,
        eventType: 'hold.cancelled',
        fromStatus: 'active',
        toStatus: 'cancelled',
      });
      return rows[0];
    });
  }

  updateReservation(
    claims: SessionClaims,
    id: string,
    input: { status: 'confirmed' | 'cancelled'; note?: string | undefined },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const current = await transaction.query.reservations.findFirst({
        where: and(
          eq(reservations.id, id),
          eq(reservations.organizationId, claims.organizationId!),
        ),
      });
      if (!current) throw new NotFoundException('Reservation not found');
      const allowed =
        current.status === 'pending'
          ? ['confirmed', 'cancelled']
          : current.status === 'confirmed'
            ? ['cancelled']
            : [];
      if (!allowed.includes(input.status))
        throw new ConflictException(`Invalid reservation transition: ${current.status}`);
      let depositJournalId: string | null = null;
      if (input.status === 'confirmed') {
        const snapshot = current.termsSnapshot ?? {};
        const rawDeposit = snapshot.depositMinor;
        const depositMinor =
          typeof rawDeposit === 'string' && /^\d+$/.test(rawDeposit)
            ? BigInt(rawDeposit)
            : typeof rawDeposit === 'number' && Number.isFinite(rawDeposit) && rawDeposit >= 0
              ? BigInt(Math.trunc(rawDeposit))
              : 0n;
        const currency = (current.currency ??
          (typeof snapshot.currency === 'string' ? snapshot.currency : 'OMR')) as CurrencyCode;
        const journal = await this.financeService.postReservationDepositJournal(
          transaction,
          claims.organizationId!,
          {
            reservationId: id,
            partyId: current.tenantPartyId,
            unitId: current.unitId,
            currency,
            depositMinor,
            occurredOn: new Date().toISOString().slice(0, 10),
          },
        );
        depositJournalId = journal?.id ?? null;
      }
      const termsSnapshot =
        input.status === 'confirmed'
          ? {
              ...(current.termsSnapshot ?? {}),
              awaitingAccountantDeposit: false,
              depositConfirmedAt: new Date().toISOString(),
              depositConfirmedByUserId: claims.sub,
              depositConfirmationNote: input.note ?? null,
              depositJournalEntryId: depositJournalId,
            }
          : current.termsSnapshot;
      const rows = await transaction
        .update(reservations)
        .set({ status: input.status, termsSnapshot, updatedAt: new Date() })
        .where(eq(reservations.id, id))
        .returning();
      if (input.status === 'confirmed') {
        await transaction
          .update(reservationRequirements)
          .set({ status: 'approved', updatedAt: new Date() })
          .where(
            and(
              eq(reservationRequirements.reservationId, id),
              eq(reservationRequirements.code, 'deposit_receipt'),
            ),
          );
      }
      await transaction.insert(workflowEvents).values({
        organizationId: claims.organizationId!,
        actorUserId: claims.sub,
        resourceType: 'reservation',
        resourceId: id,
        eventType:
          input.status === 'confirmed'
            ? 'reservation.deposit_confirmed'
            : 'reservation.status_changed',
        fromStatus: current.status,
        toStatus: input.status,
        note: input.note,
      });
      return rows[0]!;
    });
  }

  updateLease(
    claims: SessionClaims,
    id: string,
    input: {
      action: LeaseLifecycleAction;
      note?: string | undefined;
      proposedEndsOn?: string | undefined;
      effectiveOn?: string | undefined;
      source?: 'tenant' | 'admin' | undefined;
    },
  ) {
    assertLeaseActionPermission(claims, input.action);
    return this.database.withinTenant(claims, async (transaction) => {
      const current = await transaction.query.leases.findFirst({
        where: and(eq(leases.id, id), eq(leases.organizationId, claims.organizationId!)),
      });
      if (!current) throw new NotFoundException('Lease not found');
      const now = new Date();

      if (input.action === 'activate' && current.status === 'draft') {
        if (!current.contractId)
          throw new ConflictException('A signed contract is required before lease activation');
        const contract = await transaction.query.contracts.findFirst({
          where: and(
            eq(contracts.id, current.contractId),
            eq(contracts.organizationId, claims.organizationId!),
            eq(contracts.status, 'signed'),
          ),
        });
        if (!contract)
          throw new ConflictException('A signed contract is required before lease activation');
        const leaseCheques = await transaction
          .select({ reviewStatus: cheques.reviewStatus })
          .from(cheques)
          .where(and(eq(cheques.organizationId, claims.organizationId!), eq(cheques.leaseId, id)));
        const blockedCheques = leaseCheques.filter(
          (row) => !['accepted', 'deposited', 'cleared'].includes(row.reviewStatus),
        );
        if (blockedCheques.length) {
          throw new ConflictException(
            'All lease cheques must be accepted by accounting before activation',
          );
        }
        const rows = await transaction
          .update(leases)
          .set({ status: 'active', updatedAt: now })
          .where(eq(leases.id, id))
          .returning();
        await this.writeLeaseLifecycleEvent(transaction, claims, {
          id,
          fromStatus: current.status,
          toStatus: 'active',
          action: input.action,
          note: input.note,
          endsOn: current.endsOn,
        });
        await transaction
          .update(billingSchedules)
          .set({ status: 'active', updatedAt: now })
          .where(eq(billingSchedules.leaseId, id));
        return this.serializeLease(rows[0]!);
      }

      if (input.action === 'request_cancellation' && current.status === 'active') {
        const proposed =
          input.proposedEndsOn && /^\d{4}-\d{2}-\d{2}$/.test(input.proposedEndsOn)
            ? input.proposedEndsOn
            : current.endsOn;
        const source = input.source === 'tenant' ? 'tenant' : 'admin';
        if (source === 'tenant') {
          if (!claims.partyId || claims.partyId !== current.tenantPartyId) {
            throw new ForbiddenException('Only the lease tenant can request cancellation');
          }
        }
        const rows = await transaction
          .update(leases)
          .set({
            status: 'cancel_requested',
            exitKind: 'cancel',
            cancellationSource: source,
            cancellationProposedOn: proposed,
            cancellationRequestedAt: now,
            cancellationRequestedByUserId: claims.sub,
            updatedAt: now,
          })
          .where(eq(leases.id, id))
          .returning();
        await this.writeLeaseLifecycleEvent(transaction, claims, {
          id,
          fromStatus: current.status,
          toStatus: 'cancel_requested',
          action: input.action,
          note: input.note,
          endsOn: proposed,
          metadata: { source, proposedEndsOn: proposed },
        });
        return this.serializeLease(rows[0]!);
      }

      if (input.action === 'approve_cancellation' && current.status === 'cancel_requested') {
        const effectiveOn =
          input.effectiveOn && /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveOn)
            ? input.effectiveOn
            : (current.cancellationProposedOn ?? current.endsOn);
        const rows = await transaction
          .update(leases)
          .set({
            status: 'clearance_pending',
            cancellationEffectiveOn: effectiveOn,
            cancellationAdminApprovedAt: now,
            cancellationAdminApprovedByUserId: claims.sub,
            updatedAt: now,
          })
          .where(eq(leases.id, id))
          .returning();
        await this.writeLeaseLifecycleEvent(transaction, claims, {
          id,
          fromStatus: current.status,
          toStatus: 'clearance_pending',
          action: input.action,
          note: input.note,
          endsOn: effectiveOn,
          metadata: { effectiveOn },
        });
        return this.serializeLease(rows[0]!);
      }

      // Natural end: active → accountant clearance → ended (deposit/invoices gate).
      if (input.action === 'end' && current.status === 'active') {
        const rows = await transaction
          .update(leases)
          .set({
            status: 'clearance_pending',
            exitKind: 'end',
            cancellationSource: 'admin',
            cancellationProposedOn: current.endsOn,
            cancellationEffectiveOn: current.endsOn,
            cancellationRequestedAt: now,
            cancellationRequestedByUserId: claims.sub,
            cancellationAdminApprovedAt: now,
            cancellationAdminApprovedByUserId: claims.sub,
            updatedAt: now,
          })
          .where(eq(leases.id, id))
          .returning();
        await this.writeLeaseLifecycleEvent(transaction, claims, {
          id,
          fromStatus: current.status,
          toStatus: 'clearance_pending',
          action: input.action,
          note: input.note,
          endsOn: current.endsOn,
          metadata: { exitKind: 'end' },
        });
        return this.serializeLease(rows[0]!);
      }

      if (input.action === 'clear_cancellation' && current.status === 'clearance_pending') {
        await this.assertLeaseClearanceReady(transaction, claims.organizationId!, id);
        assertDepositClearanceNote(current.depositMinor, input.note);
        const terminalStatus = current.exitKind === 'end' ? 'ended' : 'cancelled';
        // R2: seed deposit/vacancy follow-ups before tenant sees terminal status.
        await this.seedVacancyFollowUps(transaction, claims, {
          lease: { ...current, status: terminalStatus },
          id,
          actionLabel: terminalStatus === 'ended' ? 'end' : 'terminate',
        });
        const rows = await transaction
          .update(leases)
          .set({
            status: terminalStatus,
            cancellationClearedAt: now,
            cancellationClearedByUserId: claims.sub,
            cancellationClearanceNote: input.note ?? null,
            endsOn: current.cancellationEffectiveOn ?? current.endsOn,
            updatedAt: now,
          })
          .where(eq(leases.id, id))
          .returning();
        await this.writeLeaseLifecycleEvent(transaction, claims, {
          id,
          fromStatus: current.status,
          toStatus: terminalStatus,
          action: input.action,
          note: input.note,
          endsOn: current.cancellationEffectiveOn ?? current.endsOn,
          metadata: { exitKind: current.exitKind, depositSettled: Boolean(current.depositMinor) },
        });
        await transaction
          .update(billingSchedules)
          .set({
            status: terminalStatus === 'ended' ? 'completed' : 'cancelled',
            updatedAt: now,
          })
          .where(eq(billingSchedules.leaseId, id));
        return this.serializeLease(rows[0]!);
      }

      // Draft-only hard terminate (no active tenancy clearance).
      if (input.action === 'terminate' && current.status === 'draft') {
        const rows = await transaction
          .update(leases)
          .set({ status: 'terminated', updatedAt: now })
          .where(eq(leases.id, id))
          .returning();
        await this.writeLeaseLifecycleEvent(transaction, claims, {
          id,
          fromStatus: current.status,
          toStatus: 'terminated',
          action: input.action,
          note: input.note,
          endsOn: current.endsOn,
        });
        await transaction
          .update(billingSchedules)
          .set({ status: 'cancelled', updatedAt: now })
          .where(eq(billingSchedules.leaseId, id));
        return this.serializeLease(rows[0]!);
      }

      if (
        (input.action === 'confirm_renewal' || input.action === 'waive_renewal_gate') &&
        current.status === 'active'
      ) {
        if (!current.renewalPendingContractId || !current.renewalPendingEndsOn) {
          throw new ConflictException('No signed renewal is awaiting accountant confirmation');
        }
        if (input.action === 'confirm_renewal') {
          await this.assertLeaseClearanceReady(transaction, claims.organizationId!, id);
          const leaseCheques = await transaction
            .select({ reviewStatus: cheques.reviewStatus })
            .from(cheques)
            .where(
              and(eq(cheques.organizationId, claims.organizationId!), eq(cheques.leaseId, id)),
            );
          const blocked = leaseCheques.filter(
            (row) => !['accepted', 'deposited', 'cleared'].includes(row.reviewStatus),
          );
          if (blocked.length) {
            throw new ConflictException(
              'Lease cheques must be accepted by accounting before renewal confirmation',
            );
          }
        }
        const nextRent = current.renewalPendingRentMinor ?? current.rentMinor;
        const rows = await transaction
          .update(leases)
          .set({
            endsOn: current.renewalPendingEndsOn,
            rentMinor: nextRent,
            contractId: current.renewalPendingContractId,
            renewalPendingContractId: null,
            renewalPendingEndsOn: null,
            renewalPendingRentMinor: null,
            renewalGateWaivedAt: input.action === 'waive_renewal_gate' ? now : null,
            renewalGateWaivedByUserId: input.action === 'waive_renewal_gate' ? claims.sub : null,
            updatedAt: now,
          })
          .where(eq(leases.id, id))
          .returning();
        await this.writeLeaseLifecycleEvent(transaction, claims, {
          id,
          fromStatus: current.status,
          toStatus: current.status,
          action: input.action === 'waive_renewal_gate' ? 'renewal_waived' : 'renewed',
          note: input.note,
          endsOn: current.renewalPendingEndsOn,
          metadata: {
            renewalContractId: current.renewalPendingContractId,
            nextRentMinor: nextRent.toString(),
            waived: input.action === 'waive_renewal_gate',
          },
        });
        return this.serializeLease(rows[0]!);
      }

      if (input.action === 'terminate' && current.status === 'active') {
        throw new ConflictException(
          'Active leases require cancellation request → admin approval → accountant clearance',
        );
      }

      throw new ConflictException(`Invalid lease action: ${input.action}`);
    });
  }

  private serializeLease(row: typeof leases.$inferSelect) {
    return {
      ...row,
      rentMinor: row.rentMinor.toString(),
      depositMinor: row.depositMinor?.toString() ?? null,
      renewalPendingRentMinor: row.renewalPendingRentMinor?.toString() ?? null,
    };
  }

  private async writeLeaseLifecycleEvent(
    transaction: DatabaseTransaction,
    claims: SessionClaims,
    args: {
      id: string;
      fromStatus: string;
      toStatus: string;
      action: string;
      note?: string | undefined;
      endsOn: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    await transaction.insert(workflowEvents).values({
      organizationId: claims.organizationId!,
      actorUserId: claims.sub,
      resourceType: 'lease',
      resourceId: args.id,
      eventType: `lease.${args.action}`,
      fromStatus: args.fromStatus,
      toStatus: args.toStatus,
      note: args.note,
      metadata: { endsOn: args.endsOn, ...args.metadata },
    });
    await transaction.insert(outboxEvents).values({
      organizationId: claims.organizationId!,
      topic: `lease.${args.action}`,
      aggregateType: 'lease',
      aggregateId: args.id,
      payload: { status: args.toStatus, endsOn: args.endsOn, ...args.metadata },
    });
  }

  private async assertLeaseClearanceReady(
    transaction: DatabaseTransaction,
    organizationId: string,
    leaseId: string,
  ) {
    const openInvoices = await transaction
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.leaseId, leaseId),
          inArray(invoices.status, ['issued', 'partially_paid', 'overdue']),
        ),
      );
    if (openInvoices.length) {
      throw new ConflictException(
        'Accountant clearance blocked: open service/rent invoices must be settled first',
      );
    }
  }

  private async seedVacancyFollowUps(
    transaction: DatabaseTransaction,
    claims: SessionClaims,
    args: {
      lease: {
        unitId: string;
        tenantPartyId: string;
        depositMinor: bigint | null;
        currency: string;
        status: string;
      };
      id: string;
      actionLabel: 'end' | 'terminate';
    },
  ) {
    const { lease: current, id, actionLabel } = args;
    const existingVacancyTask = await transaction.query.workTasks.findFirst({
      where: and(
        eq(workTasks.organizationId, claims.organizationId!),
        eq(workTasks.relatedType, 'lease_vacancy'),
        eq(workTasks.relatedId, id),
      ),
    });
    if (existingVacancyTask) return;

    const unit = await transaction.query.units.findFirst({
      where: and(eq(units.id, current.unitId), eq(units.organizationId, claims.organizationId!)),
    });
    const dueAt = new Date();
    dueAt.setUTCDate(dueAt.getUTCDate() + 3);
    await transaction.insert(workTasks).values({
      organizationId: claims.organizationId!,
      reference: `VAC-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
      title:
        actionLabel === 'terminate'
          ? 'وحدة شاغرة بعد فسخ العقد — متابعة'
          : 'وحدة شاغرة بعد انتهاء العقد — متابعة',
      description:
        'Auto vacancy follow-up: inspection, maintenance, legal/deposit review, and accounts settlement. Open from Tasks, or deep-link Maintenance / Legal / Accounting with this unit.',
      category: 'vacancy',
      priority: 'high',
      createdByUserId: claims.sub,
      propertyId: unit?.propertyId,
      unitId: current.unitId,
      relatedType: 'lease_vacancy',
      relatedId: id,
      dueAt,
      checklist: [
        { label: 'معاينة / تسليم — Inspection / handover', done: false },
        { label: 'صيانة — Maintenance check', done: false },
        { label: 'محاماة / تأمين — Legal / deposit review', done: false },
        { label: 'حسابات — Final settlement', done: false },
      ],
    });

    const openVacancyTicket = await transaction.query.maintenanceTickets.findFirst({
      where: and(
        eq(maintenanceTickets.organizationId, claims.organizationId!),
        eq(maintenanceTickets.unitId, current.unitId),
        eq(maintenanceTickets.category, 'vacancy_handover'),
        inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress']),
      ),
    });
    if (!openVacancyTicket) {
      await transaction.insert(maintenanceTickets).values({
        organizationId: claims.organizationId!,
        unitId: current.unitId,
        openedByPartyId: claims.partyId ?? null,
        title:
          actionLabel === 'terminate'
            ? 'معاينة صيانة بعد فسخ العقد'
            : 'معاينة صيانة بعد انتهاء العقد',
        description: `Auto-opened for vacant unit after lease ${actionLabel}. Lease id: ${id}`,
        category: 'vacancy_handover',
        priority: 'high',
        blocksAvailability: false,
      });
    }

    const existingLegal = await transaction.query.legalCases.findFirst({
      where: and(
        eq(legalCases.organizationId, claims.organizationId!),
        eq(legalCases.leaseId, id),
        eq(legalCases.caseType, 'vacancy_deposit_review'),
      ),
    });
    if (!existingLegal) {
      const openedOn = new Date().toISOString().slice(0, 10);
      const currency = (current.currency ?? 'OMR') as CurrencyCode;
      await transaction.insert(legalCases).values({
        organizationId: claims.organizationId!,
        reference: `LEG-VAC-${id.replace(/-/g, '').slice(0, 10).toUpperCase()}`,
        caseType: 'vacancy_deposit_review',
        title:
          actionLabel === 'terminate'
            ? 'مراجعة تأمين/مخالصة بعد فسخ'
            : 'مراجعة تأمين/مخالصة بعد انتهاء العقد',
        description: `Auto legal assessment for deposit/settlement. Lease ${id}.`,
        propertyId: unit?.propertyId,
        unitId: current.unitId,
        leaseId: id,
        counterpartyId: current.tenantPartyId,
        status: 'assessment',
        claimAmountMinor: current.depositMinor ?? 0n,
        currency,
        minorUnit: currencyMinorUnits[currency],
        openedOn,
      });
    }

    const expenseRef = `EXP-VAC-${id.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
    const existingExpense = await transaction.query.expenses.findFirst({
      where: and(
        eq(expenses.organizationId, claims.organizationId!),
        eq(expenses.reference, expenseRef),
      ),
    });
    if (!existingExpense) {
      const currency = (current.currency ?? 'OMR') as CurrencyCode;
      const settlementAmount =
        current.depositMinor && current.depositMinor > 0n ? current.depositMinor : 1n;
      const issuedOn = new Date().toISOString().slice(0, 10);
      await transaction.insert(expenses).values({
        organizationId: claims.organizationId!,
        reference: expenseRef,
        propertyId: unit?.propertyId,
        unitId: current.unitId,
        category: 'vacancy_settlement',
        description:
          actionLabel === 'terminate'
            ? 'مخالصة حسابات بعد فسخ العقد'
            : 'مخالصة حسابات بعد انتهاء العقد',
        amountMinor: settlementAmount,
        taxMinor: 0n,
        currency,
        minorUnit: currencyMinorUnits[currency],
        status: 'pending',
        issuedOn,
        notes: `Auto vacancy settlement for lease ${id}. Adjust amount then approve.`,
      });
    }
  }

  private async assertAddressBookReadyForReservation(
    transaction: DatabaseTransaction,
    organizationId: string,
    partyId: string,
  ): Promise<void> {
    const [role] = await transaction
      .select({ id: partyRoles.id })
      .from(partyRoles)
      .where(
        and(
          eq(partyRoles.organizationId, organizationId),
          eq(partyRoles.partyId, partyId),
          eq(partyRoles.roleKey, 'tenant'),
          eq(partyRoles.status, 'active'),
        ),
      )
      .limit(1);
    if (!role) {
      throw new ConflictException('Tenant must be registered in the address book with role tenant');
    }
    const party = await transaction.query.parties.findFirst({
      where: and(eq(parties.id, partyId), eq(parties.organizationId, organizationId)),
    });
    if (!party?.email || !party.phone) {
      throw new ConflictException('Tenant address book entry requires email and phone');
    }
    const [address] = await transaction
      .select({ partyId: partyAddresses.partyId })
      .from(partyAddresses)
      .where(
        and(eq(partyAddresses.organizationId, organizationId), eq(partyAddresses.partyId, partyId)),
      )
      .limit(1);
    if (!address) {
      throw new ConflictException('Tenant address book entry requires a primary address');
    }
    const [identity] = await transaction
      .select({ id: partyIdentityDocuments.id })
      .from(partyIdentityDocuments)
      .where(
        and(
          eq(partyIdentityDocuments.organizationId, organizationId),
          eq(partyIdentityDocuments.partyId, partyId),
        ),
      )
      .limit(1);
    if (!identity) {
      throw new ConflictException(
        'Tenant address book entry requires an identity document (civil ID or CR)',
      );
    }
  }

  private async lockAndAssertAvailable(
    transaction: DatabaseTransaction,
    organizationId: string,
    unitId: string,
    allowedReservationId?: string,
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
          ...(allowedReservationId ? [ne(reservations.id, allowedReservationId)] : []),
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
