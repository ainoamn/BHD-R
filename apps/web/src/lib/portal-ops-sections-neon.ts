import 'server-only';
import { and, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  cheques,
  contracts,
  expenses,
  holds,
  invoices,
  journalEntries,
  journalLines,
  leases,
  ledgerAccounts,
  legalCases,
  maintenanceWorkOrders,
  memberships,
  operationalRequests,
  parties,
  payments,
  properties,
  receipts,
  reportJobs,
  reservations,
  salesDeals,
  units,
  users,
  viewingRequests,
  workTasks,
  type Database,
} from '@bhd-r/db';

const ownerParties = alias(parties, 'lease_owner_parties');
const tenantParties = alias(parties, 'lease_tenant_parties');
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { contractCategory, contractTerm, propertyUsage } from '@/lib/contract-list-facets';
import { ownerPartyScope, readClaims, withinViewerTenant } from '@/lib/portal-ops-data';
import { loadStayIncomeRowsForViewer } from '@/lib/stay-deposit-ledger-neon';
import type { OperationsSection } from '@/lib/portal-ops-types';
import type { PortalRole } from '@/lib/types';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { loadStayBookingOpsRows, tagLeaseBookingPurpose } from '@/lib/unified-bookings';

type DataRow = Record<string, unknown>;
type OpsTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Permission = Parameters<typeof hasPermission>[1];

export type NeonSectionLoad = {
  records: DataRow[];
  summary?: Record<string, unknown>;
  secondary?: DataRow[];
  contextPatch?: Record<string, unknown>;
};

/** Bookings list is painted often — keep the row cap tight for first byte. */
const BOOKINGS_LIMIT = 120;
const LIST_LIMIT = 300;
const SECTION_CAP_MS = 8_000;
/** Bookings must answer from Neon quickly; fall through only if the DB is wedged. */
const BOOKINGS_CAP_MS = 2_500;

/** Same wire shape Nest sends: bigint → string, timestamps → ISO. */
function jsonSafe(row: object): DataRow {
  const out: DataRow = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] =
      typeof value === 'bigint'
        ? value.toString()
        : value instanceof Date
          ? value.toISOString()
          : (value as unknown);
  }
  return out;
}

function none<T>(): Promise<T[]> {
  return Promise.resolve([]);
}

async function moneyTotals(transaction: OpsTransaction, orgId: string) {
  return Promise.all([
    transaction
      .select({
        currency: invoices.currency,
        value: sql<string>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor}), 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, orgId),
          inArray(invoices.status, ['issued', 'partially_paid', 'overdue']),
        ),
      )
      .groupBy(invoices.currency),
    transaction
      .select({
        currency: expenses.currency,
        value: sql<string>`coalesce(sum(${expenses.amountMinor} + ${expenses.taxMinor}), 0)::text`,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.organizationId, orgId),
          inArray(expenses.status, ['approved', 'in_progress', 'completed']),
        ),
      )
      .groupBy(expenses.currency),
  ]);
}

async function loadRequests(tx: OpsTransaction, orgId: string): Promise<NeonSectionLoad> {
  const rows = await tx
    .select()
    .from(operationalRequests)
    .where(eq(operationalRequests.organizationId, orgId))
    .orderBy(desc(operationalRequests.createdAt))
    .limit(LIST_LIMIT);
  return { records: rows.map(jsonSafe) };
}

async function scopedUnitIds(
  tx: OpsTransaction,
  orgId: string,
  ownerPartyId: string | null,
): Promise<string[] | null> {
  if (!ownerPartyId) return null;
  const rows = await tx
    .select({ id: units.id })
    .from(units)
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(units.organizationId, orgId), eq(properties.ownerPartyId, ownerPartyId)));
  return rows.map((row) => row.id);
}

