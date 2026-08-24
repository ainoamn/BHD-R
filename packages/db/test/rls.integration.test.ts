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
  operationalRequests,
  organizations,
  parties,
  payments,
  properties,
  salesDeals,
  units,
  webhookEvents,
} from '../src/index.js';

const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const runtimeDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = migrationDatabaseUrl && runtimeDatabaseUrl ? describe : describe.skip;

integration('PostgreSQL row-level tenant isolation', () => {
  it('prevents organization and tenant-party cross access', async () => {
    const { client: adminClient, db: adminDb } = createDatabase(migrationDatabaseUrl!, {
      max: 20,
    });
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
        const [requestA1] = await transaction
          .insert(operationalRequests)
          .values([
            {
              organizationId: orgA!.id,
              reference: `REQ-A1-${suffix}`,
              type: 'tenant_service',
              requesterPartyId: tenantA1!.id,
              propertyId: propertyA!.id,
              unitId: unitA1!.id,
              subject: 'Tenant A1 request',
            },
            {
              organizationId: orgA!.id,
              reference: `REQ-A2-${suffix}`,
              type: 'tenant_service',
              requesterPartyId: tenantA2!.id,
              propertyId: propertyA!.id,
              unitId: unitA2!.id,
              subject: 'Tenant A2 request',
            },
          ])
          .returning();
        const [saleA, saleB] = await transaction
          .insert(salesDeals)
          .values([
            {
              organizationId: orgA!.id,
              reference: `SALE-A-${suffix}`,
              propertyId: propertyA!.id,
              unitId: unitA1!.id,
              sellerPartyId: ownerA!.id,
              askingPriceMinor: 100_000_000n,
              currency: 'OMR',
              minorUnit: 3,
            },
            {
              organizationId: orgB!.id,
              reference: `SALE-B-${suffix}`,
              propertyId: propertyB!.id,
              sellerPartyId: ownerB!.id,
              askingPriceMinor: 200_000_000n,
              currency: 'OMR',
              minorUnit: 3,
            },
          ])
          .returning();
        const insertedInvoices = await transaction
          .insert(invoices)
          .values([
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
          ])
          .returning({ id: invoices.id });
        return {
          orgA: orgA!.id,
          orgB: orgB!.id,
          propertyB: propertyB!.id,
          tenantA1: tenantA1!.id,
          leaseA1: leaseA1!.id,
          invoiceA1: insertedInvoices[0]!.id,
          requestA1: requestA1!.id,
          saleA: saleA!.id,
          saleB: saleB!.id,
        };
      });

      const webhookEventId = `webhook-${suffix}`;
      const providerReference = `payment-${suffix}`;
      const acceptedAttempts = await Promise.all(
        Array.from({ length: 100 }, async () =>
          adminDb.transaction(async (transaction) => {
            await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
            const claimed = await transaction
              .insert(webhookEvents)
              .values({
                provider: 'regression-gateway',
                providerEventId: webhookEventId,
                organizationId: seeded.orgA,
                payloadHash: 'a'.repeat(64),
                signatureVerified: true,
              })
              .onConflictDoNothing()
              .returning({ id: webhookEvents.id });
            if (claimed.length === 0) return false;
            await transaction.insert(payments).values({
              organizationId: seeded.orgA,
              invoiceId: seeded.invoiceA1,
              status: 'succeeded',
              amountMinor: 100_000n,
              currency: 'OMR',
              minorUnit: 3,
              provider: 'regression-gateway',
              providerReference,
              method: 'card',
              receivedAt: new Date(),
            });
            return true;
          }),
        ),
      );
      expect(acceptedAttempts.filter(Boolean)).toHaveLength(1);
      await adminDb.transaction(async (transaction) => {
        await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
        expect(
          await transaction
            .select()
            .from(webhookEvents)
            .where(eq(webhookEvents.providerEventId, webhookEventId)),
        ).toHaveLength(1);
        expect(
          await transaction
            .select()
            .from(payments)
            .where(eq(payments.providerReference, providerReference)),
        ).toHaveLength(1);
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
        expect((await transaction.select().from(salesDeals)).map((row) => row.id)).toEqual([
          seeded.saleA,
        ]);
        expect(
          await transaction
            .update(salesDeals)
            .set({ status: 'qualified' })
            .where(eq(salesDeals.id, seeded.saleB))
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
        const visibleRequests = await transaction.select().from(operationalRequests);
        const visibleSales = await transaction.select().from(salesDeals);
        expect(visibleLeases.map((row) => row.id)).toEqual([seeded.leaseA1]);
        expect(visibleInvoices).toHaveLength(1);
        expect(visibleInvoices[0]!.tenantPartyId).toBe(seeded.tenantA1);
        expect(visibleRequests.map((row) => row.id)).toEqual([seeded.requestA1]);
        expect(visibleSales).toEqual([]);
      });
    } finally {
      if (runtime) await runtime.client.end();
      await adminClient.end();
    }
  }, 60_000);
});
