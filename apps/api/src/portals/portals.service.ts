import { Injectable, NotFoundException } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import {
  contracts,
  invoices,
  leases,
  maintenanceTickets,
  organizations,
  properties,
  units,
} from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class PortalsService {
  constructor(private readonly database: DatabaseService) {}

  platformOverview() {
    return this.database.asSystem(async (transaction) => {
      const [organizationCount] = await transaction.select({ value: count() }).from(organizations);
      const [propertyCount] = await transaction.select({ value: count() }).from(properties);
      const [activeLeaseCount] = await transaction
        .select({ value: count() })
        .from(leases)
        .where(eq(leases.status, 'active'));
      return {
        organizations: organizationCount?.value ?? 0,
        properties: propertyCount?.value ?? 0,
        activeLeases: activeLeaseCount?.value ?? 0,
      };
    });
  }

  organizationOverview(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const [propertyCount] = await transaction
        .select({ value: count() })
        .from(properties)
        .where(eq(properties.organizationId, claims.organizationId!));
      const [unitCount] = await transaction
        .select({ value: count() })
        .from(units)
        .where(eq(units.organizationId, claims.organizationId!));
      const [activeLeaseCount] = await transaction
        .select({ value: count() })
        .from(leases)
        .where(and(eq(leases.organizationId, claims.organizationId!), eq(leases.status, 'active')));
      const [openMaintenanceCount] = await transaction
        .select({ value: count() })
        .from(maintenanceTickets)
        .where(
          and(
            eq(maintenanceTickets.organizationId, claims.organizationId!),
            eq(maintenanceTickets.status, 'open'),
          ),
        );
      return {
        properties: propertyCount?.value ?? 0,
        units: unitCount?.value ?? 0,
        activeLeases: activeLeaseCount?.value ?? 0,
        openMaintenance: openMaintenanceCount?.value ?? 0,
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
      const [leaseCount] = await transaction.select({ value: count() }).from(leases);
      const [invoiceCount] = await transaction.select({ value: count() }).from(invoices);
      const [maintenanceCount] = await transaction
        .select({ value: count() })
        .from(maintenanceTickets);
      return {
        leases: leaseCount?.value ?? 0,
        invoices: invoiceCount?.value ?? 0,
        maintenanceTickets: maintenanceCount?.value ?? 0,
      };
    });
  }

  listTenantContracts(claims: SessionClaims) {
    return this.database.withinTenant(claims, (transaction) =>
      transaction
        .select({
          id: contracts.id,
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
    const row = await this.database.withinTenant(claims, (transaction) =>
      transaction.query.contracts.findFirst({
        where: and(
          eq(contracts.id, contractId),
          eq(contracts.organizationId, claims.organizationId!),
        ),
        columns: {
          id: true,
          unitId: true,
          status: true,
          payloadSnapshot: true,
          renderedPdfObjectKey: true,
          renderedPdfHash: true,
          sentAt: true,
          completedAt: true,
        },
      }),
    );
    if (!row) throw new NotFoundException('Contract not found');
    return row;
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