async function loadLeaseBookings(
  tx: OpsTransaction,
  orgId: string,
  can: (permission: Permission) => boolean,
  ownerPartyId: string | null,
): Promise<DataRow[]> {
  const unitIds = await scopedUnitIds(tx, orgId, ownerPartyId);
  if (unitIds && !unitIds.length) return [];
  const scopeUnits = unitIds ? [inArray(reservations.unitId, unitIds)] : [];
  const scopeViewings = unitIds ? [inArray(viewingRequests.unitId, unitIds)] : [];
  const scopeHolds = unitIds ? [inArray(holds.unitId, unitIds)] : [];

  const [reservationRows, viewingRows, holdRows] = await Promise.all([
    can('reservation.read')
      ? tx
          .select()
          .from(reservations)
          .where(and(eq(reservations.organizationId, orgId), ...scopeUnits))
          .orderBy(desc(reservations.createdAt))
          .limit(BOOKINGS_LIMIT)
      : none<typeof reservations.$inferSelect>(),
    can('viewing.read')
      ? tx
          .select()
          .from(viewingRequests)
          .where(and(eq(viewingRequests.organizationId, orgId), ...scopeViewings))
          .orderBy(desc(viewingRequests.createdAt))
          .limit(BOOKINGS_LIMIT)
      : none<typeof viewingRequests.$inferSelect>(),
    can('reservation.read')
      ? tx
          .select()
          .from(holds)
          .where(and(eq(holds.organizationId, orgId), ...scopeHolds))
          .orderBy(desc(holds.createdAt))
          .limit(BOOKINGS_LIMIT)
      : none<typeof holds.$inferSelect>(),
  ]);
  return [
    ...reservationRows.map((row) =>
      tagLeaseBookingPurpose({ ...jsonSafe(row), recordKind: 'reservation' }),
    ),
    ...viewingRows.map((row) =>
      tagLeaseBookingPurpose({ ...jsonSafe(row), recordKind: 'viewing' }),
    ),
    ...holdRows.map((row) => tagLeaseBookingPurpose({ ...jsonSafe(row), recordKind: 'hold' })),
  ];
}

async function loadLeasing(tx: OpsTransaction, orgId: string): Promise<NeonSectionLoad> {
  try {
    const { repairOpenStayLeasesAfterCheckoutInTx } = await import(
      '@/lib/stay-contract-close-neon'
    );
    await repairOpenStayLeasesAfterCheckoutInTx(tx, orgId);
  } catch (error) {
    console.error('stay lease checkout repair (leasing)', error);
  }
  const snapshot = contracts.payloadSnapshot;
  const rows = await tx
    .select({
      id: leases.id,
      organizationId: leases.organizationId,
      contractId: leases.contractId,
      /** Same human reference as /owner/contracts (not the lease UUID). */
      reference: contracts.reference,
      unitId: leases.unitId,
      ownerPartyId: leases.ownerPartyId,
      tenantPartyId: leases.tenantPartyId,
      status: leases.status,
      startsOn: leases.startsOn,
      endsOn: leases.endsOn,
      rentMinor: leases.rentMinor,
      depositMinor: leases.depositMinor,
      currency: leases.currency,
      exitKind: leases.exitKind,
      cancellationEffectiveOn: leases.cancellationEffectiveOn,
      cancellationClearedAt: leases.cancellationClearedAt,
      createdAt: leases.createdAt,
      updatedAt: leases.updatedAt,
      contractStatus: contracts.status,
      propertyId: units.propertyId,
      propertyNameAr: properties.nameAr,
      propertyNameEn: properties.nameEn,
      unitCode: units.code,
      unitNameAr: units.nameAr,
      unitNameEn: units.nameEn,
      ownerName: ownerParties.displayName,
      tenantName: sql<string | null>`coalesce(
        ${tenantParties.displayName},
        ${snapshot}->'tenant'->>'displayName'
      )`,
      sourceType: sql<string | null>`${snapshot}->'source'->>'type'`,
      linkedBookingStatus: sql<string | null>`(
        select b.status from stay_bookings b
        where b.organization_id = ${orgId}
          and b.id::text = ${snapshot}->'source'->>'stayBookingId'
        limit 1
      )`,
    })
    .from(leases)
    .leftJoin(
      contracts,
      and(eq(contracts.id, leases.contractId), eq(contracts.organizationId, orgId)),
    )
    .leftJoin(units, and(eq(units.id, leases.unitId), eq(units.organizationId, orgId)))
    .leftJoin(
      properties,
      and(eq(properties.id, units.propertyId), eq(properties.organizationId, orgId)),
    )
    .leftJoin(
      ownerParties,
      and(eq(ownerParties.id, leases.ownerPartyId), eq(ownerParties.organizationId, orgId)),
    )
    .leftJoin(
      tenantParties,
      and(eq(tenantParties.id, leases.tenantPartyId), eq(tenantParties.organizationId, orgId)),
    )
    .where(eq(leases.organizationId, orgId))
    .orderBy(desc(leases.createdAt))
    .limit(LIST_LIMIT);
  return { records: rows.map(jsonSafe) };
}

