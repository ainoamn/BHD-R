import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { and, count, desc, eq, gte, inArray, lte, notInArray, or, sql } from 'drizzle-orm';
import { verifySessionToken, type SessionClaims } from '@bhd-r/authz';
import {
  createDatabase,
  contracts,
  invoices,
  leases,
  maintenanceTickets,
  payments,
  properties,
  stayBookings,
  units,
  workflowEvents,
  type Database,
} from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { ORG_WIDE_ROLES, scopedOwnerParty } from '@/lib/portal-access';
import { requireSessionSecret } from '@/lib/runtime-env';
import { apiFetch } from '@/lib/server-api';
import type { PortalOverview, PortalRole } from '@/lib/types';
import { withTimeoutFallback } from '@/lib/with-timeout';
import { applySessionSettings, viewerTenantSettings } from '@/lib/db-session-settings';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRWebDb?: DbHandle };

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

function getSharedDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRWebDb) {
    const { db } = createDatabase(url, { max: 8 });
    globalForDb.__bhdRWebDb = { db };
  }
  return globalForDb.__bhdRWebDb;
}

function ownerPartyScope(claims: SessionClaims): string | null {
  return scopedOwnerParty(claims);
}

function tenantPartyScope(claims: SessionClaims): string | null {
  if (!claims.roles.includes('tenant')) return null;
  if (claims.roles.some((role) => ORG_WIDE_ROLES.has(role))) return null;
  return claims.partyId;
}

async function readClaims(): Promise<SessionClaims | null> {
  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) return null;
  try {
    return await verifySessionToken(token, sessionSecret());
  } catch {
    return null;
  }
}

async function withinViewerTenant<T>(
  claims: SessionClaims,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { db } = getSharedDatabase();
  return db.transaction(async (transaction) => {
    await applySessionSettings(transaction, viewerTenantSettings(claims));
    return work(transaction);
  });
}

/** Active leases that are really closed stays / terminated contracts must not raise the 60-day alert. */
function leaseStillLiveForExpiryAlert(orgId: string) {
  return sql`not exists (
    select 1
    from ${contracts} c
    left join ${stayBookings} b
      on b.organization_id = ${orgId}::uuid
     and b.id::text = c.payload_snapshot->'source'->>'stayBookingId'
    where c.id = ${leases.contractId}
      and c.organization_id = ${orgId}::uuid
      and (
        c.status in ('terminated', 'void')
        or (
          c.payload_snapshot->'source'->>'type' = 'stay_booking'
          and b.status in (
            'checked_out', 'closed', 'cancelled', 'expired', 'no_show', 'payment_failed'
          )
        )
      )
  )`;
}

