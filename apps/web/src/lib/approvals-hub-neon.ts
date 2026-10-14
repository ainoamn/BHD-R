import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  approvalRequests,
  contractSignatures,
  contracts,
  expenses,
  maintenanceWorkOrders,
  parties,
  properties,
  reservations,
  units,
  users,
} from '@bhd-r/db';
import type {
  ApprovalRequestRow,
  ApprovalsHub,
  SignatureRegisterEntry,
} from '@/lib/approvals-hub-shared';
import { contractVerifyToken, contractVerifyUrl, signatureRegister } from '@/lib/contract-verify';
import { loadPendingApprovals } from '@/lib/pending-approvals-neon';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';

const REQUEST_LIMIT = 100;
const SIGNATURE_LIMIT = 300;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The owner's approvals hub: everything awaiting their decision (the bell, in full), the
 * approval requests raised for contracts, expenses and work orders, and the register of
 * online signatures with the serials printed on the contracts. Owner-scoped users only see
 * their own properties.
 */
export async function loadApprovalsHub(claims: SessionClaims): Promise<ApprovalsHub> {
  const canReadRequests = hasPermission(claims, 'approval.read');
  const canReadSignatures = hasPermission(claims, 'contract.read');
  const [pending, requests, signatures] = await Promise.all([
    loadPendingApprovals(claims),
    canReadRequests ? listApprovalRequests(claims) : Promise.resolve([]),
    canReadSignatures ? listSignatures(claims) : Promise.resolve([]),
  ]);
  return {
    pending,
    requests,
    signatures,
    canDecide: hasPermission(claims, 'approval.decide'),
    canReadSignatures,
  };
}