async function loadSales(tx: OpsTransaction, orgId: string): Promise<NeonSectionLoad> {
  const [rows, totals] = await Promise.all([
    tx
      .select()
      .from(salesDeals)
      .where(eq(salesDeals.organizationId, orgId))
      .orderBy(desc(salesDeals.createdAt))
      .limit(LIST_LIMIT),
    tx
      .select({
        currency: salesDeals.currency,
        pipelineMinor: sql<string>`coalesce(sum(coalesce(${salesDeals.agreedPriceMinor}, ${salesDeals.offerPriceMinor}, ${salesDeals.askingPriceMinor}, 0)), 0)::text`,
      })
      .from(salesDeals)
      .where(eq(salesDeals.organizationId, orgId))
      .groupBy(salesDeals.currency),
  ]);
  return { records: rows.map(jsonSafe), summary: { totals } };
}

async function loadContracts(tx: OpsTransaction, orgId: string): Promise<NeonSectionLoad> {
  const { repairChildContractReferencesInTx } = await import('@/lib/contract-reference-neon');
  await repairChildContractReferencesInTx(tx, orgId).catch((error: unknown) => {
    console.error('repair child contract references failed', error);
  });
  const snapshot = contracts.payloadSnapshot;
  const rows = await tx
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
      propertyId: units.propertyId,
      propertyNameAr: properties.nameAr,
      propertyNameEn: properties.nameEn,
      unitCode: units.code,
      unitNameAr: units.nameAr,
      unitNameEn: units.nameEn,
      category: properties.category,
      tenantName: sql<string | null>`coalesce(
        ${parties.displayName},
        ${snapshot}->'tenant'->>'displayName',
        ${snapshot}->'buyer'->>'displayName'
      )`,
      contractType: sql<string | null>`${snapshot}->'contract'->>'type'`,
      sourceType: sql<string | null>`${snapshot}->'source'->>'type'`,
      stayType: sql<string | null>`${snapshot}->>'stayType'`,
      usageType: sql<string | null>`${snapshot}->'leaseTerms'->>'usageType'`,
      startsOn: sql<string | null>`coalesce(
        ${snapshot}->>'startsOn',
        (select l.starts_on::text from leases l
          where l.organization_id = ${contracts.organizationId}
            and l.contract_id = ${contracts.id}
          limit 1)
      )`,
      endsOn: sql<string | null>`coalesce(
        ${snapshot}->>'endsOn',
        (select l.ends_on::text from leases l
          where l.organization_id = ${contracts.organizationId}
            and l.contract_id = ${contracts.id}
          limit 1)
      )`,
      signedAt: sql<string | null>`to_json(coalesce(
        (select max(cs.signed_at) from contract_signatures cs
          where cs.organization_id = ${contracts.organizationId}
            and cs.contract_id = ${contracts.id}),
        ${contracts.completedAt}
      )) #>> '{}'`,
      // A stay's booking outranks the lease row issued with it (that lease stays active).
      linkedStatus: sql<string | null>`coalesce(
        (select b.status from stay_bookings b
          where b.organization_id = ${contracts.organizationId}
            and b.id::text = ${snapshot}->'source'->>'stayBookingId'
          limit 1),
        (select l.status::text from leases l
          where l.organization_id = ${contracts.organizationId}
            and l.contract_id = ${contracts.id}
          limit 1)
      )`,
      approvalStatus: sql<string | null>`(
        select ar.status::text
        from approval_requests ar
        where ar.organization_id = ${contracts.organizationId}
          and ar.resource_type = 'contract'
          and ar.resource_id = ${contracts.id}
        order by ar.created_at desc
        limit 1
      )`,
    })
    .from(contracts)
    .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.organizationId, orgId)))
    .leftJoin(
      properties,
      and(eq(properties.id, units.propertyId), eq(properties.organizationId, orgId)),
    )
    .leftJoin(
      parties,
      and(eq(parties.id, contracts.tenantPartyId), eq(parties.organizationId, orgId)),
    )
    .where(eq(contracts.organizationId, orgId))
    .orderBy(desc(contracts.createdAt))
    .limit(LIST_LIMIT);
  const categories = new Map(rows.map((row) => [row.id, contractCategory(row)]));
  return {
    records: rows.map((row) => {
      const { contractType, sourceType, stayType, usageType, category, ...rest } = row;
      const startsOn = row.startsOn?.slice(0, 10) ?? null;
      const endsOn = row.endsOn?.slice(0, 10) ?? null;
      return jsonSafe({
        ...rest,
        startsOn,
        endsOn,
        signedAt: row.signedAt ? new Date(row.signedAt).toISOString() : null,
        term: contractTerm({ contractType, sourceType, stayType, startsOn, endsOn }),
        usage: propertyUsage({ usageType, category }),
        // Addenda belong to the list of the contract they amend.
        category:
          (row.parentContractId && categories.get(row.parentContractId)) ?? categories.get(row.id),
      });
    }),
  };
}

