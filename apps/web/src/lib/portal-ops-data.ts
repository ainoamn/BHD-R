import 'server-only';
import { cookies } from 'next/headers';
import { and, count, eq, sql } from 'drizzle-orm';
import { verifySessionToken, type SessionClaims } from '@bhd-r/authz';
import {
  addresses,
  createDatabase,
  parties,
  properties,
  units,
  type Database,
} from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireSessionSecret } from '@/lib/runtime-env';
import type { PortalRole } from '@/lib/types';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRWebDb?: DbHandle };

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

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

function getSharedDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRWebDb) {
    const { db } = createDatabase(url, { max: 1 });
    globalForDb.__bhdRWebDb = { db };
  }
  return globalForDb.__bhdRWebDb;
}

function ownerPartyScope(claims: SessionClaims): string | null {
  if (!claims.partyId) return null;
  if (claims.roles.some((role) => ORG_WIDE_ROLES.has(role))) return null;
  return claims.partyId;
}

async function readClaims(): Promise<SessionClaims | null> {
  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) return null;
  try {
    return await verifySessionToken(token, sessionSecret());
  } catch {
    return null;
  }
}

async function withinViewerTenant<T>(
  claims: SessionClaims,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  const { db } = getSharedDatabase();
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

async function listProperties(claims: SessionClaims): Promise<Record<string, unknown>[]> {
  return withinViewerTenant(claims, async (transaction) => {
    const ownerPartyId = ownerPartyScope(claims);
    const orgId = claims.organizationId!;
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
          eq(properties.organizationId, orgId),
          ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
        ),
      );

    const unitCounts = await transaction
      .select({
        propertyId: units.propertyId,
        value: count(),
      })
      .from(units)
      .where(eq(units.organizationId, orgId))
      .groupBy(units.propertyId);
    const byProperty = new Map(unitCounts.map((row) => [row.propertyId, Number(row.value)]));

    return rows.map((row) => ({
      ...row,
      location: [row.street, row.city, row.wilayat, row.governorate].filter(Boolean).join(' · '),
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      units: byProperty.get(row.id) ?? 0,
    }));
  });
}

async function listContacts(claims: SessionClaims): Promise<Record<string, unknown>[]> {
  return withinViewerTenant(claims, async (transaction) => {
    const orgId = claims.organizationId!;
    const rows = await transaction
      .select({
        id: parties.id,
        displayName: parties.displayName,
        type: parties.type,
        email: parties.email,
        phone: parties.phone,
        status: parties.status,
      })
      .from(parties)
      .where(eq(parties.organizationId, orgId));
    return rows.map((row) => ({ ...row, roles: 0 }));
  });
}

/**
 * WAZEN-style: read common ops lists from Neon on Vercel when Nest (Render) is down.
 * Returns null when this section cannot be served from DB (caller uses Nest).
 */
export async function loadOpsRecordsFromDb(
  portal: PortalRole,
  section: string,
): Promise<Record<string, unknown>[] | null> {
  if (!hasDatabaseUrl()) return null;
  if (portal !== 'owner' && portal !== 'developer') return null;
  if (portal === 'developer' && section === 'properties') return null;

  const claims = await readClaims();
  if (!claims?.organizationId) return null;

  try {
    switch (section) {
      case 'properties':
        return await listProperties(claims);
      case 'contacts':
        return await listContacts(claims);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
