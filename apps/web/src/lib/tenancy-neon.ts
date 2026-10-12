import 'server-only';
import { cache } from 'react';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { permissionsForRoles, type SessionClaims } from '@bhd-r/authz';
import {
  contractSignatures,
  contracts,
  createDatabase,
  invoices,
  leases,
  payments,
  reservations,
  units,
  type Database,
} from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { applySessionSettings, viewerTenantSettings } from '@/lib/db-session-settings';
import { listGuestStayBookingsOnNeon } from '@/lib/public-stays-guest-neon';
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
  type TenancyStay,
} from '@/lib/tenancy-shared';

type DbHandle = { db: Database };
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Row = Record<string, unknown>;

const globalForDb = globalThis as unknown as { __bhdRWebDb?: DbHandle };
const MAX_LANDLORDS = 12;
const LIST_LIMIT = 30;

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
      join parties p on lower(p.email) = lower(u.email) and p.status = 'active'
      join organizations o on o.id = p.organization_id and o.status = 'active'
      where u.id = ${userId}
        and u.disabled_at is null
        and u.email not like '%@identity.bhd-om.local'
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
            where tenant_party_id in (${partyIds}) and status in ('pending', 'confirmed')) as "bookings",
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

type LinkTenancy = Omit<MyTenancy, 'stays' | 'alerts'> & { reservationUnitIds: string[] };

async function loadLinkTenancy(userId: string, link: TenancyLink): Promise<LinkTenancy> {
  const { organizationId: org, partyId: party, landlord } = link;
  return withinTenant(userId, link, async (tx) => {
    const [contractRows, signedRows, leaseRows, invoiceRows, paymentRows, reservationRows] =
      await Promise.all([
        tx
          .select({
            id: contracts.id,
            reference: contracts.reference,
            kind: contracts.kind,
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
      ]);

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
      return {
        id: row.id,
        landlord,
        referenceCode: str(terms.referenceCode),
        mode,
        status: row.status,
        expiresAt: iso(row.expiresAt),
        awaitingPayment: terms.awaitingPublicDepositPayment === true,
        depositMinor: str(terms.depositMinor),
        currency: str(terms.currency) ?? row.currency,
        unitCode: null,
        unitAr: null,
        unitEn: null,
      };
    });
    return {
      contracts: contractItems,
      leases: leaseItems,
      invoices: invoiceItems,
      payments: paymentItems,
      reservations: reservationItems,
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

function muscatToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Muscat' });
}

/** Everything the account rents or booked, across every landlord, with what needs attention. */
export const loadMyTenancy = cache(async (userId: string): Promise<MyTenancy> => {
  if (!hasDatabaseUrl()) return EMPTY_TENANCY;
  const links = await loadTenancyLinks(userId);
  const [perLink, stays] = await Promise.all([
    Promise.all(links.map((link) => loadLinkTenancy(userId, link))),
    loadStays(userId, links),
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
    invoices: perLink
      .flatMap((item) => item.invoices)
      .sort((a, b) => b.dueOn.localeCompare(a.dueOn)),
    payments: perLink
      .flatMap((item) => item.payments)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    reservations: reservationsWithUnits.sort((a, b) => b.expiresAt.localeCompare(a.expiresAt)),
    stays,
  };
  return { ...data, alerts: buildTenancyAlerts(data, muscatToday()) };
});
