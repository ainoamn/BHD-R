import 'server-only';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import {
  contracts,
  expenses,
  invoices,
  leases,
  maintenanceTickets,
  parties,
  payments,
  properties,
  reservations,
  salesDeals,
  stayBookingGuests,
  stayBookings,
  stayPaymentIntents,
  units,
  viewingRequests,
} from '@bhd-r/db';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';

export const PROPERTY_RECORD_SECTIONS = [
  'bookings',
  'contracts',
  'leasing',
  'sales',
  'maintenance',
  'invoices',
  'accounting',
] as const;
export type PropertyRecordSection = (typeof PROPERTY_RECORD_SECTIONS)[number];

/** Flat, display-ready row; every value is a string so the client never stringifies objects. */
export type PropertyRecordRow = Record<string, string | null>;

export function isPropertyRecordSection(value: string): value is PropertyRecordSection {
  return (PROPERTY_RECORD_SECTIONS as readonly string[]).includes(value);
}

type Tx = Parameters<Parameters<typeof withinViewerTenant>[1]>[0];

const ROW_LIMIT = 500;

function isoDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function minor(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

async function partyNames(tx: Tx, ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map<string, string>();
  const rows = await tx
    .select({ id: parties.id, name: parties.displayName })
    .from(parties)
    .where(inArray(parties.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * Records of one section for one property, read straight from Neon under the
 * viewer's tenant/RLS context. Returns null when the property is not visible
 * to the viewer (wrong organization, or an owner-scoped user who does not own it).
 */
export async function loadPropertySectionRecords(
  claims: SessionClaims,
  propertyId: string,
  section: PropertyRecordSection,
): Promise<PropertyRecordRow[] | null> {
  const orgId = claims.organizationId;
  if (!orgId) return null;
  const ownerPartyId = ownerPartyScope(claims);

  return withinViewerTenant(claims, async (tx) => {
    const [property] = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, orgId),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      )
      .limit(1);
    if (!property) return null;

    const unitRows = await tx
      .select({ id: units.id, code: units.code })
      .from(units)
      .where(and(eq(units.organizationId, orgId), eq(units.propertyId, propertyId)));
    const unitIds = unitRows.map((row) => row.id);
    const unitCode = new Map(unitRows.map((row) => [row.id, row.code]));
    const codeOf = (id: string | null | undefined) => (id ? (unitCode.get(id) ?? null) : null);

    switch (section) {
      case 'bookings':
        return loadBookings(tx, orgId, propertyId, unitIds, codeOf);
      case 'contracts':
        return loadContracts(tx, orgId, unitIds, codeOf);
      case 'leasing':
        return loadLeases(tx, orgId, unitIds, codeOf);
      case 'sales':
        return loadSales(tx, orgId, propertyId, codeOf);
      case 'maintenance':
        return loadMaintenance(tx, orgId, unitIds, codeOf);
      case 'invoices':
        return loadInvoices(tx, orgId, unitIds, codeOf);
      case 'accounting':
        return loadAccounting(tx, orgId, propertyId, unitIds, codeOf);
    }
  });
}

type CodeOf = (id: string | null | undefined) => string | null;

async function loadBookings(
  tx: Tx,
  orgId: string,
  propertyId: string,
  unitIds: string[],
  codeOf: CodeOf,
): Promise<PropertyRecordRow[]> {
  const stays = await tx
    .select({
      id: stayBookings.id,
      referenceCode: stayBookings.referenceCode,
      unitId: stayBookings.unitId,
      guestPartyId: stayBookings.guestPartyId,
      status: stayBookings.status,
      checkInOn: stayBookings.checkInOn,
      checkOutOn: stayBookings.checkOutOn,
      currency: stayBookings.currency,
      totalMinor: stayBookings.totalMinor,
      createdAt: stayBookings.createdAt,
    })
    .from(stayBookings)
    .where(and(eq(stayBookings.organizationId, orgId), eq(stayBookings.propertyId, propertyId)))
    .orderBy(desc(stayBookings.createdAt))
    .limit(ROW_LIMIT);

  const guests = stays.length
    ? await tx
        .select({ bookingId: stayBookingGuests.bookingId, name: stayBookingGuests.displayName })
        .from(stayBookingGuests)
        .where(
          and(
            inArray(
              stayBookingGuests.bookingId,
              stays.map((row) => row.id),
            ),
            eq(stayBookingGuests.isPrimary, true),
          ),
        )
    : [];
  const guestByBooking = new Map(guests.map((row) => [row.bookingId, row.name]));

  const [reservationRows, viewingRows] = unitIds.length
    ? await Promise.all([
        tx
          .select({
            id: reservations.id,
            unitId: reservations.unitId,
            tenantPartyId: reservations.tenantPartyId,
            status: reservations.status,
            startsAt: reservations.startsAt,
            expiresAt: reservations.expiresAt,
            rentMinor: reservations.rentMinor,
            currency: reservations.currency,
            createdAt: reservations.createdAt,
          })
          .from(reservations)
          .where(and(eq(reservations.organizationId, orgId), inArray(reservations.unitId, unitIds)))
          .orderBy(desc(reservations.createdAt))
          .limit(ROW_LIMIT),
        tx
          .select({
            id: viewingRequests.id,
            reference: viewingRequests.reference,
            unitId: viewingRequests.unitId,
            prospectPartyId: viewingRequests.prospectPartyId,
            status: viewingRequests.status,
            preferredAt: viewingRequests.preferredAt,
            scheduledAt: viewingRequests.scheduledAt,
            createdAt: viewingRequests.createdAt,
          })
          .from(viewingRequests)
          .where(
            and(
              eq(viewingRequests.organizationId, orgId),
              inArray(viewingRequests.unitId, unitIds),
            ),
          )
          .orderBy(desc(viewingRequests.createdAt))
          .limit(ROW_LIMIT),
      ])
    : [[], []];

  const names = await partyNames(tx, [
    ...stays.map((row) => row.guestPartyId),
    ...reservationRows.map((row) => row.tenantPartyId),
    ...viewingRows.map((row) => row.prospectPartyId),
  ]);

  const rows: PropertyRecordRow[] = [
    ...stays.map((row) => ({
      id: row.id,
      kind: 'stay',
      reference: row.referenceCode,
      unitCode: codeOf(row.unitId),
      party:
        guestByBooking.get(row.id) ??
        (row.guestPartyId ? (names.get(row.guestPartyId) ?? null) : null),
      fromOn: isoDate(row.checkInOn),
      toOn: isoDate(row.checkOutOn),
      amountMinor: minor(row.totalMinor),
      currency: row.currency,
      status: row.status,
      sortOn: isoDate(row.createdAt),
    })),
    ...reservationRows.map((row) => ({
      id: row.id,
      kind: 'reservation',
      reference: row.id.slice(0, 8).toUpperCase(),
      unitCode: codeOf(row.unitId),
      party: names.get(row.tenantPartyId) ?? null,
      fromOn: isoDate(row.startsAt),
      toOn: isoDate(row.expiresAt),
      amountMinor: minor(row.rentMinor),
      currency: row.currency,
      status: row.status,
      sortOn: isoDate(row.createdAt),
    })),
    ...viewingRows.map((row) => ({
      id: row.id,
      kind: 'viewing',
      reference: row.reference,
      unitCode: codeOf(row.unitId),
      party: names.get(row.prospectPartyId) ?? null,
      fromOn: isoDate(row.scheduledAt ?? row.preferredAt),
      toOn: null,
      amountMinor: null,
      currency: null,
      status: row.status,
      sortOn: isoDate(row.createdAt),
    })),
  ];
  return rows.sort((a, b) => (b.sortOn ?? '').localeCompare(a.sortOn ?? ''));
}

async function loadContracts(
  tx: Tx,
  orgId: string,
  unitIds: string[],
  codeOf: CodeOf,
): Promise<PropertyRecordRow[]> {
  if (!unitIds.length) return [];
  const rows = await tx
    .select({
      id: contracts.id,
      reference: contracts.reference,
      kind: contracts.kind,
      status: contracts.status,
      unitId: contracts.unitId,
      ownerPartyId: contracts.ownerPartyId,
      tenantPartyId: contracts.tenantPartyId,
      createdAt: contracts.createdAt,
      sentAt: contracts.sentAt,
      completedAt: contracts.completedAt,
      leaseStatus: leases.status,
      startsOn: leases.startsOn,
      endsOn: leases.endsOn,
      rentMinor: leases.rentMinor,
      currency: leases.currency,
    })
    .from(contracts)
    .leftJoin(leases, eq(leases.contractId, contracts.id))
    .where(and(eq(contracts.organizationId, orgId), inArray(contracts.unitId, unitIds)))
    .orderBy(desc(contracts.createdAt))
    .limit(ROW_LIMIT);
  const names = await partyNames(tx, [
    ...rows.map((row) => row.tenantPartyId),
    ...rows.map((row) => row.ownerPartyId),
  ]);
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference ?? row.id.slice(0, 8).toUpperCase(),
    contractKind: row.kind,
    unitCode: codeOf(row.unitId),
    party: names.get(row.tenantPartyId) ?? null,
    ownerName: names.get(row.ownerPartyId) ?? null,
    status: row.status,
    leaseStatus: row.leaseStatus ?? null,
    createdOn: isoDate(row.createdAt),
    sentOn: isoDate(row.sentAt),
    signedOn: isoDate(row.completedAt),
    fromOn: isoDate(row.startsOn),
    toOn: isoDate(row.endsOn),
    amountMinor: minor(row.rentMinor),
    currency: row.currency ?? null,
  }));
}

