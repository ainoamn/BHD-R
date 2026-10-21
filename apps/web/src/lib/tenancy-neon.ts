import 'server-only';
import { cache } from 'react';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { permissionsForRoles, type SessionClaims } from '@bhd-r/authz';
import {
  cheques,
  contractSignatures,
  contracts,
  createDatabase,
  invoices,
  leases,
  operationalRequests,
  payments,
  properties,
  reservations,
  stayBookings,
  stayPaymentIntents,
  units,
  viewingRequests,
  type Database,
} from '@bhd-r/db';
import { activeBadgeChips } from '@/lib/badge-chips-neon';
import { badgePrestige, type BadgeChip } from '@/lib/badges-shared';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { applySessionSettings, viewerTenantSettings } from '@/lib/db-session-settings';
import {
  handoverAwaitingTenant,
  handoverDefectsOpen,
  lifecycleOf,
} from '@/lib/lease-reservation-lifecycle';
import { listGuestStayBookingsOnNeon } from '@/lib/public-stays-guest-neon';
import type { StayBookingPaymentKind } from '@/lib/stay-booking-payment-labels';
import {
  buildTenancyAlerts,
  EMPTY_TENANCY,
  type MyTenancy,
  type TenancyContract,
  type TenancyInvoice,
  type TenancyLandlord,
  type TenancyLease,
  type TenancyPayment,
  type TenancyReservation,
  type TenancyStatement,
  type TenancyStay,
  type TenancyViewing,
} from '@/lib/tenancy-shared';
import { buildLeaseStatement, ledgerTermsOf, type LeaseStatement } from '@/lib/tenant-ledger';
import { loadTenantPolicy } from '@/lib/tenant-policy-neon';
import { maintenanceBlockedByPolicy } from '@/lib/tenant-policy-shared';
import {
  TENANT_REQUEST_SOURCE,
  tenantRequestFromRow,
  type TenantRequest,
} from '@/lib/tenant-requests-shared';
import { issueViewingPassToken } from '@/lib/viewing-pass';
import { withTimeoutFallback } from '@/lib/with-timeout';

type DbHandle = { db: Database };
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Row = Record<string, unknown>;

const globalForDb = globalThis as unknown as { __bhdRWebDb?: DbHandle };
const MAX_LANDLORDS = 12;
const LIST_LIMIT = 30;
/** Cheques and invoices read for the statements of one landlord's leases. */
const STATEMENT_ROWS = 600;
const STATEMENT_LEASE_STATUS = new Set([
  'active',
  'cancel_requested',
  'clearance_pending',
  'renewal_pending',
  'ended',
  'terminated',
]);

/** The account's tenant/guest record inside one landlord organization. */
export type TenancyLink = { organizationId: string; partyId: string; landlord: TenancyLandlord };

function sharedDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRWebDb) {
    const { db } = createDatabase(url, { max: 3 });
    globalForDb.__bhdRWebDb = { db };
  }
  return globalForDb.__bhdRWebDb.db;
}

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : '';
}

/** Cross-organization lookups only; everything the tenant reads goes through `withinTenant`. */
async function elevated<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return sharedDb().transaction(async (tx) => {
    await applySessionSettings(tx, {
      statement_timeout: '6000',
      'app.platform_admin': 'true',
      'app.public': 'false',
    });
    return work(tx);
  });
}

/**
 * Tenant-mode session for this party in this organization. Every query below still filters
 * by organization and party explicitly: the app's database role bypasses row-level security.
 */
async function withinTenant<T>(
  userId: string,
  link: TenancyLink,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return sharedDb().transaction(async (tx) => {
    await applySessionSettings(tx, {
      statement_timeout: '6000',
      ...viewerTenantSettings({
        organizationId: link.organizationId,
        sub: userId,
        partyId: link.partyId,
        roles: ['tenant'],
      }),
    });
    return work(tx);
  });
}

/**
 * Landlord organizations where the account appears as tenant or guest. The match is the
 * account's verified BHD email against the party email the landlord recorded, the same
 * rule lease bookings use to prove ownership.
 */
