import 'server-only';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import {
  approvalRequests,
  contractSignatures,
  contracts,
  expenses,
  invoices,
  leases,
  maintenanceTickets,
  parties,
  partyRoles,
  payments,
  properties,
  reservations,
  salesDeals,
  stayBookingGuests,
  stayBookings,
  stayPaymentIntents,
  units,
  utilityMeters,
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

export type PropertyRecordUnit = {
  id: string;
  code: string;
  rentMinor: string | null;
  salePriceMinor: string | null;
  depositMinor: string | null;
  currency: string;
  floor: string | null;
  areaSquareMeters: string | null;
  electricityMeter: string | null;
  waterMeter: string | null;
};

/** Address-book entry offered when filling a manual lease. */
export type PropertyRecordTenant = {
  id: string;
  displayName: string;
  type: 'person' | 'company';
  email: string | null;
  phone: string | null;
};

export type PropertySectionRecords = {
  rows: PropertyRecordRow[];
  units: PropertyRecordUnit[];
  tenants: PropertyRecordTenant[];
};

function omanToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat' }).format(new Date());
}

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
): Promise<PropertySectionRecords | null> {
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
      .select({
        id: units.id,
        code: units.code,
        rentMinor: units.rentMinor,
        salePriceMinor: units.salePriceMinor,
        depositMinor: units.depositMinor,
        currency: units.currency,
        floor: units.floor,
        areaSquareMeters: units.areaSquareMeters,
      })
      .from(units)
      .where(and(eq(units.organizationId, orgId), eq(units.propertyId, propertyId)))
      .orderBy(units.code);
    const unitIds = unitRows.map((row) => row.id);
    const unitCode = new Map(unitRows.map((row) => [row.id, row.code]));
    const codeOf = (id: string | null | undefined) => (id ? (unitCode.get(id) ?? null) : null);

    const rows = await (() => {
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
    })();
    const [meters, tenants] =
      section === 'leasing'
        ? await Promise.all([
            unitIds.length
              ? tx
                  .select({
                    unitId: utilityMeters.unitId,
                    utilityType: utilityMeters.utilityType,
                    meterNumber: utilityMeters.meterNumber,
                  })
                  .from(utilityMeters)
                  .where(
                    and(
                      eq(utilityMeters.organizationId, orgId),
                      inArray(utilityMeters.unitId, unitIds),
                    ),
                  )
              : Promise.resolve([]),
            hasPermission(claims, 'lease.create') && !ownerPartyId
              ? loadTenantDirectory(tx, orgId)
              : Promise.resolve([]),
          ])
        : [[], []];
    const meterOf = (unitId: string, type: string) =>
      meters.find((meter) => meter.unitId === unitId && meter.utilityType === type)?.meterNumber ??
      null;
    return {
      rows,
      units: unitRows.map((row) => ({
        id: row.id,
        code: row.code,
        rentMinor: minor(row.rentMinor),
        salePriceMinor: minor(row.salePriceMinor),
        depositMinor: minor(row.depositMinor),
        currency: row.currency,
        floor: row.floor,
        areaSquareMeters: row.areaSquareMeters,
        electricityMeter: meterOf(row.id, 'electricity'),
        waterMeter: meterOf(row.id, 'water'),
      })),
      tenants,
    };
  });
}

/** Tenants and prospects of the organization, for the manual lease address-book picker. */
async function loadTenantDirectory(tx: Tx, orgId: string): Promise<PropertyRecordTenant[]> {
  const rows = await tx
    .selectDistinct({
      id: parties.id,
      displayName: parties.displayName,
      type: parties.type,
      email: parties.email,
      phone: parties.phone,
    })
    .from(parties)
    .innerJoin(partyRoles, eq(partyRoles.partyId, parties.id))
    .where(
      and(
        eq(parties.organizationId, orgId),
        eq(parties.status, 'active'),
        inArray(partyRoles.roleKey, ['tenant', 'prospect']),
      ),
    )
    .orderBy(parties.displayName)
    .limit(500);
  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    type: row.type,
    email: row.email,
    phone: row.phone,
  }));
}

/** Contracts issued from stay bookings, keyed by booking id. */
async function contractsByStayBooking(tx: Tx, orgId: string, unitIds: string[]) {
  if (!unitIds.length) return new Map<string, { id: string; reference: string; status: string }>();
  const rows = await tx
    .select({
      id: contracts.id,
      reference: contracts.reference,
      status: contracts.status,
      bookingId: sql<string | null>`${contracts.payloadSnapshot}->'source'->>'stayBookingId'`,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.organizationId, orgId),
        inArray(contracts.unitId, unitIds),
        sql`${contracts.payloadSnapshot}->'source'->>'type' = 'stay_booking'`,
      ),
    );
  const map = new Map<string, { id: string; reference: string; status: string }>();
  for (const row of rows) {
    if (!row.bookingId || (map.has(row.bookingId) && row.status === 'void')) continue;
    map.set(row.bookingId, {
      id: row.id,
      reference: row.reference ?? row.id.slice(0, 8).toUpperCase(),
      status: row.status,
    });
  }
  return map;
}