async function loadLeases(
  tx: Tx,
  orgId: string,
  unitIds: string[],
  codeOf: CodeOf,
): Promise<PropertyRecordRow[]> {
  if (!unitIds.length) return [];
  const rows = await tx
    .select({
      id: leases.id,
      unitId: leases.unitId,
      tenantPartyId: leases.tenantPartyId,
      status: leases.status,
      startsOn: leases.startsOn,
      endsOn: leases.endsOn,
      rentMinor: leases.rentMinor,
      depositMinor: leases.depositMinor,
      currency: leases.currency,
      cancellationEffectiveOn: leases.cancellationEffectiveOn,
      contractId: leases.contractId,
      contractReference: contracts.reference,
    })
    .from(leases)
    .leftJoin(contracts, eq(contracts.id, leases.contractId))
    .where(and(eq(leases.organizationId, orgId), inArray(leases.unitId, unitIds)))
    .orderBy(desc(leases.startsOn))
    .limit(ROW_LIMIT);
  const names = await partyNames(
    tx,
    rows.map((row) => row.tenantPartyId),
  );
  return rows.map((row) => ({
    id: row.id,
    reference: row.contractReference ?? row.id.slice(0, 8).toUpperCase(),
    contractId: row.contractId,
    unitCode: codeOf(row.unitId),
    party: names.get(row.tenantPartyId) ?? null,
    status: row.status,
    fromOn: isoDate(row.startsOn),
    toOn: isoDate(row.endsOn),
    cancellationOn: isoDate(row.cancellationEffectiveOn),
    amountMinor: minor(row.rentMinor),
    depositMinor: minor(row.depositMinor),
    currency: row.currency,
  }));
}

