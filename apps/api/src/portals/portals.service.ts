import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import {
  addresses,
  contracts,
  invoices,
  leases,
  maintenanceTickets,
  organizations,
  parties,
  payments,
  properties,
  units,
  workflowEvents,
} from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService } from '../database/database.service.js';
import { LeasingService } from '../leasing/leasing.service.js';

const ORG_WIDE_ROLES = new Set([
  'organization_admin',
  'property_manager',
  'finance_manager',
  'maintenance_agent',
  'auditor',
  'platform_admin',
  'platform_support',
  'developer_admin',
]);

/** Tenant portal actors (no staff roles) — scope by tenant party. */
function tenantPartyScope(claims: SessionClaims): string | null {
  if (!claims.partyId) return null;
  if (!claims.roles.includes('tenant')) return null;
  if (claims.roles.some((role) => ORG_WIDE_ROLES.has(role))) return null;
  return claims.partyId;
}

/**
 * Owner/developer portfolio scope.
 * Org-wide ops staff keep full org metrics; SSO owners with partyId see their properties only.
 */
function ownerPartyScope(claims: SessionClaims): string | null {
  if (!claims.partyId) return null;
  if (claims.roles.some((role) => ORG_WIDE_ROLES.has(role))) return null;
  return claims.partyId;
}