async function organizationOverviewFromDb(claims: SessionClaims): Promise<PortalOverview> {
  return withinViewerTenant(claims, async (transaction) => {
    const today = new Date().toISOString().slice(0, 10);
    const expiryCutoff = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const ownerPartyId = ownerPartyScope(claims);
    const orgId = claims.organizationId!;

    // Daily stays left active after check-out were inflating the 60-day expiry alert.
    try {
      const { repairOpenStayLeasesAfterCheckoutInTx } =
        await import('@/lib/stay-contract-close-neon');
      await repairOpenStayLeasesAfterCheckoutInTx(transaction, orgId);
    } catch (error) {
      console.error('stay lease checkout repair', error);
    }

    const liveExpiry = leaseStillLiveForExpiryAlert(orgId);

    const propertyFilter = ownerPartyId
      ? and(eq(properties.organizationId, orgId), eq(properties.ownerPartyId, ownerPartyId))
      : eq(properties.organizationId, orgId);

    const ownedPropertyIds = ownerPartyId
      ? (
          await transaction.select({ id: properties.id }).from(properties).where(propertyFilter)
        ).map((row) => row.id)
      : null;

    const unitFilter =
      ownedPropertyIds !== null
        ? ownedPropertyIds.length
          ? and(
              eq(units.organizationId, orgId),
              eq(units.status, 'active'),
              inArray(units.propertyId, ownedPropertyIds),
            )
          : and(eq(units.organizationId, orgId), sql`false`)
        : and(eq(units.organizationId, orgId), eq(units.status, 'active'));

    const leaseFilter = ownerPartyId
      ? and(
          eq(leases.organizationId, orgId),
          eq(leases.status, 'active'),
          eq(leases.ownerPartyId, ownerPartyId),
          liveExpiry,
        )
      : and(eq(leases.organizationId, orgId), eq(leases.status, 'active'), liveExpiry);

    const expiringFilter = ownerPartyId
      ? and(
          eq(leases.organizationId, orgId),
          eq(leases.status, 'active'),
          eq(leases.ownerPartyId, ownerPartyId),
          gte(leases.endsOn, today),
          lte(leases.endsOn, expiryCutoff),
          liveExpiry,
        )
      : and(
          eq(leases.organizationId, orgId),
          eq(leases.status, 'active'),
          gte(leases.endsOn, today),
          lte(leases.endsOn, expiryCutoff),
          liveExpiry,
        );

    const countsQuery = Promise.all([
      transaction.select({ value: count() }).from(properties).where(propertyFilter),
      transaction.select({ value: count() }).from(units).where(unitFilter),
      transaction.select({ value: count() }).from(leases).where(leaseFilter),
      ownerPartyId
        ? transaction
            .select({ value: count() })
            .from(maintenanceTickets)
            .innerJoin(units, eq(maintenanceTickets.unitId, units.id))
            .innerJoin(properties, eq(units.propertyId, properties.id))
            .where(
              and(
                eq(maintenanceTickets.organizationId, orgId),
                eq(properties.ownerPartyId, ownerPartyId),
                inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress']),
              ),
            )
        : transaction
            .select({ value: count() })
            .from(maintenanceTickets)
            .where(
              and(
                eq(maintenanceTickets.organizationId, orgId),
                inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress']),
              ),
            ),
      transaction.select({ value: count() }).from(leases).where(expiringFilter),
    ]);

    const totalsQuery = Promise.all([
      transaction
        .select({
          currency: payments.currency,
          amountMinor: sql<string>`coalesce(sum(${payments.amountMinor} - ${payments.refundedMinor}), 0)`,
        })
        .from(payments)
        .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
        .innerJoin(leases, eq(invoices.leaseId, leases.id))
        .where(
          and(
            eq(payments.organizationId, orgId),
            inArray(payments.status, ['succeeded', 'partially_refunded', 'refunded']),
            ...(ownerPartyId ? [eq(leases.ownerPartyId, ownerPartyId)] : []),
          ),
        )
        .groupBy(payments.currency),
      transaction
        .select({
          id: workflowEvents.id,
          title: workflowEvents.eventType,
          occurredAt: workflowEvents.occurredAt,
          status: workflowEvents.toStatus,
          resourceType: workflowEvents.resourceType,
          resourceId: workflowEvents.resourceId,
        })
        .from(workflowEvents)
        .where(
          and(
            eq(workflowEvents.organizationId, orgId),
            notInArray(workflowEvents.resourceType, [
              'reservation_esign_evidence',
              'reservation_document',
              'reservation_contract_esign',
            ]),
            // Events are organization-wide; a building owner's feed would show other owners'.
            ...(ownerPartyId ? [sql`false`] : []),
          ),
        )
        .orderBy(desc(workflowEvents.occurredAt))
        .limit(8),
      ownerPartyId
        ? transaction
            .select({ value: count() })
            .from(invoices)
            .innerJoin(leases, eq(invoices.leaseId, leases.id))
            .where(
              and(
                eq(invoices.organizationId, orgId),
                inArray(invoices.status, ['issued', 'partially_paid', 'overdue']),
                eq(leases.ownerPartyId, ownerPartyId),
              ),
            )
        : transaction
            .select({ value: count() })
            .from(invoices)
            .where(
              and(
                eq(invoices.organizationId, orgId),
                inArray(invoices.status, ['issued', 'partially_paid', 'overdue']),
              ),
            ),
      transaction
        .select({ value: count() })
        .from(stayBookings)
        .where(
          ownedPropertyIds !== null
            ? ownedPropertyIds.length
              ? and(
                  eq(stayBookings.organizationId, orgId),
                  inArray(stayBookings.propertyId, ownedPropertyIds),
                )
              : sql`false`
            : eq(stayBookings.organizationId, orgId),
        ),
    ]);

    // One pipelined batch: both groups are independent.
    const [
      [propertyCount, unitCount, activeLeaseCount, openMaintenanceCount, expiringContracts],
      [collected, activity, openInvoicesRows, stayBookingRows],
    ] = await Promise.all([countsQuery, totalsQuery]);

    const activeUnits = Number(unitCount[0]?.value ?? 0);
    const occupied = Number(activeLeaseCount[0]?.value ?? 0);
    const openTickets = Number(openMaintenanceCount[0]?.value ?? 0);
    const expiring = Number(expiringContracts[0]?.value ?? 0);
    const propertiesTotal = Number(propertyCount[0]?.value ?? 0);
    const vacantUnits = Math.max(0, activeUnits - occupied);
    const openInvoices = Number(openInvoicesRows[0]?.value ?? 0);
    const stayBookingCount = Number(stayBookingRows[0]?.value ?? 0);

    const alerts: NonNullable<PortalOverview['alerts']> = [];
    if (openTickets > 0)
      alerts.push({ severity: 'danger', code: 'open_tickets', count: openTickets });
    if (expiring > 0)
      alerts.push({ severity: 'warning', code: 'expiring_leases', count: expiring });
    if (openInvoices > 0)
      alerts.push({ severity: 'warning', code: 'open_invoices', count: openInvoices });
    if (vacantUnits > 0)
      alerts.push({ severity: 'info', code: 'vacant_units', count: vacantUnits });
    if (stayBookingCount > 0)
      alerts.push({ severity: 'info', code: 'stay_bookings', count: stayBookingCount });

    return {
      properties: propertiesTotal,
      units: activeUnits,
      activeLeases: occupied,
      vacantUnits,
      openInvoices,
      occupancyPercent: activeUnits ? Math.round((occupied / activeUnits) * 10_000) / 100 : 0,
      collected,
      openTickets,
      expiringContracts: expiring,
      alerts,
      recentActivity: activity.map((row) => ({
        id: row.id,
        title: row.title,
        occurredAt:
          row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt),
        ...(row.status ? { status: row.status } : {}),
        ...(row.resourceType ? { resourceType: row.resourceType } : {}),
        ...(row.resourceId ? { resourceId: row.resourceId } : {}),
      })),
      generatedAt: new Date().toISOString(),
    };
  });
}