async function loadSales(
  tx: Tx,
  orgId: string,
  propertyId: string,
  codeOf: CodeOf,
): Promise<PropertyRecordRow[]> {
  const rows = await tx
    .select({
      id: salesDeals.id,
      reference: salesDeals.reference,
      unitId: salesDeals.unitId,
      sellerPartyId: salesDeals.sellerPartyId,
      buyerPartyId: salesDeals.buyerPartyId,
      status: salesDeals.status,
      askingPriceMinor: salesDeals.askingPriceMinor,
      offerPriceMinor: salesDeals.offerPriceMinor,
      agreedPriceMinor: salesDeals.agreedPriceMinor,
      currency: salesDeals.currency,
      createdAt: salesDeals.createdAt,
    })
    .from(salesDeals)
    .where(and(eq(salesDeals.organizationId, orgId), eq(salesDeals.propertyId, propertyId)))
    .orderBy(desc(salesDeals.createdAt))
    .limit(ROW_LIMIT);
  const names = await partyNames(tx, [
    ...rows.map((row) => row.buyerPartyId),
    ...rows.map((row) => row.sellerPartyId),
  ]);
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    unitCode: codeOf(row.unitId),
    party: row.buyerPartyId ? (names.get(row.buyerPartyId) ?? null) : null,
    sellerName: names.get(row.sellerPartyId) ?? null,
    status: row.status,
    amountMinor: minor(row.askingPriceMinor),
    agreedMinor: minor(row.agreedPriceMinor ?? row.offerPriceMinor),
    currency: row.currency,
    createdOn: isoDate(row.createdAt),
  }));
}