async function loadPayments(
  tx: OpsTransaction,
  orgId: string,
  can: (permission: Permission) => boolean,
): Promise<NeonSectionLoad> {
  const [paymentRows, receiptRows] = await Promise.all([
    can('payment.read')
      ? tx
          .select()
          .from(payments)
          .where(eq(payments.organizationId, orgId))
          .orderBy(desc(payments.createdAt))
          .limit(LIST_LIMIT)
      : none<typeof payments.$inferSelect>(),
    can('receipt.read')
      ? tx
          .select({
            id: receipts.id,
            paymentId: receipts.paymentId,
            receiptNumber: receipts.receiptNumber,
            amountMinor: receipts.amountMinor,
            currency: receipts.currency,
            issuedAt: receipts.issuedAt,
            renderedPdfObjectKey: receipts.renderedPdfObjectKey,
            renderedPdfHash: receipts.renderedPdfHash,
          })
          .from(receipts)
          .where(eq(receipts.organizationId, orgId))
          .orderBy(desc(receipts.issuedAt))
          .limit(LIST_LIMIT)
      : none<{
          id: string;
          paymentId: string;
          receiptNumber: string;
          amountMinor: bigint;
          currency: string;
          issuedAt: Date;
          renderedPdfObjectKey: string | null;
          renderedPdfHash: string | null;
        }>(),
  ]);
  return {
    records: [
      ...paymentRows.map((row) => ({ ...jsonSafe(row), recordKind: 'payment' })),
      ...receiptRows.map((row) => ({
        id: row.id,
        paymentId: row.paymentId,
        receiptNumber: row.receiptNumber,
        amountMinor: row.amountMinor.toString(),
        currency: row.currency,
        issuedAt: row.issuedAt.toISOString(),
        documentReady: Boolean(row.renderedPdfObjectKey && row.renderedPdfHash),
        documentHash: row.renderedPdfHash,
        recordKind: 'receipt',
        status: 'issued',
      })),
    ],
  };
}