async function withProfileCompletenessAlerts(
  claims: SessionClaims,
  overview: PortalOverview,
): Promise<PortalOverview> {
  try {
    const { loadProfileCompletenessSummary } = await import('@/lib/profile-completeness-neon');
    const completeness = await loadProfileCompletenessSummary(claims);
    const alerts = [...(overview.alerts ?? [])];
    if (completeness.ownerMissing > 0) {
      alerts.push({
        severity: 'warning',
        code: 'incomplete_owner_profile',
        count: completeness.ownerMissing,
      });
    }
    if (completeness.buildingsMissing > 0) {
      alerts.push({
        severity: 'warning',
        code: 'incomplete_buildings',
        count: completeness.buildingsMissing,
      });
    }
    return { ...overview, alerts };
  } catch (error) {
    console.error('profile completeness alerts', error);
    return overview;
  }
}

async function tenantOverviewFromDb(claims: SessionClaims): Promise<PortalOverview> {
  return withinViewerTenant(claims, async (transaction) => {
    const today = new Date().toISOString().slice(0, 10);
    const expiryCutoff = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const tenantPartyId = tenantPartyScope(claims);
    const orgId = claims.organizationId!;

    const leaseWhere = tenantPartyId
      ? and(
          eq(leases.organizationId, orgId),
          eq(leases.status, 'active'),
          eq(leases.tenantPartyId, tenantPartyId),
        )
      : and(eq(leases.organizationId, orgId), eq(leases.status, 'active'));

    const invoiceWhere = tenantPartyId
      ? and(eq(invoices.organizationId, orgId), eq(invoices.tenantPartyId, tenantPartyId))
      : eq(invoices.organizationId, orgId);

    const tenantLiveExpiry = leaseStillLiveForExpiryAlert(orgId);
    const expiringWhere = tenantPartyId
      ? and(
          eq(leases.organizationId, orgId),
          eq(leases.status, 'active'),
          eq(leases.tenantPartyId, tenantPartyId),
          gte(leases.endsOn, today),
          lte(leases.endsOn, expiryCutoff),
          tenantLiveExpiry,
        )
      : and(
          eq(leases.organizationId, orgId),
          eq(leases.status, 'active'),
          gte(leases.endsOn, today),
          lte(leases.endsOn, expiryCutoff),
          tenantLiveExpiry,
        );

    const tenantUnitIds = tenantPartyId
      ? (
          await transaction
            .select({ unitId: leases.unitId })
            .from(leases)
            .where(and(eq(leases.organizationId, orgId), eq(leases.tenantPartyId, tenantPartyId)))
        ).map((row) => row.unitId)
      : [];

    const maintenanceWhere = tenantPartyId
      ? and(
          eq(maintenanceTickets.organizationId, orgId),
          inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress']),
          or(
            eq(maintenanceTickets.openedByPartyId, tenantPartyId),
            tenantUnitIds.length
              ? inArray(maintenanceTickets.unitId, [...new Set(tenantUnitIds)])
              : sql`false`,
          ),
        )
      : and(
          eq(maintenanceTickets.organizationId, orgId),
          inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress']),
        );

    const [leaseCount, maintenanceCount, expiringContracts, collected, activity] =
      await Promise.all([
        transaction.select({ value: count() }).from(leases).where(leaseWhere),
        transaction.select({ value: count() }).from(maintenanceTickets).where(maintenanceWhere),
        transaction.select({ value: count() }).from(leases).where(expiringWhere),
        tenantPartyId
          ? transaction
              .select({
                currency: payments.currency,
                amountMinor: sql<string>`coalesce(sum(${payments.amountMinor} - ${payments.refundedMinor}), 0)`,
              })
              .from(payments)
              .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
              .where(
                and(
                  eq(payments.organizationId, orgId),
                  eq(invoices.tenantPartyId, tenantPartyId),
                  inArray(payments.status, ['succeeded', 'partially_refunded', 'refunded']),
                ),
              )
              .groupBy(payments.currency)
          : transaction
              .select({
                currency: payments.currency,
                amountMinor: sql<string>`coalesce(sum(${payments.amountMinor} - ${payments.refundedMinor}), 0)`,
              })
              .from(payments)
              .where(
                and(
                  eq(payments.organizationId, orgId),
                  inArray(payments.status, ['succeeded', 'partially_refunded', 'refunded']),
                ),
              )
              .groupBy(payments.currency),
        transaction
          .select({
            id: invoices.id,
            title: invoices.invoiceNumber,
            occurredAt: invoices.createdAt,
            status: invoices.status,
          })
          .from(invoices)
          .where(invoiceWhere)
          .orderBy(desc(invoices.createdAt))
          .limit(8),
      ]);

    const openTickets = Number(maintenanceCount[0]?.value ?? 0);
    return {
      occupancyPercent: null,
      activeLeases: Number(leaseCount[0]?.value ?? 0),
      collected,
      openTickets,
      expiringContracts: Number(expiringContracts[0]?.value ?? 0),
      alerts:
        openTickets > 0
          ? [{ severity: 'danger' as const, code: 'open_tickets', count: openTickets }]
          : [],
      recentActivity: activity.map((row) => ({
        id: row.id,
        title: row.title,
        occurredAt:
          row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt),
        ...(row.status ? { status: row.status } : {}),
      })),
      generatedAt: new Date().toISOString(),
    };
  });
}