async function loadMaintenance(
  tx: Tx,
  orgId: string,
  unitIds: string[],
  codeOf: CodeOf,
): Promise<PropertyRecordRow[]> {
  if (!unitIds.length) return [];
  const rows = await tx
    .select({
      id: maintenanceTickets.id,
      title: maintenanceTickets.title,
      unitId: maintenanceTickets.unitId,
      openedByPartyId: maintenanceTickets.openedByPartyId,
      category: maintenanceTickets.category,
      priority: maintenanceTickets.priority,
      status: maintenanceTickets.status,
      createdAt: maintenanceTickets.createdAt,
      resolvedAt: maintenanceTickets.resolvedAt,
    })
    .from(maintenanceTickets)
    .where(
      and(
        eq(maintenanceTickets.organizationId, orgId),
        inArray(maintenanceTickets.unitId, unitIds),
      ),
    )
    .orderBy(desc(maintenanceTickets.createdAt))
    .limit(ROW_LIMIT);
  const names = await partyNames(
    tx,
    rows.map((row) => row.openedByPartyId),
  );
  return rows.map((row) => ({
    id: row.id,
    reference: row.title,
    unitCode: codeOf(row.unitId),
    party: row.openedByPartyId ? (names.get(row.openedByPartyId) ?? null) : null,
    category: row.category,
    priority: row.priority,
    status: row.status,
    createdOn: isoDate(row.createdAt),
    resolvedOn: isoDate(row.resolvedAt),
  }));
}

async function loadInvoices(
  tx: Tx,
  orgId: string,
  unitIds: string[],
  codeOf: CodeOf,
): Promise<PropertyRecordRow[]> {
  if (!unitIds.length) return [];
  const rows = await tx
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      tenantPartyId: invoices.tenantPartyId,
      unitId: leases.unitId,
      status: invoices.status,
      currency: invoices.currency,
      totalMinor: invoices.totalMinor,
      paidMinor: invoices.paidMinor,
      issuedOn: invoices.issuedOn,
      dueOn: invoices.dueOn,
    })
    .from(invoices)
    .innerJoin(leases, eq(leases.id, invoices.leaseId))
    .where(and(eq(invoices.organizationId, orgId), inArray(leases.unitId, unitIds)))
    .orderBy(desc(invoices.issuedOn))
    .limit(ROW_LIMIT);
  const names = await partyNames(
    tx,
    rows.map((row) => row.tenantPartyId),
  );
  return rows.map((row) => ({
    id: row.id,
    reference: row.invoiceNumber,
    unitCode: codeOf(row.unitId),
    party: names.get(row.tenantPartyId) ?? null,
    status: row.status,
    amountMinor: minor(row.totalMinor),
    paidMinor: minor(row.paidMinor),
    currency: row.currency,
    fromOn: isoDate(row.issuedOn),
    toOn: isoDate(row.dueOn),
  }));
}

