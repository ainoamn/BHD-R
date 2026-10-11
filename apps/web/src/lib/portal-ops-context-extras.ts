import 'server-only';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  contractTemplates,
  expenses,
  invoices,
  leases,
  ledgerAccounts,
  legalCases,
  maintenanceTickets,
  memberships,
  reservations,
  users,
  vendors,
  workTasks,
  type Database,
} from '@bhd-r/db';

type OpsTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const CONTEXT_ROW_LIMIT = 500;

/**
 * Form options that Nest `/v1/operations/context` adds on top of properties/units/parties.
 * Runs inside the caller's tenant transaction so every query shares one connection.
 */
export async function loadOpsContextExtras(
  transaction: OpsTransaction,
  orgId: string,
): Promise<Record<string, unknown>> {
  const [
    userRows,
    vendorRows,
    ticketRows,
    leaseRows,
    invoiceRows,
    templateRows,
    reservationRows,
    accountRows,
    vacancyCounts,
  ] = await Promise.all([
    transaction
      .selectDistinct({ id: users.id, name: users.displayName })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(eq(memberships.organizationId, orgId))
      .orderBy(asc(users.displayName)),
    transaction
      .select({ id: vendors.id, code: vendors.code, name: vendors.name })
      .from(vendors)
      .where(eq(vendors.organizationId, orgId))
      .orderBy(asc(vendors.name))
      .limit(CONTEXT_ROW_LIMIT),
    transaction
      .select({ id: maintenanceTickets.id, title: maintenanceTickets.title })
      .from(maintenanceTickets)
      .where(eq(maintenanceTickets.organizationId, orgId))
      .orderBy(desc(maintenanceTickets.createdAt))
      .limit(CONTEXT_ROW_LIMIT),
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
      .where(eq(leases.organizationId, orgId))
      .orderBy(desc(leases.createdAt))
      .limit(CONTEXT_ROW_LIMIT),
    transaction
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        currency: invoices.currency,
        outstandingMinor: sql<string>`(${invoices.totalMinor} - ${invoices.paidMinor})::text`,
        status: invoices.status,
      })
      .from(invoices)
      .where(eq(invoices.organizationId, orgId))
      .orderBy(desc(invoices.createdAt))
      .limit(CONTEXT_ROW_LIMIT),
    transaction
      .select({
        id: contractTemplates.id,
        key: contractTemplates.key,
        version: contractTemplates.version,
        language: contractTemplates.language,
      })
      .from(contractTemplates)
      .where(and(eq(contractTemplates.organizationId, orgId), eq(contractTemplates.active, true)))
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
          eq(reservations.organizationId, orgId),
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
      .where(eq(ledgerAccounts.organizationId, orgId))
      .orderBy(asc(ledgerAccounts.code)),
    Promise.all([
      transaction
        .select({ value: count() })
        .from(workTasks)
        .where(
          and(
            eq(workTasks.organizationId, orgId),
            eq(workTasks.relatedType, 'lease_vacancy'),
            inArray(workTasks.status, ['pending', 'approved', 'in_progress', 'on_hold']),
          ),
        ),
      transaction
        .select({ value: count() })
        .from(maintenanceTickets)
        .where(
          and(
            eq(maintenanceTickets.organizationId, orgId),
            eq(maintenanceTickets.category, 'vacancy_handover'),
            inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress']),
          ),
        ),
      transaction
        .select({ value: count() })
        .from(legalCases)
        .where(
          and(
            eq(legalCases.organizationId, orgId),
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
            eq(expenses.organizationId, orgId),
            eq(expenses.category, 'vacancy_settlement'),
            inArray(expenses.status, ['draft', 'pending', 'approved', 'in_progress', 'on_hold']),
          ),
        ),
    ]),
  ]);

  const leaseItems = leaseRows.map((row) => ({
    ...row,
    rentMinor: row.rentMinor.toString(),
    depositMinor: row.depositMinor?.toString() ?? null,
  }));
  const labelled = (rows: typeof leaseItems, label: string) =>
    rows.map((row) => ({ ...row, name: `${row.id.slice(0, 8)} · ${label}` }));
  const [vacancyTasks, vacancyMaintenance, vacancyLegal, vacancyExpenses] = vacancyCounts;

  return {
    users: userRows,
    vendors: vendorRows,
    maintenanceTickets: ticketRows,
    leases: leaseItems,
    cancelRequestedLeases: labelled(
      leaseItems.filter((row) => row.status === 'cancel_requested'),
      'cancel requested',
    ),
    clearancePendingLeases: labelled(
      leaseItems.filter((row) => row.status === 'clearance_pending'),
      'clearance pending',
    ),
    renewalPendingLeases: labelled(
      leaseItems.filter((row) => Boolean(row.renewalPendingContractId)),
      'renewal pending clearance',
    ),
    invoices: invoiceRows,
    contractTemplates: templateRows,
    reservations: reservationRows.map((row) => ({
      ...row,
      name: `${row.id.slice(0, 8)} · ${row.status}`,
    })),
    pendingDepositReservations: reservationRows
      .filter((row) => row.status === 'pending')
      .map((row) => ({ ...row, name: `${row.id.slice(0, 8)} · pending deposit` })),
    confirmedReservations: reservationRows
      .filter((row) => row.status === 'confirmed')
      .map((row) => ({ ...row, name: `${row.id.slice(0, 8)} · confirmed` })),
    ledgerAccounts: accountRows,
    vacancyFollowUps: {
      tasks: Number(vacancyTasks[0]?.value ?? 0),
      maintenance: Number(vacancyMaintenance[0]?.value ?? 0),
      legal: Number(vacancyLegal[0]?.value ?? 0),
      expenses: Number(vacancyExpenses[0]?.value ?? 0),
    },
  };
}
