import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { SessionClaims } from '@bhd-r/authz';
import { currencyMinorUnits, type CurrencyCode } from '@bhd-r/contracts';
import {
  approvalRequests,
  contracts,
  contractTemplates,
  expenses,
  holds,
  invoices,
  leases,
  ledgerAccounts,
  legalCases,
  legalEvents,
  maintenanceTickets,
  maintenanceWorkOrders,
  memberships,
  operationalRequests,
  outboxEvents,
  parties,
  partyRoles,
  properties,
  propertyOwnershipInterests,
  reservations,
  salesDeals,
  units,
  users,
  vendors,
  viewingRequests,
  workflowEvents,
  workTasks,
} from '@bhd-r/db';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';

type Priority = 'low' | 'normal' | 'high' | 'urgent';
type WorkflowStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'rejected'
  | 'cancelled';
type ViewingStatus =
  'requested' | 'scheduled' | 'completed' | 'no_show' | 'cancelled' | 'converted';
type SalesStatus =
  | 'lead'
  | 'qualified'
  | 'viewing'
  | 'offer'
  | 'negotiation'
  | 'reserved'
  | 'contracting'
  | 'closed_won'
  | 'closed_lost'
  | 'cancelled';
type WorkOrderStatus =
  | 'draft'
  | 'quoted'
  | 'awaiting_approval'
  | 'approved'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'verified'
  | 'cancelled';
type LegalStatus =
  | 'assessment'
  | 'notice'
  | 'filed'
  | 'hearing'
  | 'judgment'
  | 'enforcement'
  | 'settled'
  | 'closed'
  | 'cancelled';

