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
  salesDeals,
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
