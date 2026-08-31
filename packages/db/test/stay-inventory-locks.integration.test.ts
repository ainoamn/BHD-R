import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  addresses,
  createDatabase,
  organizations,
  parties,
  properties,
  stayInventoryLocks,
  units,
} from '../src/index.js';

/**
 * Concurrent GiST exclusion against real Postgres.
 * Enable with TEST_DATABASE_URL or STAYS_LOCK_DATABASE_URL.
 */
const runtimeDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.STAYS_LOCK_DATABASE_URL;
const integration = runtimeDatabaseUrl ? describe : describe.skip;

function isExclusionViolation(error: unknown): boolean {
  const parts: string[] = [];
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === 'object' && current !== null) {
      const record = current as Record<string, unknown>;
      if (typeof record.message === 'string') parts.push(record.message);
      if (typeof record.code === 'string') parts.push(record.code);
      if (typeof record.constraint_name === 'string') parts.push(record.constraint_name);
      current = record.cause;
      continue;
    }
    parts.push(String(current));
    break;
  }
  const blob = parts.join(' | ').toLowerCase();
  return (
    blob.includes('stay_inventory_locks_no_overlap_active') ||
    blob.includes('exclusion') ||
    blob.includes('23p01') ||
    blob.includes('conflicting key')
  );
}

integration('stay_inventory_locks GiST exclusion', () => {
  it(
    'rejects a second overlapping active lock on the same unit',
    async () => {
      const { client, db } = createDatabase(runtimeDatabaseUrl!, { max: 5 });
      const suffix = randomUUID().slice(0, 8);
      let seeded: { orgId: string; unitId: string } | undefined;
      try {
        seeded = await db.transaction(async (transaction) => {
          await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
          const [org] = await transaction
            .insert(organizations)
            .values({
              type: 'company',
              slug: `stay-lock-${suffix}`,
              legalName: 'Stay Lock Co',
              displayNameAr: 'اختبار',
              displayNameEn: 'Stay Lock Co',
            })
            .returning();
          const [owner] = await transaction
            .insert(parties)
            .values({ organizationId: org!.id, type: 'person', displayName: 'Owner Lock' })
            .returning();
          const [address] = await transaction
            .insert(addresses)
            .values({
              organizationId: org!.id,
              governorate: 'Muscat',
              wilayat: 'Bawshar',
              city: 'Muscat',
            })
            .returning();
          const [property] = await transaction
            .insert(properties)
            .values({
              organizationId: org!.id,
              ownerPartyId: owner!.id,
              addressId: address!.id,
              kind: 'single_unit',
              category: 'apartment',
              nameAr: 'وحدة اختبار',
              nameEn: 'Lock test',
              defaultCurrency: 'OMR',
              status: 'active',
            })
            .returning();
          const [unit] = await transaction
            .insert(units)
            .values({
              organizationId: org!.id,
              propertyId: property!.id,
              code: `U-${suffix}`,
              nameAr: 'وحدة',
              nameEn: 'Unit',
              rentMinor: 50_000n,
              currency: 'OMR',
              minorUnit: 3,
              status: 'active',
              listingPurpose: 'rent',
            })
            .returning();
          return { orgId: org!.id, unitId: unit!.id };
        });

        await db.transaction(async (transaction) => {
          await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
          await transaction.execute(sql`
            insert into stay_inventory_locks (
              organization_id, unit_id, stay_range, kind, status
            ) values (
              ${seeded!.orgId}::uuid,
              ${seeded!.unitId}::uuid,
              daterange('2026-10-01', '2026-10-05', '[)'),
              'booking',
              'active'
            )
          `);
        });

        let rejected = false;
        try {
          await db.transaction(async (transaction) => {
            await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
            await transaction.execute(sql`
              insert into stay_inventory_locks (
                organization_id, unit_id, stay_range, kind, status
              ) values (
                ${seeded!.orgId}::uuid,
                ${seeded!.unitId}::uuid,
                daterange('2026-10-03', '2026-10-07', '[)'),
                'hold',
                'active'
              )
            `);
          });
        } catch (error) {
          rejected = isExclusionViolation(error);
          if (!rejected) throw error;
        }
        expect(rejected).toBe(true);

        // Adjacent (touching) ranges must be allowed: checkout day free for next guest.
        await db.transaction(async (transaction) => {
          await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
          await transaction.execute(sql`
            insert into stay_inventory_locks (
              organization_id, unit_id, stay_range, kind, status
            ) values (
              ${seeded!.orgId}::uuid,
              ${seeded!.unitId}::uuid,
              daterange('2026-10-05', '2026-10-08', '[)'),
              'booking',
              'active'
            )
          `);
        });
      } finally {
        if (seeded) {
          try {
            await db.transaction(async (transaction) => {
              await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
              await transaction
                .delete(stayInventoryLocks)
                .where(eq(stayInventoryLocks.organizationId, seeded!.orgId));
              await transaction.delete(units).where(eq(units.organizationId, seeded!.orgId));
              await transaction
                .delete(properties)
                .where(eq(properties.organizationId, seeded!.orgId));
              await transaction.delete(addresses).where(eq(addresses.organizationId, seeded!.orgId));
              await transaction.delete(parties).where(eq(parties.organizationId, seeded!.orgId));
              await transaction.delete(organizations).where(eq(organizations.id, seeded!.orgId));
            });
          } catch {
            // best-effort cleanup
          }
        }
        await client.end();
      }
    },
    30_000,
  );
});
