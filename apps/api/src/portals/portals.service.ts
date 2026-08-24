import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  contracts,
  invoices,
  leases,
  maintenanceTickets,
  organizations,
  payments,
  properties,
  units,
  workflowEvents,
} from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService } from '../database/database.service.js';
import { LeasingService } from '../leasing/leasing.service.js';

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
      const [propertyCount, unitCount, activeLeaseCount, openMaintenanceCount, expiringContracts] =
        await Promise.all([
          transaction
            .select({ value: count() })
            .from(properties)
            .where(eq(properties.organizationId, claims.organizationId!)),
          transaction
            .select({ value: count() })
            .from(units)
            .where(
              and(eq(units.organizationId, claims.organizationId!), eq(units.status, 'active')),
            ),
          transaction
            .select({ value: count() })
            .from(leases)
            .where(
              and(eq(leases.organizationId, claims.organizationId!), eq(leases.status, 'active')),
            ),
          transaction
            .select({ value: count() })
            .from(maintenanceTickets)
            .where(
              and(
                eq(maintenanceTickets.organizationId, claims.organizationId!),
                inArray(maintenanceTickets.status, ['open', 'assigned', 'in_progress']),
              ),
            ),
          transaction
            .select({ value: count() })
            .from(leases)
            .where(
              and(
                eq(leases.organizationId, claims.organizationId!),
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
          .where(
            and(
              eq(payments.organizationId, claims.organizationId!),
              inArray(payments.status, ['succeeded', 'partially_refunded', 'refunded']),
            ),
          )
          .groupBy(payments.currency),
        transaction
          .select({
            id: workflowEvents.id,
            title: workflowEvents.eventType,
            occurredAt: workflowEvents.occurredAt,
            status: workflowEvents.toStatus,
          })
          .from(workflowEvents)
          .where(eq(workflowEvents.organizationId, claims.organizationId!))
          .orderBy(desc(workflowEvents.occurredAt))
          .limit(8),
      ]);
      const activeUnits = Number(unitCount[0]?.value ?? 0);
      const occupied = Number(activeLeaseCount[0]?.value ?? 0);
      return {
        properties: propertyCount[0]?.value ?? 0,
        units: unitCount[0]?.value ?? 0,
        activeLeases: activeLeaseCount[0]?.value ?? 0,
        occupancyPercent: activeUnits ? Math.round((occupied / activeUnits) * 10_000) / 100 : 0,
        collected,
        openTickets: openMaintenanceCount[0]?.value ?? 0,
        expiringContracts: expiringContracts[0]?.value ?? 0,
        recentActivity: activity,
      };
    });
  }

  listProperties(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select({
          id: properties.id,
          nameAr: properties.nameAr,
          nameEn: properties.nameEn,
          kind: properties.kind,
          category: properties.category,
          status: properties.status,
          createdAt: properties.createdAt,
        })
        .from(properties)
        .where(eq(properties.organizationId, claims.organizationId!)),
    );
  }

  listLeases(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) =>
      (
        await transaction
          .select()
          .from(leases)
          .where(eq(leases.organizationId, claims.organizationId!))
      ).map((row) => ({
        ...row,
        rentMinor: row.rentMinor.toString(),
        depositMinor: row.depositMinor?.toString() ?? null,
      })),
    );
  }

  listInvoices(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) =>
      (
        await transaction
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
          .where(eq(invoices.organizationId, claims.organizationId!))
      ).map((row) => ({
        ...row,
        totalMinor: row.totalMinor.toString(),
        paidMinor: row.paidMinor.toString(),
      })),
    );
  }

  listMaintenance(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select()
        .from(maintenanceTickets)
        .where(eq(maintenanceTickets.organizationId, claims.organizationId!)),
    );
  }

  tenantOverview(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const today = new Date().toISOString().slice(0, 10);
      const expiryCutoff = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
      const [leaseCount, invoiceCount, maintenanceCount, expiringContracts, collected, activity] =
        await Promise.all([
          transaction.select({ value: count() }).from(leases).where(eq(leases.status, 'active')),
          transaction.select({ value: count() }).from(invoices),
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
              id: invoices.id,
              title: invoices.invoiceNumber,
              occurredAt: invoices.createdAt,
              status: invoices.status,
            })
            .from(invoices)
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
      };
    });
  }

  listTenantContracts(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
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
        .where(eq(contracts.organizationId, claims.organizationId!)),
    );
  }

  async tenantContract(claims: SessionClaims, contractId: string) {
    return this.leasing.contractDetail(claims, contractId);
  }

  listTenantUnits(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
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
        .from(units),
    );
  }
}
