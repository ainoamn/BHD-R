import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expenses,
  invoices,
  journalEntries,
  journalLines,
  legalCases,
  maintenanceWorkOrders,
  payments,
  properties,
  propertyDocuments,
  propertyProfiles,
  reservationDocuments,
  reservationRequirements,
  salesDeals,
  stayBookings,
  stayHousekeepingTasks,
  stayInventoryLocks,
  stayProfiles,
  units,
} from '../src/schema.js';

describe('schema invariants', () => {
  it('scopes all material business records to an organization', () => {
    for (const table of [
      properties,
      units,
      invoices,
      payments,
      salesDeals,
      maintenanceWorkOrders,
      legalCases,
      expenses,
      journalEntries,
      journalLines,
      propertyProfiles,
      propertyDocuments,
      reservationRequirements,
      reservationDocuments,
      stayProfiles,
      stayInventoryLocks,
      stayBookings,
      stayHousekeepingTasks,
    ]) {
      expect(getTableColumns(table)).toHaveProperty('organizationId');
    }
  });

  it('stores monetary values as integers', () => {
    expect(getTableColumns(invoices)).toHaveProperty('totalMinor');
    expect(getTableColumns(payments)).toHaveProperty('amountMinor');
    expect(getTableColumns(units)).toHaveProperty('salePriceMinor');
    expect(getTableColumns(expenses)).toHaveProperty('amountMinor');
    expect(getTableColumns(journalLines)).toHaveProperty('debitMinor');
    expect(getTableColumns(journalLines)).toHaveProperty('creditMinor');
  });

  it('keeps operational property detail normalized instead of one unvalidated JSON blob', () => {
    expect(getTableColumns(propertyProfiles)).toHaveProperty('deedNumber');
    expect(getTableColumns(propertyDocuments)).toHaveProperty('verificationStatus');
    expect(getTableColumns(units)).toHaveProperty('listingPurpose');
  });

  it('keeps reservation requirements and reviewed documents as tenant-scoped records', () => {
    expect(getTableColumns(reservationRequirements)).toHaveProperty('reservationId');
    expect(getTableColumns(reservationRequirements)).toHaveProperty('required');
    expect(getTableColumns(reservationDocuments)).toHaveProperty('mediaAssetId');
    expect(getTableColumns(reservationDocuments)).toHaveProperty('reviewedByUserId');
  });

  it('emits the PostGIS geography typmod as SQL instead of a quoted type name', () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const migration = readFileSync(
      resolve(packageRoot, 'migrations/generated/0000_far_xavin.sql'),
      'utf8',
    );
    expect(migration).toContain('"location" geography(Point,4326)');
    expect(migration).not.toContain('"geography(Point,4326)"');
  });
});