const workflowTransitions: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  draft: ['pending', 'cancelled'],
  pending: ['approved', 'in_progress', 'rejected', 'cancelled'],
  approved: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  completed: [],
  rejected: ['pending', 'cancelled'],
  cancelled: [],
};
const viewingTransitions: Readonly<Record<ViewingStatus, readonly ViewingStatus[]>> = {
  requested: ['scheduled', 'cancelled'],
  scheduled: ['completed', 'no_show', 'cancelled'],
  completed: ['converted'],
  no_show: ['scheduled', 'cancelled'],
  cancelled: [],
  converted: [],
};
export const salesTransitions: Readonly<Record<SalesStatus, readonly SalesStatus[]>> = {
  lead: ['qualified', 'closed_lost', 'cancelled'],
  qualified: ['viewing', 'offer', 'closed_lost', 'cancelled'],
  viewing: ['offer', 'negotiation', 'closed_lost', 'cancelled'],
  offer: ['negotiation', 'reserved', 'closed_lost', 'cancelled'],
  negotiation: ['offer', 'reserved', 'closed_lost', 'cancelled'],
  reserved: ['contracting', 'cancelled'],
  contracting: ['closed_won', 'cancelled'],
  closed_won: [],
  closed_lost: ['lead'],
  cancelled: [],
};
const workOrderTransitions: Readonly<Record<WorkOrderStatus, readonly WorkOrderStatus[]>> = {
  draft: ['quoted', 'cancelled'],
  quoted: ['awaiting_approval', 'cancelled'],
  awaiting_approval: ['approved', 'quoted', 'cancelled'],
  approved: ['scheduled', 'in_progress', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['verified', 'in_progress'],
  verified: [],
  cancelled: [],
};
const legalTransitions: Readonly<Record<LegalStatus, readonly LegalStatus[]>> = {
  assessment: ['notice', 'filed', 'settled', 'cancelled'],
  notice: ['filed', 'settled', 'closed'],
  filed: ['hearing', 'settled', 'cancelled'],
  hearing: ['judgment', 'settled'],
  judgment: ['enforcement', 'settled', 'closed'],
  enforcement: ['settled', 'closed'],
  settled: ['closed'],
  closed: [],
  cancelled: [],
};

function reference(prefix: string): string {
  const now = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  return `${prefix}-${now}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

export function assertTransition<T extends string>(
  current: T,
  next: T,
  transitions: Readonly<Record<T, readonly T[]>>,
) {
  if (current === next) return;
  if (!transitions[current]?.includes(next)) {
    throw new ConflictException(`Invalid status transition: ${current} -> ${next}`);
  }
}

async function appendWorkflowEvent(
  transaction: DatabaseTransaction,
  claims: SessionClaims,
  input: {
    resourceType: string;
    resourceId: string;
    eventType: string;
    fromStatus?: string | undefined;
    toStatus?: string | undefined;
    note?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  },
) {
  await transaction.insert(workflowEvents).values({
    organizationId: claims.organizationId!,
    actorUserId: claims.sub,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    eventType: input.eventType,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    note: input.note,
    metadata: input.metadata ?? {},
  });
}

async function emitOutbox(
  transaction: DatabaseTransaction,
  claims: SessionClaims,
  topic: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
) {
  await transaction.insert(outboxEvents).values({
    organizationId: claims.organizationId!,
    topic,
    aggregateType,
    aggregateId,
    payload,
  });
}

@Injectable()
export class OperationsService {
  constructor(private readonly database: DatabaseService) {}

  dashboard(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const [requests, tasks, viewings, sales, workOrders, cases, approvals] = await Promise.all([
        transaction
          .select({ value: count() })
          .from(operationalRequests)
          .where(inArray(operationalRequests.status, ['pending', 'approved', 'in_progress'])),
        transaction
          .select({ value: count() })
          .from(workTasks)
          .where(inArray(workTasks.status, ['pending', 'approved', 'in_progress', 'on_hold'])),
        transaction
          .select({ value: count() })
          .from(viewingRequests)
          .where(inArray(viewingRequests.status, ['requested', 'scheduled'])),
        transaction
          .select({ value: count() })
          .from(salesDeals)
          .where(
            inArray(salesDeals.status, [
              'lead',
              'qualified',
              'viewing',
              'offer',
              'negotiation',
              'reserved',
              'contracting',
            ]),
          ),
        transaction
          .select({ value: count() })
          .from(maintenanceWorkOrders)
          .where(
            inArray(maintenanceWorkOrders.status, [
              'draft',
              'quoted',
              'awaiting_approval',
              'approved',
              'scheduled',
              'in_progress',
              'completed',
            ]),
          ),
        transaction
          .select({ value: count() })
          .from(legalCases)
          .where(
            inArray(legalCases.status, [
              'assessment',
              'notice',
              'filed',
              'hearing',
              'judgment',
              'enforcement',
              'settled',
            ]),
          ),
        transaction
          .select({ value: count() })
          .from(approvalRequests)
          .where(eq(approvalRequests.status, 'pending')),
      ]);
      return {
        openRequests: requests[0]?.value ?? 0,
        openTasks: tasks[0]?.value ?? 0,
        upcomingViewings: viewings[0]?.value ?? 0,
        activeSalesDeals: sales[0]?.value ?? 0,
        openWorkOrders: workOrders[0]?.value ?? 0,
        activeLegalCases: cases[0]?.value ?? 0,
        pendingApprovals: approvals[0]?.value ?? 0,
      };
    });
  }

  context(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const [
        propertyRows,
        unitRows,
        partyRows,
        userRows,
        vendorRows,
        ticketRows,
        leaseRows,
        invoiceRows,
        templateRows,
        reservationRows,
        accountRows,
      ] = await Promise.all([
        transaction
          .select({ id: properties.id, nameAr: properties.nameAr, nameEn: properties.nameEn })
          .from(properties)
          .where(eq(properties.organizationId, claims.organizationId!))
          .orderBy(asc(properties.nameAr)),
        transaction
          .select({
            id: units.id,
            propertyId: units.propertyId,
            code: units.code,
            nameAr: units.nameAr,
            nameEn: units.nameEn,
            currency: units.currency,
          })
          .from(units)
          .where(eq(units.organizationId, claims.organizationId!))
          .orderBy(asc(units.code)),
        transaction
          .select({ id: parties.id, name: parties.displayName, type: parties.type })
          .from(parties)
          .where(eq(parties.organizationId, claims.organizationId!))
          .orderBy(asc(parties.displayName)),
        transaction
          .selectDistinct({ id: users.id, name: users.displayName })
          .from(users)
          .innerJoin(memberships, eq(memberships.userId, users.id))
          .where(eq(memberships.organizationId, claims.organizationId!))
          .orderBy(asc(users.displayName)),
        transaction
          .select({ id: vendors.id, code: vendors.code, name: vendors.name })
          .from(vendors)
          .where(eq(vendors.organizationId, claims.organizationId!))
          .orderBy(asc(vendors.name)),
        transaction
          .select({ id: maintenanceTickets.id, title: maintenanceTickets.title })
          .from(maintenanceTickets)
          .where(eq(maintenanceTickets.organizationId, claims.organizationId!))
          .orderBy(desc(maintenanceTickets.createdAt)),
        transaction
          .select({
            id: leases.id,
            unitId: leases.unitId,
            tenantPartyId: leases.tenantPartyId,
            status: leases.status,
            currency: leases.currency,
            rentMinor: leases.rentMinor,
            depositMinor: leases.depositMinor,
            startsOn: leases.startsOn,
            endsOn: leases.endsOn,
            exitKind: leases.exitKind,
            cancellationProposedOn: leases.cancellationProposedOn,
            cancellationEffectiveOn: leases.cancellationEffectiveOn,
            renewalPendingContractId: leases.renewalPendingContractId,
            renewalPendingEndsOn: leases.renewalPendingEndsOn,
          })
          .from(leases)
          .where(eq(leases.organizationId, claims.organizationId!))
          .orderBy(desc(leases.createdAt)),
        transaction
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            currency: invoices.currency,
            outstandingMinor: sql<bigint>`${invoices.totalMinor} - ${invoices.paidMinor}`,
            status: invoices.status,
          })
          .from(invoices)
          .where(eq(invoices.organizationId, claims.organizationId!))
          .orderBy(desc(invoices.createdAt)),
        transaction
          .select({
            id: contractTemplates.id,
            key: contractTemplates.key,
            version: contractTemplates.version,
            language: contractTemplates.language,
          })
          .from(contractTemplates)
          .where(
            and(
              eq(contractTemplates.organizationId, claims.organizationId!),
              eq(contractTemplates.active, true),
            ),
          )
          .orderBy(desc(contractTemplates.version)),
        transaction
          .select({
            id: reservations.id,
            unitId: reservations.unitId,
            tenantPartyId: reservations.tenantPartyId,
            status: reservations.status,
          })
          .from(reservations)
          .where(
            and(
              eq(reservations.organizationId, claims.organizationId!),
              inArray(reservations.status, ['pending', 'confirmed']),
            ),
          )
          .orderBy(desc(reservations.createdAt)),
        transaction
          .select({
            id: ledgerAccounts.id,
            code: ledgerAccounts.code,
            nameAr: ledgerAccounts.nameAr,
            nameEn: ledgerAccounts.nameEn,
            type: ledgerAccounts.type,
          })
          .from(ledgerAccounts)
          .where(eq(ledgerAccounts.organizationId, claims.organizationId!))
          .orderBy(asc(ledgerAccounts.code)),
      ]);
      const blockedUnitIds = new Set<string>([
        ...(
          await transaction
            .select({ unitId: holds.unitId })
            .from(holds)
            .where(
              and(
                eq(holds.organizationId, claims.organizationId!),
                eq(holds.status, 'active'),
                sql`${holds.expiresAt} > now()`,
              ),
            )
        ).map((row) => row.unitId),
        ...(
          await transaction
            .select({ unitId: reservations.unitId })
            .from(reservations)
            .where(
              and(
                eq(reservations.organizationId, claims.organizationId!),
                inArray(reservations.status, ['pending', 'confirmed']),
                sql`${reservations.expiresAt} > now()`,
              ),
            )
        ).map((row) => row.unitId),
        ...(
          await transaction
            .select({ unitId: leases.unitId })
            .from(leases)
            .where(
              and(
                eq(leases.organizationId, claims.organizationId!),
                inArray(leases.status, [
                  'draft',
                  'active',
                  'cancel_requested',
                  'clearance_pending',
                ]),
              ),
            )
        ).map((row) => row.unitId),
      ]);
      const vacantUnits = unitRows
        .filter((row) => !blockedUnitIds.has(row.id))
        .map((row) => ({
          ...row,
          name: `${row.code} · ${row.nameAr}`,
        }));
      const roleRows = await transaction
        .select({ partyId: partyRoles.partyId, roleKey: partyRoles.roleKey })
        .from(partyRoles)
        .where(
          and(
            eq(partyRoles.organizationId, claims.organizationId!),
            eq(partyRoles.status, 'active'),
            inArray(partyRoles.roleKey, ['owner', 'tenant']),
          ),
        );
      const ownerIds = new Set(
        roleRows.filter((row) => row.roleKey === 'owner').map((row) => row.partyId),
      );
      const tenantIds = new Set(
        roleRows.filter((row) => row.roleKey === 'tenant').map((row) => row.partyId),
      );

      const [vacancyTasks, vacancyMaintenance, vacancyLegal, vacancyExpenses] = await Promise.all([
        transaction
          .select({ value: count() })
          .from(workTasks)
          .where(
            and(
              eq(workTasks.organizationId, claims.organizationId!),
              eq(workTasks.relatedType, 'lease_vacancy'),
              inArray(workTasks.status, ['pending', 'approved', 'in_progress', 'on_hold']),
            ),
          ),
        transaction
          .select({ value: count() })
          .from(maintenanceTickets)
          .where(
            and(
              eq(maintenanceTickets.organizationId, claims.organizationId!),
              eq(maintenanceTickets.category, 'vacancy_handover'),
              inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress']),
            ),
          ),
        transaction
          .select({ value: count() })
          .from(legalCases)
          .where(
            and(
              eq(legalCases.organizationId, claims.organizationId!),
              eq(legalCases.caseType, 'vacancy_deposit_review'),
              inArray(legalCases.status, [
                'assessment',
                'notice',
                'filed',
                'hearing',
                'judgment',
                'enforcement',
              ]),
            ),
          ),
        transaction
          .select({ value: count() })
          .from(expenses)
          .where(
            and(
              eq(expenses.organizationId, claims.organizationId!),
              eq(expenses.category, 'vacancy_settlement'),
              inArray(expenses.status, ['draft', 'pending', 'approved', 'in_progress', 'on_hold']),
            ),
          ),
      ]);

      return {
        properties: propertyRows,
        units: unitRows,
        vacantUnits,
        parties: partyRows,
        owners: partyRows.filter((row) => ownerIds.has(row.id)),
        tenants: partyRows.filter((row) => tenantIds.has(row.id)),
        users: userRows,
        vendors: vendorRows,
        maintenanceTickets: ticketRows,
        leases: leaseRows.map((row) => ({
          ...row,
          rentMinor: row.rentMinor.toString(),
          depositMinor: row.depositMinor?.toString() ?? null,
        })),
        cancelRequestedLeases: leaseRows
          .filter((row) => row.status === 'cancel_requested')
          .map((row) => ({
            ...row,
            rentMinor: row.rentMinor.toString(),
            depositMinor: row.depositMinor?.toString() ?? null,
            name: `${row.id.slice(0, 8)} · cancel requested`,
          })),
        clearancePendingLeases: leaseRows
          .filter((row) => row.status === 'clearance_pending')
          .map((row) => ({
            ...row,
            rentMinor: row.rentMinor.toString(),
            depositMinor: row.depositMinor?.toString() ?? null,
            name: `${row.id.slice(0, 8)} · clearance pending`,
          })),
        renewalPendingLeases: leaseRows
          .filter((row) => Boolean(row.renewalPendingContractId))
          .map((row) => ({
            ...row,
            rentMinor: row.rentMinor.toString(),
            depositMinor: row.depositMinor?.toString() ?? null,
            name: `${row.id.slice(0, 8)} · renewal pending clearance`,
          })),
        invoices: invoiceRows.map((row) => ({
          ...row,
          outstandingMinor: row.outstandingMinor.toString(),
        })),
        contractTemplates: templateRows,
        reservations: reservationRows.map((row) => ({
          ...row,
          name: `${row.id.slice(0, 8)} · ${row.status}`,
        })),
        pendingDepositReservations: reservationRows
          .filter((row) => row.status === 'pending')
          .map((row) => ({
            ...row,
            name: `${row.id.slice(0, 8)} · pending deposit`,
          })),
        confirmedReservations: reservationRows
          .filter((row) => row.status === 'confirmed')
          .map((row) => ({
            ...row,
            name: `${row.id.slice(0, 8)} · confirmed`,
          })),
        ledgerAccounts: accountRows,
        vacancyFollowUps: {
          tasks: Number(vacancyTasks[0]?.value ?? 0),
          maintenance: Number(vacancyMaintenance[0]?.value ?? 0),
          legal: Number(vacancyLegal[0]?.value ?? 0),
          expenses: Number(vacancyExpenses[0]?.value ?? 0),
        },
      };
    });
  }

  listRequests(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(operationalRequests)
        .where(eq(operationalRequests.organizationId, claims.organizationId!))
        .orderBy(desc(operationalRequests.createdAt)),
    );
  }

  createRequest(
    claims: SessionClaims,
    input: {
      type: string;
      subject: string;
      description?: string | undefined;
      priority: Priority;
      propertyId?: string | undefined;
      unitId?: string | undefined;
      requesterPartyId?: string | undefined;
      dueAt?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .insert(operationalRequests)
        .values({
          organizationId: claims.organizationId!,
          reference: reference('REQ'),
          requesterPartyId: input.requesterPartyId ?? claims.partyId,
          type: input.type,
          subject: input.subject,
          description: input.description,
          priority: input.priority,
          propertyId: input.propertyId,
          unitId: input.unitId,
          dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
        })
        .returning();
      const row = rows[0]!;
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'operational_request',
        resourceId: row.id,
        eventType: 'request.created',
        toStatus: row.status,
      });
      await emitOutbox(transaction, claims, 'request.created', 'operational_request', row.id, {
        type: row.type,
        priority: row.priority,
      });
      return row;
    });
  }

  updateRequest(
    claims: SessionClaims,
    id: string,
    input: { status: WorkflowStatus; note?: string },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const current = await transaction.query.operationalRequests.findFirst({
        where: and(
          eq(operationalRequests.id, id),
          eq(operationalRequests.organizationId, claims.organizationId!),
        ),
      });
      if (!current) throw new NotFoundException('Request not found');
      assertTransition(current.status, input.status, workflowTransitions);
      const rows = await transaction
        .update(operationalRequests)
        .set({
          status: input.status,
          completedAt: input.status === 'completed' ? new Date() : current.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(operationalRequests.id, id))
        .returning();
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'operational_request',
        resourceId: id,
        eventType: 'request.status_changed',
        fromStatus: current.status,
        toStatus: input.status,
        note: input.note,
      });
      return rows[0]!;
    });
  }

  listTasks(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(workTasks)
        .where(eq(workTasks.organizationId, claims.organizationId!))
        .orderBy(desc(workTasks.createdAt)),
    );
  }

  createTask(
    claims: SessionClaims,
    input: {
      title: string;
      description?: string | undefined;
      category: string;
      priority: Priority;
      assignedToUserId?: string | undefined;
      propertyId?: string | undefined;
      unitId?: string | undefined;
      relatedType?: string | undefined;
      relatedId?: string | undefined;
      startsAt?: string | undefined;
      dueAt?: string | undefined;
      checklist?: Array<{ label: string; done: boolean }> | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .insert(workTasks)
        .values({
          organizationId: claims.organizationId!,
          reference: reference('TSK'),
          createdByUserId: claims.sub,
          ...input,
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
          dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
        })
        .returning();
      const row = rows[0]!;
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'work_task',
        resourceId: row.id,
        eventType: 'task.created',
        toStatus: row.status,
      });
      return row;
    });
  }

  updateTask(claims: SessionClaims, id: string, input: { status: WorkflowStatus; note?: string }) {
    return this.database.withinTenant(claims, async (transaction) => {
      const current = await transaction.query.workTasks.findFirst({
        where: and(eq(workTasks.id, id), eq(workTasks.organizationId, claims.organizationId!)),
      });
      if (!current) throw new NotFoundException('Task not found');
      assertTransition(current.status, input.status, workflowTransitions);
      const rows = await transaction
        .update(workTasks)
        .set({
          status: input.status,
          completedAt: input.status === 'completed' ? new Date() : current.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(workTasks.id, id))
        .returning();
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'work_task',
        resourceId: id,
        eventType: 'task.status_changed',
        fromStatus: current.status,
        toStatus: input.status,
        note: input.note,
      });
      return rows[0]!;
    });
  }

  listViewings(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(viewingRequests)
        .where(eq(viewingRequests.organizationId, claims.organizationId!))
        .orderBy(desc(viewingRequests.createdAt)),
    );
  }

  createViewing(
    claims: SessionClaims,
    input: {
      unitId: string;
      prospectPartyId: string;
      assignedToUserId?: string | undefined;
      channel: string;
      preferredAt?: string | undefined;
      scheduledAt?: string | undefined;
      notes?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const unit = await transaction.query.units.findFirst({
        where: and(eq(units.id, input.unitId), eq(units.organizationId, claims.organizationId!)),
      });
      const prospect = await transaction.query.parties.findFirst({
        where: and(
          eq(parties.id, input.prospectPartyId),
          eq(parties.organizationId, claims.organizationId!),
        ),
      });
      if (!unit || !prospect) throw new NotFoundException('Unit or prospect not found');
      const rows = await transaction
        .insert(viewingRequests)
        .values({
          organizationId: claims.organizationId!,
          reference: reference('VWG'),
          ...input,
          status: input.scheduledAt ? 'scheduled' : 'requested',
          preferredAt: input.preferredAt ? new Date(input.preferredAt) : undefined,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        })
        .returning();
      const row = rows[0]!;
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'viewing_request',
        resourceId: row.id,
        eventType: 'viewing.created',
        toStatus: row.status,
      });
      await emitOutbox(transaction, claims, 'viewing.created', 'viewing_request', row.id, {
        unitId: row.unitId,
        scheduledAt: row.scheduledAt?.toISOString() ?? null,
      });
      return row;
    });
  }

  updateViewing(
    claims: SessionClaims,
    id: string,
    input: { status: ViewingStatus; note?: string },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const current = await transaction.query.viewingRequests.findFirst({
        where: and(
          eq(viewingRequests.id, id),
          eq(viewingRequests.organizationId, claims.organizationId!),
        ),
      });
      if (!current) throw new NotFoundException('Viewing not found');
      assertTransition(current.status, input.status, viewingTransitions);
      const rows = await transaction
        .update(viewingRequests)
        .set({
          status: input.status,
          completedAt: ['completed', 'converted'].includes(input.status)
            ? new Date()
            : current.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(viewingRequests.id, id))
        .returning();
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'viewing_request',
        resourceId: id,
        eventType: 'viewing.status_changed',
        fromStatus: current.status,
        toStatus: input.status,
        note: input.note,
      });
      return rows[0]!;
    });
  }

  listSales(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select()
        .from(salesDeals)
        .where(eq(salesDeals.organizationId, claims.organizationId!))
        .orderBy(desc(salesDeals.createdAt));
      return rows.map((row) => ({
        ...row,
        askingPriceMinor: row.askingPriceMinor.toString(),
        offerPriceMinor: row.offerPriceMinor?.toString() ?? null,
        agreedPriceMinor: row.agreedPriceMinor?.toString() ?? null,
        commissionMinor: row.commissionMinor.toString(),
      }));
    });
  }

  createSale(
    claims: SessionClaims,
    input: {
      propertyId: string;
      unitId?: string | undefined;
      sellerPartyId: string;
      buyerPartyId?: string | undefined;
      assignedToUserId?: string | undefined;
      askingPriceMinor: string;
      offerPriceMinor?: string | undefined;
      commissionMinor?: string | undefined;
      currency: CurrencyCode;
      expectedClosingOn?: string | undefined;
      notes?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const property = await transaction.query.properties.findFirst({
        where: and(
          eq(properties.id, input.propertyId),
          eq(properties.organizationId, claims.organizationId!),
        ),
      });
      if (!property) throw new NotFoundException('Property not found');
      const rows = await transaction
        .insert(salesDeals)
        .values({
          organizationId: claims.organizationId!,
          reference: reference('SAL'),
          propertyId: input.propertyId,
          unitId: input.unitId,
          sellerPartyId: input.sellerPartyId,
          buyerPartyId: input.buyerPartyId,
          assignedToUserId: input.assignedToUserId,
          askingPriceMinor: BigInt(input.askingPriceMinor),
          offerPriceMinor: input.offerPriceMinor ? BigInt(input.offerPriceMinor) : undefined,
          commissionMinor: BigInt(input.commissionMinor ?? '0'),
          currency: input.currency,
          minorUnit: currencyMinorUnits[input.currency],
          expectedClosingOn: input.expectedClosingOn,
          notes: input.notes,
        })
        .returning();
      const row = rows[0]!;
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'sales_deal',
        resourceId: row.id,
        eventType: 'sale.created',
        toStatus: row.status,
      });
      return {
        ...row,
        askingPriceMinor: row.askingPriceMinor.toString(),
        offerPriceMinor: row.offerPriceMinor?.toString() ?? null,
        agreedPriceMinor: row.agreedPriceMinor?.toString() ?? null,
        commissionMinor: row.commissionMinor.toString(),
      };
    });
  }

  updateSale(
    claims: SessionClaims,
    id: string,
    input: { status: SalesStatus; agreedPriceMinor?: string; note?: string },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const current = await transaction.query.salesDeals.findFirst({
        where: and(eq(salesDeals.id, id), eq(salesDeals.organizationId, claims.organizationId!)),
      });
      if (!current) throw new NotFoundException('Sales deal not found');
      assertTransition(current.status, input.status, salesTransitions);
      const rows = await transaction
        .update(salesDeals)
        .set({
          status: input.status,
          agreedPriceMinor: input.agreedPriceMinor
            ? BigInt(input.agreedPriceMinor)
            : current.agreedPriceMinor,
          closedOn: ['closed_won', 'closed_lost', 'cancelled'].includes(input.status)
            ? new Date().toISOString().slice(0, 10)
            : current.closedOn,
          updatedAt: new Date(),
        })
        .where(eq(salesDeals.id, id))
        .returning();

      if (input.status === 'closed_won') {
        await this.transferOwnershipOnClosedWon(transaction, claims, {
          dealId: id,
          propertyId: current.propertyId,
          unitId: current.unitId,
          sellerPartyId: current.sellerPartyId,
          buyerPartyId: current.buyerPartyId,
          closedOn: rows[0]!.closedOn ?? new Date().toISOString().slice(0, 10),
        });
      }

      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'sales_deal',
        resourceId: id,
        eventType: 'sale.status_changed',
        fromStatus: current.status,
        toStatus: input.status,
        note: input.note,
      });
      const row = rows[0]!;
      return {
        ...row,
        askingPriceMinor: row.askingPriceMinor.toString(),
        offerPriceMinor: row.offerPriceMinor?.toString() ?? null,
        agreedPriceMinor: row.agreedPriceMinor?.toString() ?? null,
        commissionMinor: row.commissionMinor.toString(),
      };
    });
  }

  /** Cycle v1.1 R4/R5: in-system ownership transfer + lease rights follow buyer. */
  private async transferOwnershipOnClosedWon(
    transaction: DatabaseTransaction,
    claims: SessionClaims,
    args: {
      dealId: string;
      propertyId: string;
      unitId: string | null;
      sellerPartyId: string;
      buyerPartyId: string | null;
      closedOn: string;
    },
  ) {
    if (!args.buyerPartyId) {
      throw new ConflictException('closed_won requires a buyer party for ownership transfer');
    }
    if (args.buyerPartyId === args.sellerPartyId) {
      throw new ConflictException('Buyer and seller must be different parties');
    }

    const property = await transaction.query.properties.findFirst({
      where: and(
        eq(properties.id, args.propertyId),
        eq(properties.organizationId, claims.organizationId!),
      ),
    });
    if (!property) throw new NotFoundException('Property not found for sales deal');

    const priorOwnerId = property.ownerPartyId;
    await transaction
      .update(properties)
      .set({ ownerPartyId: args.buyerPartyId, updatedAt: new Date() })
      .where(eq(properties.id, args.propertyId));

    const priorInterest = await transaction.query.propertyOwnershipInterests.findFirst({
      where: and(
        eq(propertyOwnershipInterests.organizationId, claims.organizationId!),
        eq(propertyOwnershipInterests.propertyId, args.propertyId),
        eq(propertyOwnershipInterests.partyId, priorOwnerId),
      ),
    });
    if (priorInterest) {
      await transaction
        .update(propertyOwnershipInterests)
        .set({ endsOn: args.closedOn, updatedAt: new Date() })
        .where(eq(propertyOwnershipInterests.id, priorInterest.id));
    } else {
      await transaction.insert(propertyOwnershipInterests).values({
        organizationId: claims.organizationId!,
        propertyId: args.propertyId,
        partyId: priorOwnerId,
        role: 'owner',
        shareBasisPoints: 10000,
        endsOn: args.closedOn,
      });
    }

    const buyerInterest = await transaction.query.propertyOwnershipInterests.findFirst({
      where: and(
        eq(propertyOwnershipInterests.organizationId, claims.organizationId!),
        eq(propertyOwnershipInterests.propertyId, args.propertyId),
        eq(propertyOwnershipInterests.partyId, args.buyerPartyId),
      ),
    });
    if (buyerInterest) {
      await transaction
        .update(propertyOwnershipInterests)
        .set({
          role: 'owner',
          shareBasisPoints: 10000,
          startsOn: args.closedOn,
          endsOn: null,
          updatedAt: new Date(),
        })
        .where(eq(propertyOwnershipInterests.id, buyerInterest.id));
    } else {
      await transaction.insert(propertyOwnershipInterests).values({
        organizationId: claims.organizationId!,
        propertyId: args.propertyId,
        partyId: args.buyerPartyId,
        role: 'owner',
        shareBasisPoints: 10000,
        startsOn: args.closedOn,
      });
    }

    // R5: active/draft leases on this property (or unit) follow the new owner.
    const openStatuses = ['draft', 'active', 'cancel_requested', 'clearance_pending'] as const;
    const affectedLeases = args.unitId
      ? await transaction
          .select({ id: leases.id, contractId: leases.contractId })
          .from(leases)
          .where(
            and(
              eq(leases.organizationId, claims.organizationId!),
              eq(leases.unitId, args.unitId),
              inArray(leases.status, [...openStatuses]),
            ),
          )
      : await transaction
          .select({ id: leases.id, contractId: leases.contractId })
          .from(leases)
          .innerJoin(units, eq(leases.unitId, units.id))
          .where(
            and(
              eq(leases.organizationId, claims.organizationId!),
              eq(units.propertyId, args.propertyId),
              inArray(leases.status, [...openStatuses]),
            ),
          );

    for (const lease of affectedLeases) {
      await transaction
        .update(leases)
        .set({ ownerPartyId: args.buyerPartyId, updatedAt: new Date() })
        .where(eq(leases.id, lease.id));
      if (lease.contractId) {
        await transaction
          .update(contracts)
          .set({ ownerPartyId: args.buyerPartyId, updatedAt: new Date() })
          .where(
            and(
              eq(contracts.id, lease.contractId),
              eq(contracts.organizationId, claims.organizationId!),
            ),
          );
      }
    }

    await appendWorkflowEvent(transaction, claims, {
      resourceType: 'property',
      resourceId: args.propertyId,
      eventType: 'property.ownership_transferred',
      fromStatus: priorOwnerId,
      toStatus: args.buyerPartyId,
      note: `Sale ${args.dealId}`,
      metadata: {
        dealId: args.dealId,
        priorOwnerPartyId: priorOwnerId,
        newOwnerPartyId: args.buyerPartyId,
        leasesTransferred: affectedLeases.map((row) => row.id),
      },
    });
  }

  listVendors(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(vendors)
        .where(eq(vendors.organizationId, claims.organizationId!))
        .orderBy(asc(vendors.name)),
    );
  }

  createVendor(
    claims: SessionClaims,
    input: {
      partyId?: string | undefined;
      code?: string | undefined;
      name: string;
      category: string;
      phone?: string | undefined;
      email?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .insert(vendors)
        .values({
          organizationId: claims.organizationId!,
          code: input.code ?? reference('VND'),
          partyId: input.partyId,
          name: input.name,
          category: input.category,
          phone: input.phone,
          email: input.email,
        })
        .returning();
      return rows[0]!;
    });
  }

  listWorkOrders(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select()
        .from(maintenanceWorkOrders)
        .where(eq(maintenanceWorkOrders.organizationId, claims.organizationId!))
        .orderBy(desc(maintenanceWorkOrders.createdAt));
      return rows.map((row) => ({
        ...row,
        estimateMinor: row.estimateMinor.toString(),
        approvedMinor: row.approvedMinor.toString(),
        actualMinor: row.actualMinor.toString(),
      }));
    });
  }

  createWorkOrder(
    claims: SessionClaims,
    input: {
      ticketId: string;
      vendorId?: string | undefined;
      assignedToUserId?: string | undefined;
      scope: string;
      scheduledAt?: string | undefined;
      estimateMinor?: string | undefined;
      currency: CurrencyCode;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const ticket = await transaction.query.maintenanceTickets.findFirst({
        where: and(
          eq(maintenanceTickets.id, input.ticketId),
          eq(maintenanceTickets.organizationId, claims.organizationId!),
        ),
      });
      if (!ticket) throw new NotFoundException('Maintenance ticket not found');
      const rows = await transaction
        .insert(maintenanceWorkOrders)
        .values({
          organizationId: claims.organizationId!,
          reference: reference('WO'),
          ticketId: input.ticketId,
          vendorId: input.vendorId,
          assignedToUserId: input.assignedToUserId,
          scope: input.scope,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
          estimateMinor: BigInt(input.estimateMinor ?? '0'),
          currency: input.currency,
          minorUnit: currencyMinorUnits[input.currency],
        })
        .returning();
      const row = rows[0]!;
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'maintenance_work_order',
        resourceId: row.id,
        eventType: 'work_order.created',
        toStatus: row.status,
      });
      return {
        ...row,
        estimateMinor: row.estimateMinor.toString(),
        approvedMinor: row.approvedMinor.toString(),
        actualMinor: row.actualMinor.toString(),
      };
    });
  }

  updateWorkOrder(
    claims: SessionClaims,
    id: string,
    input: {
      status: WorkOrderStatus;
      approvedMinor?: string | undefined;
      actualMinor?: string | undefined;
      completionNotes?: string | undefined;
      note?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const current = await transaction.query.maintenanceWorkOrders.findFirst({
        where: and(
          eq(maintenanceWorkOrders.id, id),
          eq(maintenanceWorkOrders.organizationId, claims.organizationId!),
        ),
      });
      if (!current) throw new NotFoundException('Work order not found');
      if (
        current.status === 'awaiting_approval' &&
        (input.status === 'approved' || input.status === 'quoted')
      ) {
        throw new ConflictException('Use the approval center to decide this work order');
      }
      assertTransition(current.status, input.status, workOrderTransitions);
      const rows = await transaction
        .update(maintenanceWorkOrders)
        .set({
          status: input.status,
          approvedMinor: input.approvedMinor ? BigInt(input.approvedMinor) : current.approvedMinor,
          actualMinor: input.actualMinor ? BigInt(input.actualMinor) : current.actualMinor,
          completionNotes: input.completionNotes ?? current.completionNotes,
          completedAt: ['completed', 'verified'].includes(input.status)
            ? (current.completedAt ?? new Date())
            : current.completedAt,
          verifiedAt: input.status === 'verified' ? new Date() : current.verifiedAt,
          updatedAt: new Date(),
        })
        .where(eq(maintenanceWorkOrders.id, id))
        .returning();
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'maintenance_work_order',
        resourceId: id,
        eventType: 'work_order.status_changed',
        fromStatus: current.status,
        toStatus: input.status,
        note: input.note,
      });
      const row = rows[0]!;
      if (input.status === 'awaiting_approval' && current.status !== 'awaiting_approval') {
        await transaction.insert(approvalRequests).values({
          organizationId: claims.organizationId!,
          reference: reference('APR-WO'),
          type: 'maintenance_work_order_approval',
          subject: `Work order ${row.reference}`,
          resourceType: 'maintenance_work_order',
          resourceId: row.id,
          requestedByUserId: claims.sub,
        });
        await emitOutbox(
          transaction,
          claims,
          'approval.requested',
          'maintenance_work_order',
          row.id,
          { reference: row.reference },
        );
      }
      return {
        ...row,
        estimateMinor: row.estimateMinor.toString(),
        approvedMinor: row.approvedMinor.toString(),
        actualMinor: row.actualMinor.toString(),
      };
    });
  }

  listLegalCases(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select()
        .from(legalCases)
        .where(eq(legalCases.organizationId, claims.organizationId!))
        .orderBy(desc(legalCases.createdAt));
      return rows.map((row) => ({
        ...row,
        claimAmountMinor: row.claimAmountMinor.toString(),
        recoveredAmountMinor: row.recoveredAmountMinor.toString(),
      }));
    });
  }

  createLegalCase(
    claims: SessionClaims,
    input: {
      caseNumber?: string | undefined;
      caseType: string;
      title: string;
      description?: string | undefined;
      propertyId?: string | undefined;
      unitId?: string | undefined;
      leaseId?: string | undefined;
      counterpartyId?: string | undefined;
      lawyerPartyId?: string | undefined;
      assignedToUserId?: string | undefined;
      court?: string | undefined;
      claimAmountMinor?: string | undefined;
      currency: CurrencyCode;
      openedOn: string;
      nextHearingAt?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .insert(legalCases)
        .values({
          organizationId: claims.organizationId!,
          reference: reference('LEG'),
          ...input,
          claimAmountMinor: BigInt(input.claimAmountMinor ?? '0'),
          minorUnit: currencyMinorUnits[input.currency],
          nextHearingAt: input.nextHearingAt ? new Date(input.nextHearingAt) : undefined,
        })
        .returning();
      const row = rows[0]!;
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'legal_case',
        resourceId: row.id,
        eventType: 'legal_case.created',
        toStatus: row.status,
      });
      return {
        ...row,
        claimAmountMinor: row.claimAmountMinor.toString(),
        recoveredAmountMinor: row.recoveredAmountMinor.toString(),
      };
    });
  }

  updateLegalCase(
    claims: SessionClaims,
    id: string,
    input: { status: LegalStatus; recoveredAmountMinor?: string; note?: string },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const current = await transaction.query.legalCases.findFirst({
        where: and(eq(legalCases.id, id), eq(legalCases.organizationId, claims.organizationId!)),
      });
      if (!current) throw new NotFoundException('Legal case not found');
      assertTransition(current.status, input.status, legalTransitions);
      const rows = await transaction
        .update(legalCases)
        .set({
          status: input.status,
          recoveredAmountMinor: input.recoveredAmountMinor
            ? BigInt(input.recoveredAmountMinor)
            : current.recoveredAmountMinor,
          closedOn: ['closed', 'cancelled'].includes(input.status)
            ? new Date().toISOString().slice(0, 10)
            : current.closedOn,
          updatedAt: new Date(),
        })
        .where(eq(legalCases.id, id))
        .returning();
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'legal_case',
        resourceId: id,
        eventType: 'legal_case.status_changed',
        fromStatus: current.status,
        toStatus: input.status,
        note: input.note,
      });
      const row = rows[0]!;
      return {
        ...row,
        claimAmountMinor: row.claimAmountMinor.toString(),
        recoveredAmountMinor: row.recoveredAmountMinor.toString(),
      };
    });
  }

  listLegalEvents(claims: SessionClaims, caseId: string) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(legalEvents)
        .where(
          and(
            eq(legalEvents.legalCaseId, caseId),
            eq(legalEvents.organizationId, claims.organizationId!),
          ),
        )
        .orderBy(desc(legalEvents.occurredAt)),
    );
  }

  addLegalEvent(
    claims: SessionClaims,
    caseId: string,
    input: {
      type: string;
      title: string;
      notes?: string | undefined;
      occurredAt?: string | undefined;
      deadlineAt?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const legalCase = await transaction.query.legalCases.findFirst({
        where: and(
          eq(legalCases.id, caseId),
          eq(legalCases.organizationId, claims.organizationId!),
        ),
      });
      if (!legalCase) throw new NotFoundException('Legal case not found');
      const rows = await transaction
        .insert(legalEvents)
        .values({
          organizationId: claims.organizationId!,
          legalCaseId: caseId,
          createdByUserId: claims.sub,
          ...input,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : undefined,
        })
        .returning();
      return rows[0]!;
    });
  }

  listApprovals(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.organizationId, claims.organizationId!))
        .orderBy(desc(approvalRequests.createdAt)),
    );
  }

  decideApproval(
    claims: SessionClaims,
    id: string,
    input: { decision: 'approved' | 'rejected'; note?: string },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const current = await transaction.query.approvalRequests.findFirst({
        where: and(
          eq(approvalRequests.id, id),
          eq(approvalRequests.organizationId, claims.organizationId!),
        ),
      });
      if (!current) throw new NotFoundException('Approval request not found');
      if (current.status !== 'pending') throw new ConflictException('Approval already decided');
      const rows = await transaction
        .update(approvalRequests)
        .set({
          status: input.decision,
          assignedToUserId: claims.sub,
          decisionNote: input.note,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(approvalRequests.id, id))
        .returning();
      await appendWorkflowEvent(transaction, claims, {
        resourceType: 'approval_request',
        resourceId: id,
        eventType: 'approval.decided',
        fromStatus: current.status,
        toStatus: input.decision,
        note: input.note,
      });
      if (
        input.decision === 'approved' &&
        current.resourceType === 'contract' &&
        current.type.startsWith('contract_approval')
      ) {
        const siblings = await transaction
          .select()
          .from(approvalRequests)
          .where(
            and(
              eq(approvalRequests.organizationId, claims.organizationId!),
              eq(approvalRequests.resourceType, 'contract'),
              eq(approvalRequests.resourceId, current.resourceId),
            ),
          )
          .orderBy(asc(approvalRequests.createdAt));
        const currentIndex = siblings.findIndex((row) => row.id === id);
        const next = currentIndex >= 0 ? siblings[currentIndex + 1] : undefined;
        if (next && next.status === 'on_hold') {
          await transaction
            .update(approvalRequests)
            .set({ status: 'pending', updatedAt: new Date() })
            .where(eq(approvalRequests.id, next.id));
          await appendWorkflowEvent(transaction, claims, {
            resourceType: 'approval_request',
            resourceId: next.id,
            eventType: 'approval.unlocked',
            fromStatus: 'on_hold',
            toStatus: 'pending',
            note: `Unlocked after ${current.type}`,
          });
        }
      }
      if (current.resourceType === 'maintenance_work_order') {
        const targetStatus = input.decision === 'approved' ? 'approved' : 'quoted';
        const workOrders = await transaction
          .update(maintenanceWorkOrders)
          .set({
            status: targetStatus,
            approvedMinor:
              input.decision === 'approved'
                ? sql`GREATEST(${maintenanceWorkOrders.approvedMinor}, ${maintenanceWorkOrders.estimateMinor})`
                : maintenanceWorkOrders.approvedMinor,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(maintenanceWorkOrders.id, current.resourceId),
              eq(maintenanceWorkOrders.organizationId, claims.organizationId!),
              eq(maintenanceWorkOrders.status, 'awaiting_approval'),
            ),
          )
          .returning({ id: maintenanceWorkOrders.id });
        if (!workOrders[0]) throw new ConflictException('Approval target is no longer pending');
        await appendWorkflowEvent(transaction, claims, {
          resourceType: current.resourceType,
          resourceId: current.resourceId,
          eventType: 'work_order.approval_decided',
          fromStatus: 'awaiting_approval',
          toStatus: targetStatus,
          note: input.note,
        });
      } else if (current.resourceType === 'expense') {
        const targetStatus = input.decision;
        const expenseRows = await transaction
          .update(expenses)
          .set({ status: targetStatus, updatedAt: new Date() })
          .where(
            and(
              eq(expenses.id, current.resourceId),
              eq(expenses.organizationId, claims.organizationId!),
              eq(expenses.status, 'pending'),
            ),
          )
          .returning({ id: expenses.id });
        if (!expenseRows[0]) throw new ConflictException('Approval target is no longer pending');
        await appendWorkflowEvent(transaction, claims, {
          resourceType: current.resourceType,
          resourceId: current.resourceId,
          eventType: 'expense.approval_decided',
          fromStatus: 'pending',
          toStatus: targetStatus,
          note: input.note,
        });
      } else {
        await appendWorkflowEvent(transaction, claims, {
          resourceType: current.resourceType,
          resourceId: current.resourceId,
          eventType: 'resource.approval_decided',
          toStatus: input.decision,
          note: input.note,
        });
      }
      await emitOutbox(
        transaction,
        claims,
        'approval.decided',
        current.resourceType,
        current.resourceId,
        { approvalId: current.id, decision: input.decision },
      );
      return rows[0]!;
    });
  }

  timeline(claims: SessionClaims, resourceType: string, resourceId: string) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(workflowEvents)
        .where(
          and(
            eq(workflowEvents.organizationId, claims.organizationId!),
            eq(workflowEvents.resourceType, resourceType),
            eq(workflowEvents.resourceId, resourceId),
          ),
        )
        .orderBy(desc(workflowEvents.occurredAt)),
    );
  }

  async ensureSalesTotals(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select({
          currency: salesDeals.currency,
          pipelineMinor: sql<string>`coalesce(sum(coalesce(${salesDeals.agreedPriceMinor}, ${salesDeals.offerPriceMinor}, ${salesDeals.askingPriceMinor}, 0)), 0)`,
        })
        .from(salesDeals)
        .where(eq(salesDeals.organizationId, claims.organizationId!))
        .groupBy(salesDeals.currency);
      return { totals: rows };
    });
  }
}
