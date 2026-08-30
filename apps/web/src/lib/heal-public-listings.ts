import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import {
  createDatabase,
  listings,
  properties,
  units,
  type Database,
} from '@bhd-r/db';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRListingHealDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRListingHealDb) {
    const { db } = createDatabase(url, { max: 1 });
    globalForDb.__bhdRListingHealDb = { db };
  }
  return globalForDb.__bhdRListingHealDb;
}

function slugify(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'unit';
}

/**
 * Privileged heal: sync listings.enabled/publishedAt from units.publishWhenAvailable
 * so catalogue stays aligned after edits / booking tests.
 */
export async function healPublicCatalogueListings(options?: {
  propertyId?: string;
}): Promise<void> {
  const { db } = getDatabase();
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);

    const filters = [eq(units.publishWhenAvailable, true)];
    if (options?.propertyId) filters.push(eq(units.propertyId, options.propertyId));

    const unitRows = await transaction
      .select({
        id: units.id,
        code: units.code,
        organizationId: units.organizationId,
        propertyId: units.propertyId,
        publishWhenAvailable: units.publishWhenAvailable,
        status: units.status,
        propertyStatus: properties.status,
        propertyNameEn: properties.nameEn,
        listingId: listings.id,
        listingEnabled: listings.enabled,
        listingPublishedAt: listings.publishedAt,
      })
      .from(units)
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .leftJoin(listings, eq(listings.unitId, units.id))
      .where(and(...filters));

    for (const unit of unitRows) {
      if (unit.propertyStatus === 'archived') continue;
      if (unit.propertyStatus !== 'active') {
        await transaction
          .update(properties)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(properties.id, unit.propertyId));
      }
      if (unit.status !== 'active') {
        await transaction
          .update(units)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(units.id, unit.id));
      }
      if (unit.listingId) {
        if (!unit.listingEnabled || !unit.listingPublishedAt) {
          await transaction
            .update(listings)
            .set({
              enabled: true,
              publishedAt: unit.listingPublishedAt ?? new Date(),
              updatedAt: new Date(),
            })
            .where(eq(listings.id, unit.listingId));
        }
      } else {
        await transaction.insert(listings).values({
          organizationId: unit.organizationId,
          unitId: unit.id,
          slug: `${slugify(unit.propertyNameEn)}-${slugify(unit.code)}-${unit.id.slice(0, 8)}`,
          enabled: true,
          publishedAt: new Date(),
        });
      }
    }

    if (options?.propertyId) {
      const stale = await transaction
        .select({ id: listings.id })
        .from(listings)
        .innerJoin(units, eq(units.id, listings.unitId))
        .where(
          and(
            eq(units.propertyId, options.propertyId),
            eq(units.publishWhenAvailable, false),
            eq(listings.enabled, true),
          ),
        );
      for (const row of stale) {
        await transaction
          .update(listings)
          .set({ enabled: false, publishedAt: null, updatedAt: new Date() })
          .where(eq(listings.id, row.id));
      }
    }
  });
}