async function loadAccounting(
  tx: OpsTransaction,
  orgId: string,
  can: (permission: Permission) => boolean,
): Promise<Omit<NeonSectionLoad, 'records'> & { journals: DataRow[] }> {
  const canAccounting = can('accounting.read');
  const [entryRows, chequeRows, invoiceRows, accountRows, collected, drafts, overdue, totals] =
    await Promise.all([
      canAccounting
        ? tx
            .select({
              id: journalEntries.id,
              reference: journalEntries.reference,
              occurredOn: journalEntries.occurredOn,
              description: journalEntries.description,
              status: journalEntries.status,
              sourceType: journalEntries.sourceType,
              sourceId: journalEntries.sourceId,
              postedAt: journalEntries.postedAt,
              createdAt: journalEntries.createdAt,
            })
            .from(journalEntries)
            .where(eq(journalEntries.organizationId, orgId))
            .orderBy(desc(journalEntries.occurredOn), desc(journalEntries.createdAt))
            .limit(LIST_LIMIT)
        : none<{
            id: string;
            reference: string;
            occurredOn: string;
            description: string;
            status: string;
            sourceType: string | null;
            sourceId: string | null;
            postedAt: Date | null;
            createdAt: Date;
          }>(),
      can('cheque.read')
        ? tx
            .select()
            .from(cheques)
            .where(eq(cheques.organizationId, orgId))
            .orderBy(cheques.dueOn)
            .limit(LIST_LIMIT)
        : none<typeof cheques.$inferSelect>(),
      can('invoice.read')
        ? tx
            .select({
              id: invoices.id,
              invoiceNumber: invoices.invoiceNumber,
              status: invoices.status,
              currency: invoices.currency,
              totalMinor: invoices.totalMinor,
              paidMinor: invoices.paidMinor,
              issuedOn: invoices.issuedOn,
              dueOn: invoices.dueOn,
              leaseId: invoices.leaseId,
              tenantPartyId: invoices.tenantPartyId,
              createdAt: invoices.createdAt,
            })
            .from(invoices)
            .where(and(eq(invoices.organizationId, orgId), isNotNull(invoices.leaseId)))
            .orderBy(desc(invoices.createdAt))
            .limit(LIST_LIMIT)
        : none<DataRow>(),
      canAccounting
        ? tx
            .select({
              id: ledgerAccounts.id,
              createdAt: ledgerAccounts.createdAt,
              updatedAt: ledgerAccounts.updatedAt,
              organizationId: ledgerAccounts.organizationId,
              parentId: ledgerAccounts.parentId,
              code: ledgerAccounts.code,
              nameAr: ledgerAccounts.nameAr,
              nameEn: ledgerAccounts.nameEn,
              type: ledgerAccounts.type,
              currency: ledgerAccounts.currency,
              active: ledgerAccounts.active,
              system: ledgerAccounts.system,
            })
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.organizationId, orgId))
            .orderBy(ledgerAccounts.code)
        : none<DataRow>(),
      canAccounting
        ? tx
            .select({
              currency: payments.currency,
              value: sql<string>`coalesce(sum(${payments.amountMinor} - ${payments.refundedMinor}), 0)::text`,
            })
            .from(payments)
            .where(
              and(
                eq(payments.organizationId, orgId),
                inArray(payments.status, ['succeeded', 'partially_refunded', 'refunded']),
              ),
            )
            .groupBy(payments.currency)
        : none<{ currency: string; value: string }>(),
      canAccounting
        ? tx
            .select({ value: count() })
            .from(journalEntries)
            .where(
              and(eq(journalEntries.organizationId, orgId), eq(journalEntries.status, 'draft')),
            )
        : none<{ value: number }>(),
      canAccounting
        ? tx
            .select({ value: count() })
            .from(invoices)
            .where(and(eq(invoices.organizationId, orgId), eq(invoices.status, 'overdue')))
        : none<{ value: number }>(),
      canAccounting ? moneyTotals(tx, orgId) : Promise.resolve(null),
    ]);

  const entryIds = entryRows.map((row) => row.id);
  const lineTotals = entryIds.length
    ? await tx
        .select({
          journalEntryId: journalLines.journalEntryId,
          currency: journalLines.currency,
          debitMinor: sql<string>`coalesce(sum(${journalLines.debitMinor}), 0)::text`,
          creditMinor: sql<string>`coalesce(sum(${journalLines.creditMinor}), 0)::text`,
        })
        .from(journalLines)
        .where(inArray(journalLines.journalEntryId, entryIds))
        .groupBy(journalLines.journalEntryId, journalLines.currency)
    : [];

  const journals = entryRows.map((row) => {
    const amounts = lineTotals.filter((total) => total.journalEntryId === row.id);
    const single = amounts.length === 1 ? amounts[0]! : null;
    return {
      ...jsonSafe(row),
      amounts,
      currency: single?.currency ?? null,
      debitMinor: single?.debitMinor ?? null,
      creditMinor: single?.creditMinor ?? null,
    };
  });

  const [receivable, expense] = totals ?? [[], []];
  const currencies = [
    ...new Set([...receivable, ...collected, ...expense].map((row) => row.currency)),
  ].sort();
  const pick = (rows: { currency: string; value: string }[], currency: string) =>
    rows.find((row) => row.currency === currency)?.value ?? '0';
  const chequeItems = chequeRows.map(jsonSafe);
  const leaseInvoices = invoiceRows.map(jsonSafe);

  return {
    journals,
    summary: {
      totalsByCurrency: currencies.map((currency) => ({
        currency,
        receivableMinor: pick(receivable, currency),
        collectedMinor: pick(collected, currency),
        expenseMinor: pick(expense, currency),
      })),
      draftJournals: Number(drafts[0]?.value ?? 0),
      overdueInvoices: Number(overdue[0]?.value ?? 0),
      activeLeaseInvoices: leaseInvoices.filter((row) => row.status !== 'void').length,
      pendingCheques: chequeItems.filter((row) => row.reviewStatus === 'pending').length,
    },
    secondary: [
      ...chequeItems.map((row) => ({ ...row, recordKind: 'cheque', status: row.reviewStatus })),
      ...leaseInvoices.map((row) => ({ ...row, recordKind: 'lease_invoice' })),
    ],
    contextPatch: { ledgerAccounts: accountRows.map(jsonSafe) },
  };
}