/** Money in (stay payments, lease invoice payments) and out (expenses) for the property. */
async function loadAccounting(
  tx: Tx,
  orgId: string,
  propertyId: string,
  unitIds: string[],
  codeOf: CodeOf,
): Promise<PropertyRecordRow[]> {
  const [stayRows, leasePaymentRows, expenseRows] = await Promise.all([
    tx
      .select({
        id: stayPaymentIntents.id,
        status: stayPaymentIntents.status,
        amountMinor: stayPaymentIntents.amountMinor,
        currency: stayPaymentIntents.currency,
        provider: stayPaymentIntents.provider,
        createdAt: stayPaymentIntents.createdAt,
        referenceCode: stayBookings.referenceCode,
        unitId: stayBookings.unitId,
      })
      .from(stayPaymentIntents)
      .innerJoin(stayBookings, eq(stayBookings.id, stayPaymentIntents.bookingId))
      .where(
        and(
          eq(stayPaymentIntents.organizationId, orgId),
          eq(stayBookings.propertyId, propertyId),
          eq(stayPaymentIntents.status, 'succeeded'),
        ),
      )
      .orderBy(desc(stayPaymentIntents.createdAt))
      .limit(ROW_LIMIT),
    unitIds.length
      ? tx
          .select({
            id: payments.id,
            status: payments.status,
            amountMinor: payments.amountMinor,
            currency: payments.currency,
            method: payments.method,
            receivedAt: payments.receivedAt,
            invoiceNumber: invoices.invoiceNumber,
            tenantPartyId: invoices.tenantPartyId,
            unitId: leases.unitId,
          })
          .from(payments)
          .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
          .innerJoin(leases, eq(leases.id, invoices.leaseId))
          .where(and(eq(payments.organizationId, orgId), inArray(leases.unitId, unitIds)))
          .orderBy(desc(payments.receivedAt))
          .limit(ROW_LIMIT)
      : Promise.resolve([]),
    tx
      .select({
        id: expenses.id,
        reference: expenses.reference,
        category: expenses.category,
        description: expenses.description,
        amountMinor: expenses.amountMinor,
        currency: expenses.currency,
        status: expenses.status,
        issuedOn: expenses.issuedOn,
        unitId: expenses.unitId,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.organizationId, orgId),
          unitIds.length
            ? or(eq(expenses.propertyId, propertyId), inArray(expenses.unitId, unitIds))
            : eq(expenses.propertyId, propertyId),
        ),
      )
      .orderBy(desc(expenses.issuedOn))
      .limit(ROW_LIMIT),
  ]);
  const names = await partyNames(
    tx,
    leasePaymentRows.map((row) => row.tenantPartyId),
  );

  const rows: PropertyRecordRow[] = [
    ...stayRows.map((row) => ({
      id: row.id,
      kind: 'stay_payment',
      direction: 'in',
      reference: row.referenceCode,
      unitCode: codeOf(row.unitId),
      party: null,
      description: row.provider,
      status: row.status,
      amountMinor: minor(row.amountMinor),
      currency: row.currency,
      fromOn: isoDate(row.createdAt),
    })),
    ...leasePaymentRows.map((row) => ({
      id: row.id,
      kind: 'lease_payment',
      direction: 'in',
      reference: row.invoiceNumber,
      unitCode: codeOf(row.unitId),
      party: names.get(row.tenantPartyId) ?? null,
      description: row.method,
      status: row.status,
      amountMinor: minor(row.amountMinor),
      currency: row.currency,
      fromOn: isoDate(row.receivedAt),
    })),
    ...expenseRows.map((row) => ({
      id: row.id,
      kind: 'expense',
      direction: 'out',
      reference: row.reference,
      unitCode: codeOf(row.unitId),
      party: null,
      description: `${row.category} · ${row.description}`,
      status: row.status,
      amountMinor: minor(row.amountMinor),
      currency: row.currency,
      fromOn: isoDate(row.issuedOn),
    })),
  ];
  return rows.sort((a, b) => (b.fromOn ?? '').localeCompare(a.fromOn ?? ''));
}