export const loadTenancyLinks = cache(async (userId: string): Promise<TenancyLink[]> => {
  if (!hasDatabaseUrl()) return [];
  const result = await elevated((tx) =>
    tx.execute(sql`
      select p.organization_id::text as "organizationId",
             p.id::text as "partyId",
             o.display_name_ar as "ar",
             o.display_name_en as "en"
      from users u
      join parties p on p.status = 'active'
        and (
          (u.email not like '%@identity.bhd-om.local' and lower(p.email) = lower(u.email))
          or (p.metadata->>'userId') = u.id::text
        )
      join organizations o on o.id = p.organization_id and o.status = 'active'
      where u.id = ${userId}
        and u.disabled_at is null
        and (
          exists (select 1 from contracts c
                  where c.organization_id = p.organization_id and c.tenant_party_id = p.id)
          or exists (select 1 from leases l
                  where l.organization_id = p.organization_id and l.tenant_party_id = p.id)
          or exists (select 1 from reservations r
                  where r.organization_id = p.organization_id and r.tenant_party_id = p.id)
          or exists (select 1 from invoices i
                  where i.organization_id = p.organization_id and i.tenant_party_id = p.id)
          or exists (select 1 from stay_bookings b
                  where b.organization_id = p.organization_id and b.guest_party_id = p.id)
          or exists (select 1 from viewing_requests vr
                  where vr.organization_id = p.organization_id and vr.prospect_party_id = p.id)
        )
      order by o.display_name_en
      limit ${MAX_LANDLORDS}
    `),
  );
  return rowsOf(result).flatMap((row) => {
    const organizationId = str(row.organizationId);
    const partyId = str(row.partyId);
    if (!organizationId || !partyId) return [];
    return [
      {
        organizationId,
        partyId,
        landlord: { organizationId, ar: str(row.ar) ?? '', en: str(row.en) ?? '' },
      },
    ];
  });
});

export type TenancySummary = {
  contracts: number;
  leases: number;
  bookings: number;
  openInvoices: number;
};

/** Counts only, for the owner dashboard's pointer to the tenant space. */
export const loadTenancySummary = cache(async (userId: string): Promise<TenancySummary | null> => {
  const links = await loadTenancyLinks(userId);
  if (!links.length) return null;
  const partyIds = sql.join(
    links.map((link) => sql`${link.partyId}::uuid`),
    sql`, `,
  );
  const [row] = rowsOf(
    await elevated((tx) =>
      tx.execute(sql`
        select
          (select count(*)::int from contracts
            where tenant_party_id in (${partyIds}) and status <> 'draft') as "contracts",
          (select count(*)::int from leases l
            left join contracts c on c.id = l.contract_id
            where l.tenant_party_id in (${partyIds}) and l.status = 'active'
              and coalesce(c.payload_snapshot->'source'->>'type', '') <> 'stay_booking') as "leases",
          (select count(*)::int from stay_bookings
            where guest_party_id in (${partyIds}) or user_id = ${userId}::uuid)
          + (select count(*)::int from reservations
            where tenant_party_id in (${partyIds}) and status in ('pending', 'confirmed'))
          + (select count(*)::int from viewing_requests
            where prospect_party_id in (${partyIds})
              and status in ('requested', 'scheduled')) as "bookings",
          (select count(*)::int from invoices
            where tenant_party_id in (${partyIds})
              and status in ('issued', 'partially_paid', 'overdue')) as "openInvoices"
      `),
    ),
  );
  return {
    contracts: Number(row?.contracts ?? 0),
    leases: Number(row?.leases ?? 0),
    bookings: Number(row?.bookings ?? 0),
    openInvoices: Number(row?.openInvoices ?? 0),
  };
});

/** Session claims narrowed to the tenant record in the landlord's organization. */
export function tenantClaims(claims: SessionClaims, link: TenancyLink): SessionClaims {
  return {
    ...claims,
    organizationId: link.organizationId,
    partyId: link.partyId,
    roles: ['tenant'],
    permissions: permissionsForRoles(['tenant']),
  };
}

/** Tenant claims for a contract the account is the tenant on, in whichever organization. */
export async function tenantClaimsForContract(
  claims: SessionClaims,
  contractId: string,
): Promise<SessionClaims | null> {
  const links = await loadTenancyLinks(claims.sub);
  if (!links.length) return null;
  const [row] = await elevated((tx) =>
    tx
      .select({ organizationId: contracts.organizationId, tenantPartyId: contracts.tenantPartyId })
      .from(contracts)
      .where(eq(contracts.id, contractId))
      .limit(1),
  );
  if (!row) return null;
  const link = links.find(
    (item) => item.organizationId === row.organizationId && item.partyId === row.tenantPartyId,
  );
  return link ? tenantClaims(claims, link) : null;
}