async function loadWorkOrders(tx: OpsTransaction, orgId: string): Promise<NeonSectionLoad> {
  const rows = await tx
    .select()
    .from(maintenanceWorkOrders)
    .where(eq(maintenanceWorkOrders.organizationId, orgId))
    .orderBy(desc(maintenanceWorkOrders.createdAt))
    .limit(LIST_LIMIT);
  return { records: rows.map(jsonSafe) };
}

async function loadTasks(tx: OpsTransaction, orgId: string): Promise<NeonSectionLoad> {
  const rows = await tx
    .select()
    .from(workTasks)
    .where(eq(workTasks.organizationId, orgId))
    .orderBy(desc(workTasks.createdAt))
    .limit(LIST_LIMIT);
  return { records: rows.map(jsonSafe) };
}

async function loadLegal(tx: OpsTransaction, orgId: string): Promise<NeonSectionLoad> {
  const rows = await tx
    .select()
    .from(legalCases)
    .where(eq(legalCases.organizationId, orgId))
    .orderBy(desc(legalCases.createdAt))
    .limit(LIST_LIMIT);
  return { records: rows.map(jsonSafe) };
}

async function loadTeam(tx: OpsTransaction, orgId: string): Promise<NeonSectionLoad> {
  const rows = await tx
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
    .where(eq(memberships.organizationId, orgId));
  return { records: rows.map(jsonSafe) };
}

type SummaryCounts = {
  requestsOpen: number;
  tasksOpen: number;
  reservationsActive: number;
  maintenanceOpen: number;
  legalActive: number;
  draftJournals: number;
};

