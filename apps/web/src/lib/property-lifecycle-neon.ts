import 'server-only';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';
import {
  createDatabase,
  leases,
  listings,
  outboxEvents,
  properties,
  propertyAmenities,
  propertyDocuments,
  propertyOwnershipInterests,
  propertyProfiles,
  stayProfiles,
  units,
  utilityMeters,
  type Database,
} from '@bhd-r/db';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPropertyLifecycleDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPropertyLifecycleDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPropertyLifecycleDb = { db };
  }
  return globalForDb.__bhdRPropertyLifecycleDb;
}

async function withinTenant<T>(
  claims: SessionClaims,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { db } = getDatabase();
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('app.organization_id', ${claims.organizationId ?? ''}, true)`,
    );
    await transaction.execute(sql`select set_config('app.user_id', ${claims.sub}, true)`);
    await transaction.execute(
      sql`select set_config('app.party_id', ${claims.partyId ?? ''}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.platform_admin', ${String(claims.roles.includes('platform_admin'))}, true)`,
    );
    await transaction.execute(
      sql`select set_config('app.is_tenant', ${String(claims.roles.includes('tenant'))}, true)`,
    );
    await transaction.execute(sql`select set_config('app.public', 'false', true)`);
    return work(transaction);
  });
}

function assertOrg(claims: SessionClaims): string {
  if (!claims.organizationId) throw new Error('organization_required');
  return claims.organizationId;
}

export async function archivePropertyOnNeon(claims: SessionClaims, propertyId: string) {
  const organizationId = assertOrg(claims);
  return withinTenant(claims, async (transaction) => {
    const activeLease = await transaction
      .select({ id: leases.id })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(
        and(
          eq(units.propertyId, propertyId),
          eq(leases.organizationId, organizationId),
          inArray(leases.status, ['draft', 'active', 'cancel_requested', 'clearance_pending']),
        ),
      )
      .limit(1);
    if (activeLease[0]) throw new Error('property_has_active_lease');

    const rows = await transaction
      .update(properties)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(
        and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, organizationId),
          ne(properties.status, 'archived'),
        ),
      )
      .returning({ id: properties.id, status: properties.status });
    if (!rows[0]) throw new Error('property_not_found');

    await transaction
      .update(units)
      .set({ publishWhenAvailable: false, status: 'inactive', updatedAt: new Date() })
      .where(and(eq(units.propertyId, propertyId), eq(units.organizationId, organizationId)));

    const unitIds = await transaction
      .select({ id: units.id })
      .from(units)
      .where(and(eq(units.propertyId, propertyId), eq(units.organizationId, organizationId)));
    if (unitIds.length) {
      await transaction
        .update(listings)
        .set({ enabled: false, publishedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(listings.organizationId, organizationId),
            inArray(
              listings.unitId,
              unitIds.map((u) => u.id),
            ),
          ),
        );
    }

    await transaction.insert(outboxEvents).values({
      organizationId,
      topic: 'property.archived',
      aggregateType: 'property',
      aggregateId: propertyId,
      payload: { via: 'neon' },
    });

    return rows[0];
  });
}

export async function restorePropertyOnNeon(claims: SessionClaims, propertyId: string) {
  const organizationId = assertOrg(claims);
  return withinTenant(claims, async (transaction) => {
    const rows = await transaction
      .update(properties)
      .set({ status: 'active', updatedAt: new Date() })
      .where(
        and(
          eq(properties.id, propertyId),
          eq(properties.organizationId, organizationId),
          eq(properties.status, 'archived'),
        ),
      )
      .returning({ id: properties.id, status: properties.status });
    if (!rows[0]) throw new Error('archived_property_not_found');

    await transaction.insert(outboxEvents).values({
      organizationId,
      topic: 'property.restored',
      aggregateType: 'property',
      aggregateId: propertyId,
      payload: { listingsRepublished: false, via: 'neon' },
    });

    return rows[0];
  });
}

/**
 * Permanent delete — archived only, blocked when any lease row exists for the property units.
 */
export async function purgePropertyOnNeon(claims: SessionClaims, propertyId: string) {
  const organizationId = assertOrg(claims);
  return withinTenant(claims, async (transaction) => {
    const [property] = await transaction
      .select({ id: properties.id, status: properties.status })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
      .limit(1);
    if (!property) throw new Error('property_not_found');
    if (property.status !== 'archived') throw new Error('property_not_archived');

    const unitRows = await transaction
      .select({ id: units.id })
      .from(units)
      .where(and(eq(units.propertyId, propertyId), eq(units.organizationId, organizationId)));
    const unitIds = unitRows.map((row) => row.id);

    if (unitIds.length) {
      const leaseRow = await transaction
        .select({ id: leases.id })
        .from(leases)
        .where(and(eq(leases.organizationId, organizationId), inArray(leases.unitId, unitIds)))
        .limit(1);
      if (leaseRow[0]) throw new Error('property_has_lease_history');

      const stayRow = await transaction
        .select({ id: stayProfiles.id })
        .from(stayProfiles)
        .where(
          and(eq(stayProfiles.organizationId, organizationId), inArray(stayProfiles.unitId, unitIds)),
        )
        .limit(1);
      if (stayRow[0]) throw new Error('property_has_stay_profile');

      await transaction
        .delete(listings)
        .where(and(eq(listings.organizationId, organizationId), inArray(listings.unitId, unitIds)));
    }

    await transaction
      .delete(propertyAmenities)
      .where(
        and(
          eq(propertyAmenities.propertyId, propertyId),
          eq(propertyAmenities.organizationId, organizationId),
        ),
      );
    await transaction
      .delete(propertyDocuments)
      .where(
        and(
          eq(propertyDocuments.propertyId, propertyId),
          eq(propertyDocuments.organizationId, organizationId),
        ),
      );
    await transaction
      .delete(propertyOwnershipInterests)
      .where(
        and(
          eq(propertyOwnershipInterests.propertyId, propertyId),
          eq(propertyOwnershipInterests.organizationId, organizationId),
        ),
      );
    await transaction
      .delete(propertyProfiles)
      .where(
        and(
          eq(propertyProfiles.propertyId, propertyId),
          eq(propertyProfiles.organizationId, organizationId),
        ),
      );
    await transaction
      .delete(utilityMeters)
      .where(
        and(eq(utilityMeters.propertyId, propertyId), eq(utilityMeters.organizationId, organizationId)),
      );

    if (unitIds.length) {
      await transaction
        .delete(units)
        .where(and(eq(units.organizationId, organizationId), inArray(units.id, unitIds)));
    }

    await transaction
      .delete(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)));

    await transaction.insert(outboxEvents).values({
      organizationId,
      topic: 'property.purged',
      aggregateType: 'property',
      aggregateId: propertyId,
      payload: { via: 'neon' },
    });

    return { id: propertyId, purged: true as const };
  });
}