async function listApprovalRequests(claims: SessionClaims): Promise<ApprovalRequestRow[]> {
  const orgId = claims.organizationId;
  if (!orgId) return [];
  const ownerPartyId = ownerPartyScope(claims);
  const requester = alias(users, 'requester');
  const decider = alias(users, 'decider');
  return withinViewerTenant(claims, async (tx) => {
    const rows = await tx
      .select({
        id: approvalRequests.id,
        reference: approvalRequests.reference,
        type: approvalRequests.type,
        subject: approvalRequests.subject,
        resourceType: approvalRequests.resourceType,
        resourceId: approvalRequests.resourceId,
        status: approvalRequests.status,
        requestedBy: requester.displayName,
        decidedBy: sql<
          string | null
        >`case when ${approvalRequests.decidedAt} is not null then ${decider.displayName} end`,
        decisionNote: approvalRequests.decisionNote,
        createdAt: approvalRequests.createdAt,
        decidedAt: approvalRequests.decidedAt,
        targetReference: sql<string | null>`coalesce(
          ${contracts.reference}, ${expenses.reference}, ${maintenanceWorkOrders.reference}
        )`,
        amountMinor: sql<string | null>`coalesce(
          ${expenses.amountMinor} + ${expenses.taxMinor}, ${maintenanceWorkOrders.estimateMinor}
        )::text`,
        currency: sql<
          string | null
        >`coalesce(${expenses.currency}, ${maintenanceWorkOrders.currency})`,
        propertyId: properties.id,
        propertyNameAr: properties.nameAr,
        propertyNameEn: properties.nameEn,
        unitCode: units.code,
      })
      .from(approvalRequests)
      .leftJoin(requester, eq(requester.id, approvalRequests.requestedByUserId))
      .leftJoin(decider, eq(decider.id, approvalRequests.assignedToUserId))
      .leftJoin(
        contracts,
        and(
          eq(approvalRequests.resourceType, 'contract'),
          eq(contracts.id, approvalRequests.resourceId),
        ),
      )
      .leftJoin(
        expenses,
        and(
          eq(approvalRequests.resourceType, 'expense'),
          eq(expenses.id, approvalRequests.resourceId),
        ),
      )
      .leftJoin(
        maintenanceWorkOrders,
        and(
          eq(approvalRequests.resourceType, 'maintenance_work_order'),
          eq(maintenanceWorkOrders.id, approvalRequests.resourceId),
        ),
      )
      .leftJoin(units, sql`${units.id} = coalesce(${contracts.unitId}, ${expenses.unitId})`)
      .leftJoin(
        properties,
        sql`${properties.id} = coalesce(${units.propertyId}, ${expenses.propertyId})`,
      )
      .where(
        and(
          eq(approvalRequests.organizationId, orgId),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .orderBy(
        sql`case when ${approvalRequests.status} in ('pending', 'on_hold') then 0 else 1 end`,
        desc(approvalRequests.createdAt),
      )
      .limit(REQUEST_LIMIT);
    return rows.map((row) => ({
      ...row,
      status: String(row.status),
      createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
      decidedAt: iso(row.decidedAt),
    }));
  });
}

async function listSignatures(claims: SessionClaims): Promise<SignatureRegisterEntry[]> {
  const orgId = claims.organizationId;
  if (!orgId) return [];
  const ownerPartyId = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    const register = await signatureRegister(tx, orgId, SIGNATURE_LIMIT);
    const contractSignatureIds = register
      .filter((row) => row.kind === 'contract')
      .map((row) => row.id);
    const reservationIds = [
      ...new Set(register.filter((row) => row.kind === 'reservation').map((row) => row.parentId)),
    ];
    const ownerScope = ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : [];
    const contractRows = contractSignatureIds.length
      ? await tx
          .select({
            id: contractSignatures.id,
            contractId: contracts.id,
            contractCreatedAt: contracts.createdAt,
            reference: contracts.reference,
            contractType: sql<string | null>`${contracts.payloadSnapshot}->'contract'->>'type'`,
            signer: parties.displayName,
            signerRole: contractSignatures.signerRole,
            method: contractSignatures.method,
            propertyId: properties.id,
            propertyNameAr: properties.nameAr,
            propertyNameEn: properties.nameEn,
            unitCode: units.code,
          })
          .from(contractSignatures)
          .innerJoin(contracts, eq(contracts.id, contractSignatures.contractId))
          .innerJoin(units, eq(units.id, contracts.unitId))
          .innerJoin(properties, eq(properties.id, units.propertyId))
          .leftJoin(parties, eq(parties.id, contractSignatures.signerPartyId))
          .where(
            and(
              eq(contractSignatures.organizationId, orgId),
              inArray(contractSignatures.id, contractSignatureIds),
              ...ownerScope,
            ),
          )
      : [];
    const reservationRows = reservationIds.length
      ? await tx
          .select({
            id: reservations.id,
            reference: sql<string | null>`${reservations.termsSnapshot}->>'referenceCode'`,
            mode: sql<string | null>`${reservations.termsSnapshot}->>'mode'`,
            signer: sql<string | null>`${reservations.termsSnapshot}->'contact'->>'fullName'`,
            propertyId: properties.id,
            propertyNameAr: properties.nameAr,
            propertyNameEn: properties.nameEn,
            unitCode: units.code,
          })
          .from(reservations)
          .innerJoin(units, eq(units.id, reservations.unitId))
          .innerJoin(properties, eq(properties.id, units.propertyId))
          .where(
            and(
              eq(reservations.organizationId, orgId),
              inArray(reservations.id, reservationIds),
              ...ownerScope,
            ),
          )
      : [];
    const contractById = new Map(contractRows.map((row) => [row.id, row]));
    const reservationById = new Map(reservationRows.map((row) => [row.id, row]));
    const entries: SignatureRegisterEntry[] = [];
    for (const row of register) {
      if (row.kind === 'contract') {
        const detail = contractById.get(row.id);
        if (!detail) continue;
        entries.push({
          id: row.id,
          serial: row.serial,
          kind: 'contract',
          parentId: detail.contractId,
          reference: detail.reference,
          contractType: detail.contractType === 'sale' ? 'sale' : 'lease',
          signer: detail.signer,
          signerRole: detail.signerRole,
          method: detail.method,
          signedAt: row.signedAt,
          propertyId: detail.propertyId,
          propertyNameAr: detail.propertyNameAr,
          propertyNameEn: detail.propertyNameEn,
          unitCode: detail.unitCode,
          verifyUrl: contractVerifyUrl(
            contractVerifyToken(detail.contractId, new Date(detail.contractCreatedAt)),
          ),
        });
      } else {
        const detail = reservationById.get(row.parentId);
        if (!detail) continue;
        entries.push({
          id: row.id,
          serial: row.serial,
          kind: 'reservation',
          parentId: row.parentId,
          reference: detail.reference,
          contractType: detail.mode === 'sale' ? 'sale' : 'lease',
          signer: detail.signer,
          signerRole: 'tenant',
          method: 'reservation_esign',
          signedAt: row.signedAt,
          propertyId: detail.propertyId,
          propertyNameAr: detail.propertyNameAr,
          propertyNameEn: detail.propertyNameEn,
          unitCode: detail.unitCode,
          verifyUrl: null,
        });
      }
    }
    return entries;
  });
}