async function loadReports(tx: OpsTransaction, orgId: string): Promise<NeonSectionLoad> {
  const [rows, countRows, salesRows, totals] = await Promise.all([
    tx
      .select()
      .from(reportJobs)
      .where(eq(reportJobs.organizationId, orgId))
      .orderBy(desc(reportJobs.createdAt))
      .limit(LIST_LIMIT),
    tx.execute<SummaryCounts>(sql`
      select
        (select count(*)::int from operational_requests
          where organization_id = ${orgId} and status in ('pending', 'approved', 'in_progress')) as "requestsOpen",
        (select count(*)::int from work_tasks
          where organization_id = ${orgId} and status in ('pending', 'approved', 'in_progress', 'on_hold')) as "tasksOpen",
        (select count(*)::int from reservations
          where organization_id = ${orgId} and status in ('pending', 'confirmed')) as "reservationsActive",
        (select count(*)::int from maintenance_tickets
          where organization_id = ${orgId} and status in ('open', 'assigned', 'in_progress')) as "maintenanceOpen",
        (select count(*)::int from legal_cases
          where organization_id = ${orgId}
            and status in ('assessment', 'notice', 'filed', 'hearing', 'judgment', 'enforcement', 'settled')) as "legalActive",
        (select count(*)::int from journal_entries
          where organization_id = ${orgId} and status = 'draft') as "draftJournals"
    `),
    tx
      .select({
        currency: salesDeals.currency,
        active: count(),
        pipelineMinor: sql<string>`coalesce(sum(coalesce(${salesDeals.agreedPriceMinor}, ${salesDeals.offerPriceMinor}, ${salesDeals.askingPriceMinor}, 0)), 0)::text`,
      })
      .from(salesDeals)
      .where(
        and(
          eq(salesDeals.organizationId, orgId),
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
      )
      .groupBy(salesDeals.currency),
    moneyTotals(tx, orgId),
  ]);
  const counts = countRows[0];
  const [receivable, expense] = totals;
  const currencies = [...new Set([...receivable, ...expense].map((row) => row.currency))].sort();
  return {
    records: rows.map(jsonSafe),
    summary: {
      generatedAt: new Date().toISOString(),
      requests: { open: Number(counts?.requestsOpen ?? 0) },
      tasks: { open: Number(counts?.tasksOpen ?? 0) },
      reservations: { active: Number(counts?.reservationsActive ?? 0) },
      sales: {
        active: salesRows.reduce((sum, row) => sum + Number(row.active), 0),
        totals: salesRows.map((row) => ({
          currency: row.currency,
          pipelineMinor: row.pipelineMinor,
        })),
      },
      maintenance: { open: Number(counts?.maintenanceOpen ?? 0) },
      legal: { active: Number(counts?.legalActive ?? 0) },
      accounting: {
        totals: currencies.map((currency) => ({
          currency,
          receivableMinor: receivable.find((row) => row.currency === currency)?.value ?? '0',
          expenseMinor: expense.find((row) => row.currency === currency)?.value ?? '0',
        })),
        draftJournals: Number(counts?.draftJournals ?? 0),
      },
    },
  };
}

const SECTION_PERMISSION: Partial<Record<OperationsSection, Permission>> = {
  requests: 'request.read',
  leasing: 'lease.read',
  sales: 'sale.read',
  contracts: 'contract.read',
  'work-orders': 'work_order.read',
  tasks: 'task.read',
  legal: 'legal.read',
  reports: 'report.read',
  team: 'organization.members.read',
};

async function readSection(
  claims: SessionClaims,
  section: OperationsSection,
): Promise<NeonSectionLoad | null> {
  const orgId = claims.organizationId!;
  const can = (permission: Permission) => hasPermission(claims, permission);
  const required = SECTION_PERMISSION[section];
  if (required && !can(required)) return { records: [] };

  switch (section) {
    case 'bookings': {
      const ownerPartyId = ownerPartyScope(claims);
      const [leaseRows, stayRows] = await Promise.all([
        withinViewerTenant(claims, (tx) => loadLeaseBookings(tx, orgId, can, ownerPartyId)),
        isStaysPlatformEnabled()
          ? loadStayBookingOpsRows({ limit: BOOKINGS_LIMIT }).catch(() => [] as DataRow[])
          : Promise.resolve([] as DataRow[]),
      ]);
      return { records: [...stayRows, ...leaseRows] };
    }
    case 'accounting': {
      const [ledger, stayPayments] = await Promise.all([
        withinViewerTenant(claims, (tx) => loadAccounting(tx, orgId, can)),
        loadStayIncomeRowsForViewer(),
      ]);
      return {
        records: [...stayPayments, ...ledger.journals],
        summary: {
          ...ledger.summary,
          stayPaymentsCollected: stayPayments.filter((row) => row.recordKind === 'stay_payment')
            .length,
        },
        secondary: [...(ledger.secondary ?? []), ...stayPayments],
        ...(ledger.contextPatch ? { contextPatch: ledger.contextPatch } : {}),
      };
    }
    case 'requests':
      return withinViewerTenant(claims, (tx) => loadRequests(tx, orgId));
    case 'leasing':
      return withinViewerTenant(claims, (tx) => loadLeasing(tx, orgId));
    case 'sales':
      return withinViewerTenant(claims, (tx) => loadSales(tx, orgId));
    case 'contracts':
      return withinViewerTenant(claims, (tx) => loadContracts(tx, orgId));
    case 'payments':
      return withinViewerTenant(claims, (tx) => loadPayments(tx, orgId, can));
    case 'work-orders':
      return withinViewerTenant(claims, (tx) => loadWorkOrders(tx, orgId));
    case 'tasks':
      return withinViewerTenant(claims, (tx) => loadTasks(tx, orgId));
    case 'legal':
      return withinViewerTenant(claims, (tx) => loadLegal(tx, orgId));
    case 'reports':
      return withinViewerTenant(claims, (tx) => loadReports(tx, orgId));
    case 'team':
      return withinViewerTenant(claims, (tx) => loadTeam(tx, orgId));
    default:
      return null;
  }
}

/**
 * Neon reads for ops sections that used to need Nest (cold starts on Render).
 * Null means "not served here" or failed — the caller falls back to Nest.
 */
export async function loadOpsSectionFromNeon(
  portal: PortalRole,
  section: OperationsSection,
): Promise<NeonSectionLoad | null> {
  if (!hasDatabaseUrl()) return null;
  if (portal !== 'owner' && portal !== 'developer') return null;
  const claims = await readClaims();
  if (!claims?.organizationId) return null;
  try {
    const capMs = section === 'bookings' ? BOOKINGS_CAP_MS : SECTION_CAP_MS;
    return await Promise.race([
      readSection(claims, section),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), capMs);
      }),
    ]);
  } catch {
    return null;
  }
}
