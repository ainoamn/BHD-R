import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  addresses,
  countryPacks,
  createDatabase,
  currencies,
  invoices,
  leases,
  organizations,
  parties,
  properties,
  units,
} from '../src/index.js';

const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const runtimeDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = migrationDatabaseUrl && runtimeDatabaseUrl ? describe : describe.skip;

integration('PostgreSQL row-level tenant isolation', () => {
  it('prevents organization and tenant-party cross access', async () => {
    const { client: adminClient, db: adminDb } = createDatabase(migrationDatabaseUrl!, { max: 1 });
    let runtime: ReturnType<typeof createDatabase> | undefined;
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    try {
      await adminClient.unsafe(
        await readFile(resolve(packageRoot, 'migrations/custom/0000_extensions.sql'), 'utf8'),
      );
      await migrate(adminDb, { migrationsFolder: resolve(packageRoot, 'migrations/generated') });
      await adminClient.unsafe(
        await readFile(resolve(packageRoot, 'migrations/custom/0001_rls.sql'), 'utf8'),
      );
      await adminClient.unsafe(
        await readFile(resolve(packageRoot, 'migrations/privileged/runtime_roles.sql'), 'utf8'),
      );
      const suffix = randomUUID().slice(0, 8);
      await adminDb
        .insert(currencies)
        .values({
          code: 'OMR',
          nameAr: 'ريال عماني',
          nameEn: 'Omani Rial',
          symbolAr: 'ر.ع.',
          symbolEn: 'OMR',
          minorUnit: 3,
        })
        .onConflictDoNothing();
      await adminDb
        .insert(countryPacks)
        .values({ countryCode: 'OM', nameAr: 'عمان', nameEn: 'Oman', defaultCurrency: 'OMR' })
        .onConflictDoNothing();

      const seeded = await adminDb.transaction(async (transaction) => {
        await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
        const [orgA] = await transaction
          .insert(organizations)
          .values({
            type: 'company',
            slug: `rls-a-${suffix}`,
            legalName: 'A',
            displayNameAr: 'أ',
            displayNameEn: 'A',
          })
          .returning();
        const [orgB] = await transaction
          .insert(organizations)
          .values({
            type: 'company',
            slug: `rls-b-${suffix}`,
            legalName: 'B',
            displayNameAr: 'ب',
            displayNameEn: 'B',
          })
          .returning();
        const [addressA] = await transaction
          .insert(addresses)
          .values({
            organizationId: orgA!.id,
            governorate: 'Muscat',
            wilayat: 'Bawshar',
            city: 'Muscat',
          })
          .returning();
        const [addressB] = await transaction
          .insert(addresses)
          .values({
            organizationId: orgB!.id,
            governorate: 'Muscat',
            wilayat: 'Bawshar',
            city: 'Muscat',
          })
          .returning();
        const [ownerA, tenantA1, tenantA2] = await transaction
          .insert(parties)
          .values([
            { organizationId: orgA!.id, type: 'person', displayName: 'Owner A' },
            { organizationId: orgA!.id, type: 'person', displayName: 'Tenant A1' },
            { organizationId: orgA!.id, type: 'person', displayName: 'Tenant A2' },
          ])
          .returning();
        const [ownerB] = await transaction
          .insert(parties)
          .values({ organizationId: orgB!.id, type: 'person', displayName: 'Owner B' })
          .returning();
        const [propertyA] = await transaction
          .insert(properties)
          .values({
            organizationId: orgA!.id,
            ownerPartyId: ownerA!.id,
            addressId: addressA!.id,
            kind: 'multi_unit',
            category: 'building',
            nameAr: 'أ',
            nameEn: 'A',
            defaultCurrency: 'OMR',
            status: 'active',
          })
          .returning();
        const [propertyB] = await transaction
          .insert(properties)
          .values({
            organizationId: orgB!.id,
            ownerPartyId: ownerB!.id,
            addressId: addressB!.id,
            kind: 'single_unit',
            category: 'villa',
            nameAr: 'ب',
            nameEn: 'B',
            defaultCurrency: 'OMR',
            status: 'active',
          })
          .returning();
        const [unitA1, unitA2] = await transaction
          .insert(units)
          .values([
            {
              organizationId: orgA!.id,
              propertyId: propertyA!.id,
              code: '1',
              nameAr: '١',
              nameEn: '1',
              rentMinor: 100_000n,
              currency: 'OMR',
              minorUnit: 3,
              status: 'active',
            },
            {
              organizationId: orgA!.id,
              propertyId: propertyA!.id,
              code: '2',
              nameAr: '٢',
              nameEn: '2',
              rentMinor: 100_000n,
              currency: 'OMR',
              minorUnit: 3,
              status: 'active',
            },
          ])
          .returning();
        const [leaseA1, leaseA2] = await transaction
          .insert(leases)
          .values([
            {
              organizationId: orgA!.id,
              unitId: unitA1!.id,
              ownerPartyId: ownerA!.id,
              tenantPartyId: tenantA1!.id,
              status: 'active',
              startsOn: '2026-01-01',
              endsOn: '2026-12-31',
              rentMinor: 100_000n,
              currency: 'OMR',
              minorUnit: 3,
              billingDay: 1,
            },
            {
              organizationId: orgA!.id,
              unitId: unitA2!.id,
              ownerPartyId: ownerA!.id,
              tenantPartyId: tenantA2!.id,
              status: 'active',
              startsOn: '2026-01-01',
              endsOn: '2026-12-31',
              rentMinor: 100_000n,
              currency: 'OMR',
              minorUnit: 3,
              billingDay: 1,
            },
          ])
          .returning();
        await transaction.insert(invoices).values([
          {
            organizationId: orgA!.id,
            leaseId: leaseA1!.id,
            tenantPartyId: tenantA1!.id,
            invoiceNumber: `A1-${suffix}`,
            status: 'issued',
            currency: 'OMR',
            minorUnit: 3,
            subtotalMinor: 100_000n,
            totalMinor: 100_000n,
            issuedOn: '2026-01-01',
            dueOn: '2026-01-07',
          },
          {
            organizationId: orgA!.id,
            leaseId: leaseA2!.id,
            tenantPartyId: tenantA2!.id,
            invoiceNumber: `A2-${suffix}`,
            status: 'issued',
            currency: 'OMR',
            minorUnit: 3,
            subtotalMinor: 100_000n,
            totalMinor: 100_000n,
            issuedOn: '2026-01-01',
            dueOn: '2026-01-07',
          },
        ]);
        return {
          orgA: orgA!.id,
          orgB: orgB!.id,
          propertyB: propertyB!.id,
          tenantA1: tenantA1!.id,
          leaseA1: leaseA1!.id,
        };
      });

      runtime = createDatabase(runtimeDatabaseUrl!, { max: 1 });
      await runtime.db.transaction(async (transaction) => {
        await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
        await transaction.execute(
          sql`select set_config('app.organization_id', ${seeded.orgA}, true)`,
        );
        await transaction.execute(sql`select set_config('app.is_tenant', 'false', true)`);
        expect(
          (await transaction.select().from(properties)).every(
            (row) => row.organizationId === seeded.orgA,
          ),
        ).toBe(true);
        expect(
          await transaction
            .update(properties)
            .set({ nameEn: 'forbidden' })
            .where(eq(properties.id, seeded.propertyB))
            .returning(),
        ).toEqual([]);
      });

      await runtime.db.transaction(async (transaction) => {
        await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
        await transaction.execute(
          sql`select set_config('app.organization_id', ${seeded.orgA}, true)`,
        );
        await transaction.execute(sql`select set_config('app.party_id', ${seeded.tenantA1}, true)`);
        await transaction.execute(sql`select set_config('app.is_tenant', 'true', true)`);
        const visibleLeases = await transaction.select().from(leases);
        const visibleInvoices = await transaction.select().from(invoices);
        expect(visibleLeases.map((row) => row.id)).toEqual([seeded.leaseA1]);
        expect(visibleInvoices).toHaveLength(1);
        expect(visibleInvoices[0]!.tenantPartyId).toBe(seeded.tenantA1);
      });
    } finally {
      if (runtime) await runtime.client.end();
      await adminClient.end();
    }
  }, 60_000);
});