/** Contract status as the owner reads it: approved & signed, or waiting for the manager. */
function contractDisplayStatus(status: string, pendingApproval: boolean): string {
  if (status === 'signed') return 'approved_signed';
  if (status === 'draft' && !pendingApproval) return 'draft';
  if (status === 'draft' || status === 'sent' || status === 'partially_signed') {
    return 'pending_manager_approval';
  }
  return status;
}

/** Lease status by today's date: rented now, starting later, or its term has run out. */
function leaseDisplayStatus(
  status: string,
  startsOn: string | null,
  endsOn: string | null,
): string {
  if (status === 'draft') return 'pending_manager_approval';
  if (status !== 'active') return status;
  const today = omanToday();
  if (endsOn && endsOn < today) return 'lease_completed';
  if (startsOn && startsOn > today) return 'upcoming_lease';
  return 'rented';
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
      bookingMode: stayBookings.bookingMode,
      termsAcceptedAt: sql<
        string | null
      >`${stayBookings.pricingSnapshotJson}->'acceptedTerms'->>'acceptedAt'`,
      contactName: sql<
        string | null
      >`${stayBookings.pricingSnapshotJson}->'guestContact'->>'displayName'`,
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

  const [names, bookingContracts] = await Promise.all([
    partyNames(tx, [
      ...stays.map((row) => row.guestPartyId),
      ...reservationRows.map((row) => row.tenantPartyId),
      ...viewingRows.map((row) => row.prospectPartyId),
    ]),
    contractsByStayBooking(tx, orgId, unitIds),
  ]);

  const rows: PropertyRecordRow[] = [
    ...stays.map((row) => {
      const contract = bookingContracts.get(row.id);
      return {
        id: row.id,
        kind: 'stay',
        reference: row.referenceCode,
        unitCode: codeOf(row.unitId),
        party:
          guestByBooking.get(row.id) ??
          row.contactName ??
          (row.guestPartyId ? (names.get(row.guestPartyId) ?? null) : null),
        fromOn: isoDate(row.checkInOn),
        toOn: isoDate(row.checkOutOn),
        amountMinor: minor(row.totalMinor),
        currency: row.currency,
        status: row.status,
        bookingMode: row.bookingMode,
        termsAcceptedOn: row.termsAcceptedAt ? row.termsAcceptedAt.slice(0, 10) : null,
        contractId: contract?.id ?? null,
        contractReference: contract?.reference ?? null,
        contractStatus: contract?.status ?? null,
        sortOn: isoDate(row.createdAt),
      };
    }),
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
  const awaiting = (row: PropertyRecordRow) => (row.status === 'request_pending' ? 0 : 1);
  return rows.sort(
    (a, b) => awaiting(a) - awaiting(b) || (b.sortOn ?? '').localeCompare(a.sortOn ?? ''),
  );
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
      contractType: sql<string | null>`${contracts.payloadSnapshot}->'contract'->>'type'`,
      sourceType: sql<string | null>`${contracts.payloadSnapshot}->'source'->>'type'`,
      sourceReference: sql<string | null>`${contracts.payloadSnapshot}->'source'->>'referenceCode'`,
      payloadStartsOn: sql<string | null>`${contracts.payloadSnapshot}->>'startsOn'`,
      payloadAmountMinor: sql<
        string | null
      >`${contracts.payloadSnapshot}->'amount'->>'amountMinor'`,
      payloadCurrency: sql<string | null>`${contracts.payloadSnapshot}->'amount'->>'currency'`,
      termsJson: sql<string | null>`(${contracts.payloadSnapshot}->'leaseTerms')::text`,
      tenantJson: sql<string | null>`(${contracts.payloadSnapshot}->'tenantDetails')::text`,
    })
    .from(contracts)
    .leftJoin(leases, eq(leases.contractId, contracts.id))
    .where(and(eq(contracts.organizationId, orgId), inArray(contracts.unitId, unitIds)))
    .orderBy(desc(contracts.createdAt))
    .limit(ROW_LIMIT);
  const contractIds = rows.map((row) => row.id);
  const [names, signatures, pendingApprovals] = await Promise.all([
    partyNames(tx, [
      ...rows.map((row) => row.tenantPartyId),
      ...rows.map((row) => row.ownerPartyId),
    ]),
    contractIds.length
      ? tx
          .select({
            contractId: contractSignatures.contractId,
            signerRole: contractSignatures.signerRole,
            method: contractSignatures.method,
            signedByName: sql<string | null>`${contractSignatures.evidence}->>'signedByName'`,
            signedAt: contractSignatures.signedAt,
          })
          .from(contractSignatures)
          .where(inArray(contractSignatures.contractId, contractIds))
      : Promise.resolve([]),
    contractIds.length
      ? tx
          .select({ contractId: approvalRequests.resourceId })
          .from(approvalRequests)
          .where(
            and(
              eq(approvalRequests.organizationId, orgId),
              eq(approvalRequests.resourceType, 'contract'),
              inArray(approvalRequests.resourceId, contractIds),
              inArray(approvalRequests.status, ['pending', 'on_hold']),
            ),
          )
      : Promise.resolve([]),
  ]);
  const pending = new Set(pendingApprovals.map((row) => row.contractId));
  const counterpartySigned = new Map<string, string>();
  const ownerSigned = new Map<string, string>();
  for (const signature of signatures) {
    if (signature.signerRole === 'owner') {
      ownerSigned.set(signature.contractId, signature.signedByName ?? '');
    } else {
      counterpartySigned.set(signature.contractId, signature.method);
    }
  }
  return rows.map((row) => {
    const isSale = row.contractType === 'sale';
    return {
      id: row.id,
      reference: row.reference ?? row.id.slice(0, 8).toUpperCase(),
      contractKind: row.kind,
      contractType: isSale ? 'sale' : 'lease',
      sourceType: row.sourceType,
      sourceReference: row.sourceReference,
      unitCode: codeOf(row.unitId),
      party: names.get(row.tenantPartyId) ?? null,
      ownerName: names.get(row.ownerPartyId) ?? null,
      status: contractDisplayStatus(row.status, pending.has(row.id)),
      contractStatus: row.status,
      leaseStatus: row.leaseStatus
        ? leaseDisplayStatus(row.leaseStatus, isoDate(row.startsOn), isoDate(row.endsOn))
        : null,
      counterpartySignature: counterpartySigned.get(row.id) ?? null,
      ownerSignedBy: ownerSigned.has(row.id) ? ownerSigned.get(row.id) || '—' : null,
      createdOn: isoDate(row.createdAt),
      sentOn: isoDate(row.sentAt),
      signedOn: isoDate(row.completedAt),
      fromOn: isoDate(row.startsOn) ?? (isSale ? isoDate(row.payloadStartsOn) : null),
      toOn: isoDate(row.endsOn),
      amountMinor: row.payloadAmountMinor ?? minor(row.rentMinor),
      currency: row.payloadCurrency ?? row.currency ?? null,
      termsJson: row.termsJson,
      tenantJson: row.tenantJson,
    };
  });
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
      sourceType: sql<string | null>`${contracts.payloadSnapshot}->'source'->>'type'`,
      sourceReference: sql<string | null>`${contracts.payloadSnapshot}->'source'->>'referenceCode'`,
      contractTotalMinor: sql<
        string | null
      >`${contracts.payloadSnapshot}->'amount'->>'amountMinor'`,
      termsJson: sql<string | null>`(${contracts.payloadSnapshot}->'leaseTerms')::text`,
      tenantJson: sql<string | null>`(${contracts.payloadSnapshot}->'tenantDetails')::text`,
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
    contractReference: row.contractReference,
    sourceType: row.sourceType,
    sourceReference: row.sourceReference,
    unitCode: codeOf(row.unitId),
    party: names.get(row.tenantPartyId) ?? null,
    status: leaseDisplayStatus(row.status, isoDate(row.startsOn), isoDate(row.endsOn)),
    leaseStatus: row.status,
    fromOn: isoDate(row.startsOn),
    toOn: isoDate(row.endsOn),
    cancellationOn: isoDate(row.cancellationEffectiveOn),
    amountMinor: minor(row.rentMinor),
    contractTotalMinor: row.contractTotalMinor,
    depositMinor: minor(row.depositMinor),
    currency: row.currency,
    termsJson: row.termsJson,
    tenantJson: row.tenantJson,
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
  const dealIds = rows.map((row) => row.id);
  const [names, dealContracts] = await Promise.all([
    partyNames(tx, [
      ...rows.map((row) => row.buyerPartyId),
      ...rows.map((row) => row.sellerPartyId),
    ]),
    dealIds.length
      ? tx
          .select({
            id: contracts.id,
            reference: contracts.reference,
            dealId: sql<string | null>`${contracts.payloadSnapshot}->'sale'->>'dealId'`,
          })
          .from(contracts)
          .where(
            and(
              eq(contracts.organizationId, orgId),
              sql`${contracts.payloadSnapshot}->'sale'->>'dealId' in (${sql.join(
                dealIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            ),
          )
      : Promise.resolve([]),
  ]);
  const contractByDeal = new Map(dealContracts.map((row) => [row.dealId, row]));
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    contractId: contractByDeal.get(row.id)?.id ?? null,
    contractReference: contractByDeal.get(row.id)?.reference ?? null,
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