/** Guards and technicians see the portfolio counts, not the money. */
function withoutFinanceFor(claims: SessionClaims, overview: PortalOverview): PortalOverview {
  if (claims.permissions.includes('payment.read') || claims.permissions.includes('invoice.read'))
    return overview;
  return {
    ...overview,
    collected: [],
    openInvoices: null,
    alerts: (overview.alerts ?? []).filter((alert) => alert.code !== 'open_invoices'),
  };
}

const emptyOverview = (): PortalOverview => ({
  occupancyPercent: null,
  collected: [],
  openTickets: null,
  expiringContracts: null,
  recentActivity: [],
  alerts: [],
});

/**
 * WAZEN-style path: read Neon directly from the Next app when DATABASE_URL is set.
 * Avoids waiting on Render Nest cold-start for the owner/developer/tenant dashboard.
 */
export const loadPortalOverview = cache(async (portal: PortalRole): Promise<PortalOverview> => {
  if (hasDatabaseUrl() && portal !== 'platform') {
    const claims = await readClaims();
    if (claims?.organizationId) {
      try {
        if (portal === 'tenant') {
          const orgWide = claims.roles.some((role) => ORG_WIDE_ROLES.has(role));
          if (!orgWide && !tenantPartyScope(claims)) return emptyOverview();
          return await withTimeoutFallback(
            tenantOverviewFromDb(claims),
            3_000,
            emptyOverview(),
            'tenant-overview-neon',
          );
        }
        const overview = await withTimeoutFallback(
          organizationOverviewFromDb(claims).then((row) =>
            withProfileCompletenessAlerts(claims, row),
          ),
          4_000,
          emptyOverview(),
          'org-overview-neon',
        );
        return withoutFinanceFor(claims, overview);
      } catch {
        /* fall through to Nest / empty */
      }
    }
  }

  try {
    return await Promise.race([
      apiFetch<PortalOverview>(`/v1/${portal}/overview`),
      new Promise<PortalOverview>((resolve) => {
        setTimeout(() => resolve(emptyOverview()), 4_000);
      }),
    ]);
  } catch {
    return emptyOverview();
  }
});