/** Writes on the tenant's own records in one landlord organization, in tenant mode. */
export function withinTenancyLink<T>(
  userId: string,
  link: TenancyLink,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withinTenant(userId, link, work);
}

export type TenancyLeaseRef = {
  link: TenancyLink;
  leaseId: string;
  contractId: string | null;
  unitId: string;
  propertyId: string | null;
  status: string;
  currency: string;
};

/** A lease the account is the tenant on, in whichever landlord organization. */
export async function findTenancyLease(
  userId: string,
  leaseId: string,
): Promise<TenancyLeaseRef | null> {
  const links = await loadTenancyLinks(userId);
  if (!links.length) return null;
  const [row] = await elevated((tx) =>
    tx
      .select({
        organizationId: leases.organizationId,
        tenantPartyId: leases.tenantPartyId,
        contractId: leases.contractId,
        unitId: leases.unitId,
        propertyId: units.propertyId,
        status: leases.status,
        currency: leases.currency,
      })
      .from(leases)
      .leftJoin(units, eq(units.id, leases.unitId))
      .where(eq(leases.id, leaseId))
      .limit(1),
  );
  if (!row) return null;
  const link = links.find(
    (item) => item.organizationId === row.organizationId && item.partyId === row.tenantPartyId,
  );
  if (!link) return null;
  return {
    link,
    leaseId,
    contractId: row.contractId,
    unitId: row.unitId,
    propertyId: row.propertyId,
    status: row.status,
    currency: row.currency,
  };
}

/** The organization of a request the account sent as tenant, with the matching link. */
export async function findTenancyRequestLink(
  userId: string,
  requestId: string,
): Promise<TenancyLink | null> {
  const links = await loadTenancyLinks(userId);
  if (!links.length) return null;
  const [row] = await elevated((tx) =>
    tx
      .select({
        organizationId: operationalRequests.organizationId,
        requesterPartyId: operationalRequests.requesterPartyId,
      })
      .from(operationalRequests)
      .where(eq(operationalRequests.id, requestId))
      .limit(1),
  );
  if (!row) return null;
  return (
    links.find(
      (item) => item.organizationId === row.organizationId && item.partyId === row.requesterPartyId,
    ) ?? null
  );
}

type LinkTenancy = Omit<MyTenancy, 'stays' | 'alerts'> & {
  reservationUnitIds: string[];
};