@Injectable()
export class PortalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly leasing: LeasingService,
  ) {}

  platformOverview() {
    return this.database.asSystem(async (transaction) => {
      const today = new Date().toISOString().slice(0, 10);
      const expiryCutoff = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
      const [organizationCount, propertyCount, unitCount, activeLeaseCount, openTickets, expiring] =
        await Promise.all([
          transaction.select({ value: count() }).from(organizations),
          transaction.select({ value: count() }).from(properties),
          transaction.select({ value: count() }).from(units).where(eq(units.status, 'active')),
          transaction.select({ value: count() }).from(leases).where(eq(leases.status, 'active')),
          transaction
            .select({ value: count() })
            .from(maintenanceTickets)
            .where(inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress'])),
          transaction
            .select({ value: count() })
            .from(leases)
            .where(
              and(
                eq(leases.status, 'active'),
                gte(leases.endsOn, today),
                lte(leases.endsOn, expiryCutoff),
              ),
            ),
        ]);
      const [collected, activity] = await Promise.all([
        transaction
          .select({
            currency: payments.currency,
            amountMinor: sql<string>`coalesce(sum(${payments.amountMinor} - ${payments.refundedMinor}), 0)`,
          })
          .from(payments)
          .where(inArray(payments.status, ['succeeded', 'partially_refunded', 'refunded']))
          .groupBy(payments.currency),
        transaction
          .select({
            id: workflowEvents.id,
            title: workflowEvents.eventType,
            occurredAt: workflowEvents.occurredAt,
            status: workflowEvents.toStatus,
          })
          .from(workflowEvents)
          .orderBy(desc(workflowEvents.occurredAt))
          .limit(8),
      ]);
      const activeUnits = Number(unitCount[0]?.value ?? 0);
      const occupied = Number(activeLeaseCount[0]?.value ?? 0);
      return {
        organizations: organizationCount[0]?.value ?? 0,
        properties: propertyCount[0]?.value ?? 0,
        activeLeases: activeLeaseCount[0]?.value ?? 0,
        occupancyPercent: activeUnits ? Math.round((occupied / activeUnits) * 10_000) / 100 : 0,
        collected,
        openTickets: openTickets[0]?.value ?? 0,
        expiringContracts: expiring[0]?.value ?? 0,
        recentActivity: activity,
      };
    });
  }

  organizationOverview(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const today = new Date().toISOString().slice(0, 10);
      const expiryCutoff = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
      const ownerPartyId = ownerPartyScope(claims);
      const orgId = claims.organizationId!;

      const propertyFilter = ownerPartyId
        ? and(eq(properties.organizationId, orgId), eq(properties.ownerPartyId, ownerPartyId))
        : eq(properties.organizationId, orgId);

      const ownedPropertyIds = ownerPartyId
        ? (
            await transaction
              .select({ id: properties.id })
              .from(properties)
              .where(propertyFilter)
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
          )
        : and(eq(leases.organizationId, orgId), eq(leases.status, 'active'));

      const expiringFilter = ownerPartyId
        ? and(
            eq(leases.organizationId, orgId),
            eq(leases.status, 'active'),
            eq(leases.ownerPartyId, ownerPartyId),
            gte(leases.endsOn, today),
            lte(leases.endsOn, expiryCutoff),
          )
        : and(
            eq(leases.organizationId, orgId),
            eq(leases.status, 'active'),
            gte(leases.endsOn, today),
            lte(leases.endsOn, expiryCutoff),
          );

      const [propertyCount, unitCount, activeLeaseCount, openMaintenanceCount, expiringContracts] =
        await Promise.all([
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

      const collectedQuery = transaction
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
        .groupBy(payments.currency);

      const [collected, activity] = await Promise.all([
        collectedQuery,
        transaction
          .select({
            id: workflowEvents.id,
            title: workflowEvents.eventType,
            occurredAt: workflowEvents.occurredAt,
            status: workflowEvents.toStatus,
          })
          .from(workflowEvents)
          .where(eq(workflowEvents.organizationId, orgId))
          .orderBy(desc(workflowEvents.occurredAt))
          .limit(8),
      ]);
      const activeUnits = Number(unitCount[0]?.value ?? 0);
      const occupied = Number(activeLeaseCount[0]?.value ?? 0);
      const openTickets = Number(openMaintenanceCount[0]?.value ?? 0);
      const expiring = Number(expiringContracts[0]?.value ?? 0);
      const propertiesTotal = Number(propertyCount[0]?.value ?? 0);
      const vacantUnits = Math.max(0, activeUnits - occupied);

      const openInvoiceFilter = ownerPartyId
        ? and(
            eq(invoices.organizationId, orgId),
            inArray(invoices.status, ['issued', 'partially_paid', 'overdue']),
            eq(leases.ownerPartyId, ownerPartyId),
          )
        : and(
            eq(invoices.organizationId, orgId),
            inArray(invoices.status, ['issued', 'partially_paid', 'overdue']),
          );

      const openInvoicesQuery = ownerPartyId
        ? transaction
            .select({ value: count() })
            .from(invoices)
            .innerJoin(leases, eq(invoices.leaseId, leases.id))
            .where(openInvoiceFilter)
        : transaction.select({ value: count() }).from(invoices).where(openInvoiceFilter);

      const openInvoicesRows = await openInvoicesQuery;
      const openInvoices = Number(openInvoicesRows[0]?.value ?? 0);

      const alerts: Array<{
        severity: 'danger' | 'warning' | 'info';
        code: string;
        count: number;
      }> = [];
      if (openTickets > 0)
        alerts.push({ severity: 'danger', code: 'open_tickets', count: openTickets });
      if (expiring > 0)
        alerts.push({ severity: 'warning', code: 'expiring_leases', count: expiring });
      if (openInvoices > 0)
        alerts.push({ severity: 'warning', code: 'open_invoices', count: openInvoices });
      if (vacantUnits > 0)
        alerts.push({ severity: 'info', code: 'vacant_units', count: vacantUnits });

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
        recentActivity: activity,
        generatedAt: new Date().toISOString(),
        scopedToPartyId: ownerPartyId,
      };
    });
  }

  listProperties(claims: SessionClaims, options: { archivedOnly?: boolean } = {}) {
    return this.database.withinTenant(claims, async (transaction) => {
      const ownerPartyId = ownerPartyScope(claims);
      const rows = await transaction
        .select({
          id: properties.id,
          nameAr: properties.nameAr,
          nameEn: properties.nameEn,
          kind: properties.kind,
          category: properties.category,
          status: properties.status,
          defaultCurrency: properties.defaultCurrency,
          serialNumber: properties.serialNumber,
          createdAt: properties.createdAt,
          ownerName: parties.displayName,
          governorate: addresses.governorate,
          wilayat: addresses.wilayat,
          city: addresses.city,
          street: addresses.street,
        })
        .from(properties)
        .innerJoin(parties, eq(parties.id, properties.ownerPartyId))
        .innerJoin(addresses, eq(addresses.id, properties.addressId))
        .where(
          and(
            eq(properties.organizationId, claims.organizationId!),
            ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
            options.archivedOnly
              ? eq(properties.status, 'archived')
              : ne(properties.status, 'archived'),
          ),
        );
      return rows.map((row) => ({
        ...row,
        location: [row.street, row.city, row.wilayat, row.governorate].filter(Boolean).join(' · '),
      }));
    });
  }

  listLeases(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const tenantPartyId = tenantPartyScope(claims);
      const ownerPartyId = ownerPartyScope(claims);
      const rows = await transaction
        .select()
        .from(leases)
        .where(
          and(
            eq(leases.organizationId, claims.organizationId!),
            ...(tenantPartyId ? [eq(leases.tenantPartyId, tenantPartyId)] : []),
            ...(ownerPartyId && !tenantPartyId ? [eq(leases.ownerPartyId, ownerPartyId)] : []),
          ),
        );
      return rows.map((row) => ({
        ...row,
        rentMinor: row.rentMinor.toString(),
        depositMinor: row.depositMinor?.toString() ?? null,
        renewalPendingRentMinor: row.renewalPendingRentMinor?.toString() ?? null,
      }));
    });
  }

  requestLeaseCancellation(
    claims: SessionClaims,
    leaseId: string,
    input: { proposedEndsOn?: string; note?: string },
  ) {
    return this.leasing.updateLease(claims, leaseId, {
      action: 'request_cancellation',
      source: 'tenant',
      proposedEndsOn: input.proposedEndsOn,
      note: input.note,
    });
  }

  listInvoices(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const tenantPartyId = tenantPartyScope(claims);
      const ownerPartyId = ownerPartyScope(claims);
      const rows = tenantPartyId
        ? await transaction
            .select({
              id: invoices.id,
              leaseId: invoices.leaseId,
              invoiceNumber: invoices.invoiceNumber,
              status: invoices.status,
              currency: invoices.currency,
              minorUnit: invoices.minorUnit,
              totalMinor: invoices.totalMinor,
              paidMinor: invoices.paidMinor,
              issuedOn: invoices.issuedOn,
              dueOn: invoices.dueOn,
            })
            .from(invoices)
            .where(
              and(
                eq(invoices.organizationId, claims.organizationId!),
                eq(invoices.tenantPartyId, tenantPartyId),
              ),
            )
        : ownerPartyId
          ? await transaction
              .select({
                id: invoices.id,
                leaseId: invoices.leaseId,
                invoiceNumber: invoices.invoiceNumber,
                status: invoices.status,
                currency: invoices.currency,
                minorUnit: invoices.minorUnit,
                totalMinor: invoices.totalMinor,
                paidMinor: invoices.paidMinor,
                issuedOn: invoices.issuedOn,
                dueOn: invoices.dueOn,
              })
              .from(invoices)
              .innerJoin(leases, eq(invoices.leaseId, leases.id))
              .where(
                and(
                  eq(invoices.organizationId, claims.organizationId!),
                  eq(leases.ownerPartyId, ownerPartyId),
                ),
              )
          : await transaction
              .select({
                id: invoices.id,
                leaseId: invoices.leaseId,
                invoiceNumber: invoices.invoiceNumber,
                status: invoices.status,
                currency: invoices.currency,
                minorUnit: invoices.minorUnit,
                totalMinor: invoices.totalMinor,
                paidMinor: invoices.paidMinor,
                issuedOn: invoices.issuedOn,
                dueOn: invoices.dueOn,
              })
              .from(invoices)
              .where(eq(invoices.organizationId, claims.organizationId!));
      return rows.map((row) => ({
        ...row,
        totalMinor: row.totalMinor.toString(),
        paidMinor: row.paidMinor.toString(),
      }));
    });
  }

  listMaintenance(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const tenantPartyId = tenantPartyScope(claims);
      const ownerPartyId = ownerPartyScope(claims);
      const orgId = claims.organizationId!;
      if (tenantPartyId) {
        const tenantUnits = await transaction
          .select({ unitId: leases.unitId })
          .from(leases)
          .where(and(eq(leases.organizationId, orgId), eq(leases.tenantPartyId, tenantPartyId)));
        const unitIds = [...new Set(tenantUnits.map((row) => row.unitId))];
        return transaction
          .select()
          .from(maintenanceTickets)
          .where(
            and(
              eq(maintenanceTickets.organizationId, orgId),
              or(
                eq(maintenanceTickets.openedByPartyId, tenantPartyId),
                unitIds.length ? inArray(maintenanceTickets.unitId, unitIds) : sql`false`,
              ),
            ),
          );
      }
      if (ownerPartyId) {
        return transaction
          .select({
            id: maintenanceTickets.id,
            organizationId: maintenanceTickets.organizationId,
            unitId: maintenanceTickets.unitId,
            openedByPartyId: maintenanceTickets.openedByPartyId,
            assignedToUserId: maintenanceTickets.assignedToUserId,
            title: maintenanceTickets.title,
            description: maintenanceTickets.description,
            category: maintenanceTickets.category,
            priority: maintenanceTickets.priority,
            status: maintenanceTickets.status,
            blocksAvailability: maintenanceTickets.blocksAvailability,
            resolvedAt: maintenanceTickets.resolvedAt,
            createdAt: maintenanceTickets.createdAt,
            updatedAt: maintenanceTickets.updatedAt,
          })
          .from(maintenanceTickets)
          .innerJoin(units, eq(maintenanceTickets.unitId, units.id))
          .innerJoin(properties, eq(units.propertyId, properties.id))
          .where(
            and(eq(maintenanceTickets.organizationId, orgId), eq(properties.ownerPartyId, ownerPartyId)),
          );
      }
      return transaction
        .select()
        .from(maintenanceTickets)
        .where(eq(maintenanceTickets.organizationId, orgId));
    });
  }

  tenantOverview(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
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

      const expiringWhere = tenantPartyId
        ? and(
            eq(leases.organizationId, orgId),
            eq(leases.status, 'active'),
            eq(leases.tenantPartyId, tenantPartyId),
            gte(leases.endsOn, today),
            lte(leases.endsOn, expiryCutoff),
          )
        : and(
            eq(leases.organizationId, orgId),
            eq(leases.status, 'active'),
            gte(leases.endsOn, today),
            lte(leases.endsOn, expiryCutoff),
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

      const [leaseCount, invoiceCount, maintenanceCount, expiringContracts, collected, activity] =
        await Promise.all([
          transaction.select({ value: count() }).from(leases).where(leaseWhere),
          transaction.select({ value: count() }).from(invoices).where(invoiceWhere),
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
      return {
        leases: leaseCount[0]?.value ?? 0,
        invoices: invoiceCount[0]?.value ?? 0,
        maintenanceTickets: maintenanceCount[0]?.value ?? 0,
        occupancyPercent: null,
        collected,
        openTickets: maintenanceCount[0]?.value ?? 0,
        expiringContracts: expiringContracts[0]?.value ?? 0,
        recentActivity: activity,
        scopedToPartyId: tenantPartyId,
      };
    });
  }

  listTenantContracts(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) => {
      const tenantPartyId = tenantPartyScope(claims);
      return transaction
        .select({
          id: contracts.id,
          reference: contracts.reference,
          kind: contracts.kind,
          parentContractId: contracts.parentContractId,
          unitId: contracts.unitId,
          status: contracts.status,
          sentAt: contracts.sentAt,
          completedAt: contracts.completedAt,
          renderedPdfObjectKey: contracts.renderedPdfObjectKey,
          renderedPdfHash: contracts.renderedPdfHash,
        })
        .from(contracts)
        .where(
          and(
            eq(contracts.organizationId, claims.organizationId!),
            ...(tenantPartyId ? [eq(contracts.tenantPartyId, tenantPartyId)] : []),
          ),
        );
    });
  }

  async tenantContract(claims: SessionClaims, contractId: string) {
    return this.leasing.contractDetail(claims, contractId);
  }

  listTenantUnits(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const tenantPartyId = tenantPartyScope(claims);
      if (!tenantPartyId) {
        return transaction
          .select({
            id: units.id,
            propertyId: units.propertyId,
            code: units.code,
            nameAr: units.nameAr,
            nameEn: units.nameEn,
            floor: units.floor,
            bedrooms: units.bedrooms,
            bathrooms: units.bathrooms,
          })
          .from(units)
          .where(eq(units.organizationId, claims.organizationId!));
      }
      return transaction
        .select({
          id: units.id,
          propertyId: units.propertyId,
          code: units.code,
          nameAr: units.nameAr,
          nameEn: units.nameEn,
          floor: units.floor,
          bedrooms: units.bedrooms,
          bathrooms: units.bathrooms,
        })
        .from(units)
        .innerJoin(leases, eq(leases.unitId, units.id))
        .where(
          and(
            eq(units.organizationId, claims.organizationId!),
            eq(leases.tenantPartyId, tenantPartyId),
            inArray(leases.status, [
              'draft',
              'active',
              'cancel_requested',
              'clearance_pending',
            ]),
          ),
        );
    });
  }
}