function viewingPassHref(viewingId: string, scheduledAt: Date | null): string | null {
  if (!scheduledAt) return null;
  const expires = new Date(scheduledAt.getTime() + 36 * 60 * 60 * 1000);
  if (expires.getTime() <= Date.now()) return null;
  try {
    const token = issueViewingPassToken(viewingId, expires);
    return `/viewing-pass?t=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

export type LeaseStatementRow = {
  leaseId: string;
  tenantPartyId: string;
  propertyId: string | null;
  unitId: string;
  currency: string;
  statement: LeaseStatement;
};

/**
 * Account statements for leases of one organization, read in the caller's transaction (tenant or
 * staff). With `partyId`, only that tenant's invoices count.
 */
export async function leaseStatementsInTx(
  tx: Tx,
  orgId: string,
  leaseIds: readonly string[],
  partyId?: string,
): Promise<Map<string, LeaseStatementRow>> {
  const ids = [...new Set(leaseIds)];
  if (!ids.length) return new Map();
  const [leaseRows, chequeRows, invoiceRows] = await Promise.all([
    tx
      .select({
        id: leases.id,
        tenantPartyId: leases.tenantPartyId,
        unitId: leases.unitId,
        propertyId: units.propertyId,
        currency: leases.currency,
        leaseTerms: sql<unknown>`${contracts.payloadSnapshot}->'leaseTerms'`,
        contractAmountMinor: sql<
          string | null
        >`${contracts.payloadSnapshot}->'amount'->>'amountMinor'`,
      })
      .from(leases)
      .leftJoin(units, eq(units.id, leases.unitId))
      .leftJoin(contracts, eq(contracts.id, leases.contractId))
      .where(and(eq(leases.organizationId, orgId), inArray(leases.id, ids))),
    tx
      .select({
        id: cheques.id,
        leaseId: cheques.leaseId,
        chequeNumber: cheques.chequeNumber,
        bankName: cheques.bankName,
        amountMinor: cheques.amountMinor,
        dueOn: cheques.dueOn,
        reviewStatus: cheques.reviewStatus,
      })
      .from(cheques)
      .where(and(eq(cheques.organizationId, orgId), inArray(cheques.leaseId, ids)))
      .orderBy(asc(cheques.dueOn))
      .limit(STATEMENT_ROWS),
    tx
      .select({
        id: invoices.id,
        leaseId: invoices.leaseId,
        number: invoices.invoiceNumber,
        status: invoices.status,
        issuedOn: invoices.issuedOn,
        dueOn: invoices.dueOn,
        totalMinor: invoices.totalMinor,
        paidMinor: invoices.paidMinor,
        billingPeriodStart: invoices.billingPeriodStart,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, orgId),
          inArray(invoices.leaseId, ids),
          ne(invoices.status, 'draft'),
          ...(partyId ? [eq(invoices.tenantPartyId, partyId)] : []),
        ),
      )
      .orderBy(asc(invoices.dueOn))
      .limit(STATEMENT_ROWS),
  ]);
  const today = muscatToday();
  return new Map(
    leaseRows.map((row) => [
      row.id,
      {
        leaseId: row.id,
        tenantPartyId: row.tenantPartyId,
        propertyId: row.propertyId,
        unitId: row.unitId,
        currency: row.currency,
        statement: buildLeaseStatement({
          terms: ledgerTermsOf({ leaseTerms: row.leaseTerms }),
          contractAmountMinor: row.contractAmountMinor,
          cheques: chequeRows
            .filter((cheque) => cheque.leaseId === row.id)
            .map((cheque) => ({
              id: cheque.id,
              chequeNumber: cheque.chequeNumber,
              bankName: cheque.bankName,
              amountMinor: cheque.amountMinor.toString(),
              dueOn: String(cheque.dueOn),
              reviewStatus: cheque.reviewStatus,
            })),
          invoices: invoiceRows
            .filter((invoice) => invoice.leaseId === row.id)
            .map((invoice) => ({
              id: invoice.id,
              number: invoice.number,
              status: invoice.status,
              issuedOn: String(invoice.issuedOn),
              dueOn: String(invoice.dueOn),
              totalMinor: invoice.totalMinor.toString(),
              paidMinor: invoice.paidMinor.toString(),
              billingPeriodStart: invoice.billingPeriodStart
                ? String(invoice.billingPeriodStart)
                : null,
            })),
          today,
        }),
      },
    ]),
  );
}

async function loadLinkTenancy(userId: string, link: TenancyLink): Promise<LinkTenancy> {
  const { organizationId: org, partyId: party, landlord } = link;
  const policy = await loadTenantPolicy(org);
  return withinTenant(userId, link, async (tx) => {
    const [
      contractRows,
      signedRows,
      leaseRows,
      invoiceRows,
      paymentRows,
      reservationRows,
      viewingRows,
    ] = await Promise.all([
        tx
          .select({
            id: contracts.id,
            reference: contracts.reference,
            kind: contracts.kind,
            parentContractId: contracts.parentContractId,
            status: contracts.status,
            payload: contracts.payloadSnapshot,
            createdAt: contracts.createdAt,
          })
          .from(contracts)
          .where(
            and(
              eq(contracts.organizationId, org),
              eq(contracts.tenantPartyId, party),
              ne(contracts.status, 'draft'),
            ),
          )
          .orderBy(desc(contracts.createdAt))
          .limit(LIST_LIMIT),
        tx
          .select({ contractId: contractSignatures.contractId })
          .from(contractSignatures)
          .where(
            and(
              eq(contractSignatures.organizationId, org),
              eq(contractSignatures.signerPartyId, party),
              eq(contractSignatures.signerRole, 'tenant'),
            ),
          ),
        tx
          .select({
            id: leases.id,
            contractId: leases.contractId,
            status: leases.status,
            startsOn: leases.startsOn,
            endsOn: leases.endsOn,
            rentMinor: leases.rentMinor,
            currency: leases.currency,
            unitCode: units.code,
            unitAr: units.nameAr,
            unitEn: units.nameEn,
            sourceType: sql<string | null>`${contracts.payloadSnapshot}->'source'->>'type'`,
            contractReference: contracts.reference,
            leaseTerms: sql<unknown>`${contracts.payloadSnapshot}->'leaseTerms'`,
            contractAmountMinor: sql<
              string | null
            >`${contracts.payloadSnapshot}->'amount'->>'amountMinor'`,
          })
          .from(leases)
          .leftJoin(units, eq(units.id, leases.unitId))
          .leftJoin(contracts, eq(contracts.id, leases.contractId))
          .where(
            and(
              eq(leases.organizationId, org),
              eq(leases.tenantPartyId, party),
              ne(leases.status, 'draft'),
            ),
          )
          .orderBy(desc(leases.startsOn))
          .limit(LIST_LIMIT),
        tx
          .select({
            id: invoices.id,
            number: invoices.invoiceNumber,
            status: invoices.status,
            issuedOn: invoices.issuedOn,
            dueOn: invoices.dueOn,
            totalMinor: invoices.totalMinor,
            paidMinor: invoices.paidMinor,
            currency: invoices.currency,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.organizationId, org),
              eq(invoices.tenantPartyId, party),
              ne(invoices.status, 'draft'),
            ),
          )
          .orderBy(desc(invoices.dueOn))
          .limit(LIST_LIMIT),
        tx
          .select({
            id: payments.id,
            invoiceNumber: invoices.invoiceNumber,
            status: payments.status,
            method: payments.method,
            amountMinor: payments.amountMinor,
            refundedMinor: payments.refundedMinor,
            currency: payments.currency,
            receivedAt: payments.receivedAt,
          })
          .from(payments)
          .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
          .where(and(eq(payments.organizationId, org), eq(invoices.tenantPartyId, party)))
          .orderBy(desc(payments.receivedAt))
          .limit(LIST_LIMIT),
        tx
          .select({
            id: reservations.id,
            unitId: reservations.unitId,
            status: reservations.status,
            expiresAt: reservations.expiresAt,
            currency: reservations.currency,
            terms: reservations.termsSnapshot,
          })
          .from(reservations)
          .where(and(eq(reservations.organizationId, org), eq(reservations.tenantPartyId, party)))
          .orderBy(desc(reservations.createdAt))
          .limit(LIST_LIMIT),
        tx
          .select({
            id: viewingRequests.id,
            reference: viewingRequests.reference,
            status: viewingRequests.status,
            scheduledAt: viewingRequests.scheduledAt,
            preferredAt: viewingRequests.preferredAt,
            createdAt: viewingRequests.createdAt,
            unitCode: units.code,
            unitAr: units.nameAr,
            unitEn: units.nameEn,
            propertyNameAr: properties.nameAr,
            propertyNameEn: properties.nameEn,
          })
          .from(viewingRequests)
          .innerJoin(units, eq(units.id, viewingRequests.unitId))
          .innerJoin(properties, eq(properties.id, units.propertyId))
          .where(
            and(eq(viewingRequests.organizationId, org), eq(viewingRequests.prospectPartyId, party)),
          )
          .orderBy(desc(viewingRequests.createdAt))
          .limit(LIST_LIMIT),
      ]);

    const statementLeases = leaseRows.filter(
      (row) => row.sourceType !== 'stay_booking' && STATEMENT_LEASE_STATUS.has(row.status),
    );
    const statementLeaseIds = statementLeases.map((row) => row.id);
    const [statements, requestRows] = await Promise.all([
      leaseStatementsInTx(tx, org, statementLeaseIds, party),
      tx
        .select({
          id: operationalRequests.id,
          reference: operationalRequests.reference,
          type: operationalRequests.type,
          subject: operationalRequests.subject,
          description: operationalRequests.description,
          priority: operationalRequests.priority,
          status: operationalRequests.status,
          metadata: operationalRequests.metadata,
          createdAt: operationalRequests.createdAt,
          updatedAt: operationalRequests.updatedAt,
          unitCode: units.code,
          unitAr: units.nameAr,
          unitEn: units.nameEn,
        })
        .from(operationalRequests)
        .leftJoin(units, eq(units.id, operationalRequests.unitId))
        .where(
          and(
            eq(operationalRequests.organizationId, org),
            eq(operationalRequests.requesterPartyId, party),
            eq(operationalRequests.source, TENANT_REQUEST_SOURCE),
          ),
        )
        .orderBy(desc(operationalRequests.createdAt))
        .limit(LIST_LIMIT),
    ]);
    const statementItems: TenancyStatement[] = statementLeases.flatMap((row) => {
      const found = statements.get(row.id);
      if (!found) return [];
      return [
        {
          leaseId: row.id,
          contractId: row.contractId,
          contractReference: row.contractReference,
          landlord,
          status: row.status,
          startsOn: String(row.startsOn),
          endsOn: String(row.endsOn),
          currency: row.currency,
          unitCode: row.unitCode,
          unitAr: row.unitAr,
          unitEn: row.unitEn,
          propertyId: found.propertyId,
          maintenanceBlocked:
            found.statement.arrears.totalMinor !== '0' &&
            maintenanceBlockedByPolicy(policy, found.propertyId),
          statement: found.statement,
        },
      ];
    });
    const requestItems: TenantRequest[] = requestRows.map((row) => tenantRequestFromRow(row, org));

    const signed = new Set(signedRows.map((row) => row.contractId));
    const contractItems: TenancyContract[] = contractRows.map((row) => {
      const payload = obj(row.payload);
      const unit = obj(payload.unit);
      const amount = obj(payload.amount);
      const source = obj(payload.source);
      return {
        id: row.id,
        landlord,
        reference: row.reference ?? row.id.slice(0, 8).toUpperCase(),
        kind: row.kind,
        parentContractId: row.parentContractId,
        status: row.status,
        tenantSigned: signed.has(row.id),
        startsOn: str(payload.startsOn),
        endsOn: str(payload.endsOn),
        unitCode: str(unit.code),
        unitAr: str(unit.nameAr),
        unitEn: str(unit.nameEn),
        amountMinor: str(amount.amountMinor),
        currency: str(amount.currency),
        stayReference: source.type === 'stay_booking' ? str(source.referenceCode) : null,
        createdAt: iso(row.createdAt),
      };
    });
    const leaseItems: TenancyLease[] = leaseRows.map((row) => ({
      id: row.id,
      contractId: row.contractId,
      landlord,
      status: row.status,
      startsOn: String(row.startsOn),
      endsOn: String(row.endsOn),
      rentMinor: row.rentMinor.toString(),
      currency: row.currency,
      unitCode: row.unitCode,
      unitAr: row.unitAr,
      unitEn: row.unitEn,
      fromStay: row.sourceType === 'stay_booking',
    }));
    const invoiceItems: TenancyInvoice[] = invoiceRows.map((row) => ({
      id: row.id,
      landlord,
      number: row.number,
      status: row.status,
      issuedOn: String(row.issuedOn),
      dueOn: String(row.dueOn),
      totalMinor: row.totalMinor.toString(),
      paidMinor: row.paidMinor.toString(),
      currency: row.currency,
    }));
    const paymentItems: TenancyPayment[] = paymentRows.map((row) => ({
      id: row.id,
      landlord,
      invoiceNumber: row.invoiceNumber,
      status: row.status,
      method: row.method,
      amountMinor: row.amountMinor.toString(),
      refundedMinor: row.refundedMinor.toString(),
      currency: row.currency,
      receivedAt: iso(row.receivedAt),
    }));
    const reservationItems: TenancyReservation[] = reservationRows.map((row) => {
      const terms = obj(row.terms);
      const mode = terms.mode === 'rent' || terms.mode === 'sale' ? terms.mode : null;
      const lifecycle = lifecycleOf(terms);
      return {
        id: row.id,
        landlord,
        referenceCode: str(terms.referenceCode),
        mode,
        status: row.status,
        handover: handoverAwaitingTenant(lifecycle)
          ? 'awaiting_acceptance'
          : handoverDefectsOpen(lifecycle)
            ? 'defects_open'
            : null,
        expiresAt: iso(row.expiresAt),
        awaitingPayment: terms.awaitingPublicDepositPayment === true,
        depositMinor: str(terms.depositMinor),
        currency: str(terms.currency) ?? row.currency,
        unitCode: null,
        unitAr: null,
        unitEn: null,
      };
    });
    const viewingItems: TenancyViewing[] = viewingRows.map((row) => ({
      id: row.id,
      landlord,
      reference: row.reference,
      status: row.status,
      scheduledAt: iso(row.scheduledAt) || null,
      preferredAt: iso(row.preferredAt) || null,
      createdAt: iso(row.createdAt),
      unitCode: row.unitCode,
      unitAr: row.unitAr,
      unitEn: row.unitEn,
      propertyNameAr: row.propertyNameAr,
      propertyNameEn: row.propertyNameEn,
      passHref:
        row.status === 'scheduled' ? viewingPassHref(row.id, row.scheduledAt ?? null) : null,
    }));
    return {
      contracts: contractItems,
      leases: leaseItems,
      invoices: invoiceItems,
      payments: paymentItems,
      reservations: reservationItems,
      viewings: viewingItems,
      statements: statementItems,
      requests: requestItems,
      reservationUnitIds: reservationRows.map((row) => row.unitId),
    };
  });
}

/** Unit names for reservations: tenant mode only shows units the tenant already leases. */
async function unitLabels(unitIds: string[]) {
  if (!unitIds.length) return new Map<string, { code: string; ar: string; en: string }>();
  const rows = await elevated((tx) =>
    tx
      .select({ id: units.id, code: units.code, ar: units.nameAr, en: units.nameEn })
      .from(units)
      .where(inArray(units.id, [...new Set(unitIds)])),
  );
  return new Map(rows.map((row) => [row.id, { code: row.code, ar: row.ar, en: row.en }]));
}

async function loadStays(userId: string, links: TenancyLink[]): Promise<TenancyStay[]> {
  try {
    const { items } = await listGuestStayBookingsOnNeon(
      userId,
      links.map((link) => link.partyId),
    );
    return items.map((item) => ({
      id: item.id,
      referenceCode: item.referenceCode,
      status: item.status,
      checkInOn: item.checkInOn,
      checkOutOn: item.checkOutOn,
      totalMinor: item.totalMinor,
      currency: item.currency,
      titleAr: item.listingTitleAr ?? null,
      titleEn: item.listingTitleEn ?? null,
      canRequestDepositRefund: Boolean(item.canRequestDepositRefund),
    }));
  } catch {
    return [];
  }
}

function stayIntentKind(idempotencyKey: string): StayBookingPaymentKind {
  if (idempotencyKey.startsWith('reschedule_topup:')) return 'reschedule_topup';
  if (idempotencyKey.startsWith('stay_deposit:')) return 'deposit';
  if (
    idempotencyKey.startsWith('stay_booking:') ||
    idempotencyKey.startsWith('stay-book-') ||
    idempotencyKey.startsWith('booking:') ||
    idempotencyKey.includes('instant') ||
    idempotencyKey.includes('request')
  ) {
    return 'booking';
  }
  return 'other';
}

/** Succeeded stay checkout / deposit intents → tenant invoices + payments lists. */
async function loadStayFinance(links: TenancyLink[]): Promise<{
  invoices: TenancyInvoice[];
  payments: TenancyPayment[];
}> {
  if (!links.length) return { invoices: [], payments: [] };
  const byOrg = new Map<string, TenancyLink>();
  for (const link of links) byOrg.set(`${link.organizationId}:${link.partyId}`, link);

  try {
    const rows = await elevated(async (tx) => {
      const partyIds = [...new Set(links.map((link) => link.partyId))];
      const orgIds = [...new Set(links.map((link) => link.organizationId))];
      return tx
        .select({
          intentId: stayPaymentIntents.id,
          amountMinor: stayPaymentIntents.amountMinor,
          currency: stayPaymentIntents.currency,
          provider: stayPaymentIntents.provider,
          idempotencyKey: stayPaymentIntents.idempotencyKey,
          paidAt: stayPaymentIntents.updatedAt,
          organizationId: stayBookings.organizationId,
          guestPartyId: stayBookings.guestPartyId,
          bookingId: stayBookings.id,
          referenceCode: stayBookings.referenceCode,
          checkInOn: stayBookings.checkInOn,
        })
        .from(stayPaymentIntents)
        .innerJoin(stayBookings, eq(stayBookings.id, stayPaymentIntents.bookingId))
        .where(
          and(
            inArray(stayBookings.organizationId, orgIds),
            inArray(stayBookings.guestPartyId, partyIds),
            eq(stayPaymentIntents.status, 'succeeded'),
          ),
        )
        .orderBy(desc(stayPaymentIntents.updatedAt))
        .limit(LIST_LIMIT * 2);
    });

    const payments: TenancyPayment[] = [];
    const bookingTotals = new Map<
      string,
      {
        landlord: TenancyLandlord;
        referenceCode: string;
        currency: string;
        total: bigint;
        paidAt: string;
        checkInOn: string;
        lastIntentId: string;
      }
    >();

    for (const row of rows) {
      const link = byOrg.get(`${row.organizationId}:${row.guestPartyId ?? ''}`);
      if (!link) continue;
      const paidAt = iso(row.paidAt);
      const kind = stayIntentKind(row.idempotencyKey);
      const receiptHref = `/stays/booking/receipt?ref=${encodeURIComponent(row.referenceCode)}&doc=payment&pay=${encodeURIComponent(row.intentId)}`;
      payments.push({
        id: row.intentId,
        landlord: link.landlord,
        invoiceNumber: row.referenceCode,
        status: 'succeeded',
        method: row.provider ?? 'sandbox',
        amountMinor: row.amountMinor.toString(),
        refundedMinor: '0',
        currency: row.currency,
        receivedAt: paidAt,
        receiptHref,
        stayReference: row.referenceCode,
        stayKind: kind,
      });
      const bucket = bookingTotals.get(row.bookingId) ?? {
        landlord: link.landlord,
        referenceCode: row.referenceCode,
        currency: row.currency,
        total: 0n,
        paidAt,
        checkInOn: String(row.checkInOn),
        lastIntentId: row.intentId,
      };
      bucket.total += BigInt(row.amountMinor.toString());
      if (paidAt > bucket.paidAt) {
        bucket.paidAt = paidAt;
        bucket.lastIntentId = row.intentId;
      }
      bookingTotals.set(row.bookingId, bucket);
    }

    const invoices: TenancyInvoice[] = [...bookingTotals.entries()].map(([bookingId, bucket]) => ({
      id: `stay-invoice:${bookingId}`,
      landlord: bucket.landlord,
      number: bucket.referenceCode,
      status: 'paid',
      issuedOn: bucket.checkInOn,
      dueOn: bucket.checkInOn,
      totalMinor: bucket.total.toString(),
      paidMinor: bucket.total.toString(),
      currency: bucket.currency,
      stayReference: bucket.referenceCode,
      receiptHref: `/stays/booking/receipt?ref=${encodeURIComponent(bucket.referenceCode)}&doc=payment&pay=${encodeURIComponent(bucket.lastIntentId)}`,
    }));

    return { invoices, payments };
  } catch {
    return { invoices: [], payments: [] };
  }
}

function muscatToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' });
}

/** The account's current awards as a tenant, from every landlord, most prestigious first. */
export async function loadMyTenantBadges(userId: string): Promise<BadgeChip[]> {
  if (!hasDatabaseUrl()) return [];
  const links = await loadTenancyLinks(userId);
  if (!links.length) return [];
  const chips = await withTimeoutFallback(
    activeBadgeChips(links.map((link) => ({ type: 'tenant' as const, id: link.partyId }))),
    2_500,
    new Map<string, BadgeChip[]>(),
    'tenant-badges',
  );
  return [...chips.values()].flat().sort((a, b) => badgePrestige(b) - badgePrestige(a));
}

/** Everything the account rents or booked, across every landlord, with what needs attention. */
export const loadMyTenancy = cache(async (userId: string): Promise<MyTenancy> => {
  if (!hasDatabaseUrl()) return EMPTY_TENANCY;
  const links = await loadTenancyLinks(userId);
  const [perLink, stays, stayFinance] = await Promise.all([
    Promise.all(links.map((link) => loadLinkTenancy(userId, link))),
    loadStays(userId, links),
    loadStayFinance(links),
  ]);
  const labels = await unitLabels(perLink.flatMap((item) => item.reservationUnitIds));
  const reservationsWithUnits = perLink.flatMap((item) =>
    item.reservations.map((reservation, index) => {
      const label = labels.get(item.reservationUnitIds[index] ?? '');
      return label
        ? { ...reservation, unitCode: label.code, unitAr: label.ar, unitEn: label.en }
        : reservation;
    }),
  );
  const data = {
    contracts: perLink
      .flatMap((item) => item.contracts)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    leases: perLink
      .flatMap((item) => item.leases)
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn)),
    invoices: [...perLink.flatMap((item) => item.invoices), ...stayFinance.invoices].sort((a, b) =>
      b.dueOn.localeCompare(a.dueOn),
    ),
    payments: [...perLink.flatMap((item) => item.payments), ...stayFinance.payments].sort((a, b) =>
      b.receivedAt.localeCompare(a.receivedAt),
    ),
    reservations: reservationsWithUnits.sort((a, b) => b.expiresAt.localeCompare(a.expiresAt)),
    stays,
    viewings: perLink
      .flatMap((item) => item.viewings)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    statements: perLink
      .flatMap((item) => item.statements)
      .sort((a, b) => b.startsOn.localeCompare(a.startsOn)),
    requests: perLink
      .flatMap((item) => item.requests)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
  return { ...data, alerts: buildTenancyAlerts(data, muscatToday()) };
});
