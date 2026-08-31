import 'server-only';
import { cookies } from 'next/headers';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { verifySessionToken, type SessionClaims } from '@bhd-r/authz';
import {
  addresses,
  approvalRequests,
  createDatabase,
  expenses,
  holds,
  invoices,
  leases,
  maintenanceTickets,
  parties,
  partyRoles,
  properties,
  reservations,
  units,
  type Database,
} from '@bhd-r/db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireSessionSecret } from '@/lib/runtime-env';
import type { PortalRole } from '@/lib/types';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRWebDb?: DbHandle };
const globalForOpsContext = globalThis as unknown as {
  __bhdROpsContextCache?: {
    key: string;
    at: number;
    value: Record<string, unknown>;
  };
};
const OPS_CONTEXT_TTL_MS = 5_000;

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
    const { db } = createDatabase(url, { max: 3 });
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
          ne(properties.status, 'archived'),
        ),
      );

    if (rows.length === 0) return [];

    const propertyIds = rows.map((row) => row.id);

    // Keep these sequential inside one transaction (single connection).
    const unitCounts = await transaction
      .select({
        propertyId: units.propertyId,
        value: count(),
      })
      .from(units)
      .where(and(eq(units.organizationId, orgId), inArray(units.propertyId, propertyIds)))
      .groupBy(units.propertyId);

    // Prefer building-scoped cover; otherwise lowest-position media on any unit.
    const coverRaw = await transaction.execute(sql`
      select distinct on (u.property_id)
        u.property_id as "propertyId",
        um.media_asset_id as "mediaAssetId"
      from unit_media um
      inner join units u on u.id = um.unit_id
      inner join media_assets ma on ma.id = um.media_asset_id
      where um.organization_id = ${orgId}
        and u.property_id in (${sql.join(
          propertyIds.map((id) => sql`${id}`),
          sql`, `,
        )})
      order by
        u.property_id,
        case when ma.metadata->>'galleryScope' = 'building' then 0 else 1 end,
        um.position asc
    `);

    const byProperty = new Map(unitCounts.map((row) => [row.propertyId, Number(row.value)]));
    const coverByProperty = new Map<string, string>();
    const coverList = (
      Array.isArray(coverRaw) ? coverRaw : ((coverRaw as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ propertyId?: string; mediaAssetId?: string }>;
    for (const row of coverList) {
      if (row?.propertyId && row?.mediaAssetId) {
        coverByProperty.set(row.propertyId, `/api/owner/media/${row.mediaAssetId}`);
      }
    }

    return rows.map((row) => ({
      ...row,
      location: [row.street, row.city, row.wilayat, row.governorate].filter(Boolean).join(' · '),
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      units: byProperty.get(row.id) ?? 0,
      coverImageUrl: coverByProperty.get(row.id) ?? null,
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

function asIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function listApprovals(claims: SessionClaims): Promise<Record<string, unknown>[]> {
  return withinViewerTenant(claims, async (transaction) => {
    const orgId = claims.organizationId!;
    const rows = await transaction
      .select({
        id: approvalRequests.id,
        reference: approvalRequests.reference,
        type: approvalRequests.type,
        subject: approvalRequests.subject,
        status: approvalRequests.status,
        createdAt: approvalRequests.createdAt,
        decidedAt: approvalRequests.decidedAt,
      })
      .from(approvalRequests)
      .where(eq(approvalRequests.organizationId, orgId))
      .orderBy(desc(approvalRequests.createdAt));
    return rows.map((row) => ({
      ...row,
      createdAt: asIso(row.createdAt),
      decidedAt: asIso(row.decidedAt),
    }));
  });
}

async function listInvoices(claims: SessionClaims): Promise<Record<string, unknown>[]> {
  return withinViewerTenant(claims, async (transaction) => {
    const orgId = claims.organizationId!;
    const rows = await transaction
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        currency: invoices.currency,
        totalMinor: invoices.totalMinor,
        issuedOn: invoices.issuedOn,
        dueOn: invoices.dueOn,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .where(eq(invoices.organizationId, orgId))
      .orderBy(desc(invoices.createdAt))
      .limit(200);
    return rows.map((row) => ({
      ...row,
      reference: row.invoiceNumber,
      createdAt: asIso(row.createdAt),
    }));
  });
}

async function listExpenses(claims: SessionClaims): Promise<Record<string, unknown>[]> {
  return withinViewerTenant(claims, async (transaction) => {
    const orgId = claims.organizationId!;
    const rows = await transaction
      .select({
        id: expenses.id,
        reference: expenses.reference,
        category: expenses.category,
        description: expenses.description,
        amountMinor: expenses.amountMinor,
        currency: expenses.currency,
        status: expenses.status,
        issuedOn: expenses.issuedOn,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .where(eq(expenses.organizationId, orgId))
      .orderBy(desc(expenses.createdAt))
      .limit(200);
    return rows.map((row) => ({
      ...row,
      createdAt: asIso(row.createdAt),
    }));
  });
}

async function listMaintenance(claims: SessionClaims): Promise<Record<string, unknown>[]> {
  return withinViewerTenant(claims, async (transaction) => {
    const orgId = claims.organizationId!;
    const rows = await transaction
      .select({
        id: maintenanceTickets.id,
        title: maintenanceTickets.title,
        status: maintenanceTickets.status,
        priority: maintenanceTickets.priority,
        category: maintenanceTickets.category,
        createdAt: maintenanceTickets.createdAt,
      })
      .from(maintenanceTickets)
      .where(eq(maintenanceTickets.organizationId, orgId))
      .orderBy(desc(maintenanceTickets.createdAt))
      .limit(200);
    return rows.map((row) => ({
      ...row,
      reference: row.title,
      createdAt: asIso(row.createdAt),
    }));
  });
}

/**
 * WAZEN-style: read common ops lists from Neon on Vercel (avoid Nest cold-start).
 * Returns null when this section cannot be served from DB (caller may use Nest or empty).
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
      case 'approvals':
        return await listApprovals(claims);
      case 'invoices':
        return await listInvoices(claims);
      case 'expenses':
        return await listExpenses(claims);
      case 'maintenance':
        return await listMaintenance(claims);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function clearOpsContextDbCache(): void {
  delete globalForOpsContext.__bhdROpsContextCache;
}

/**
 * Form options for ops create dialogs (esp. bookings): vacant units, properties,
 * parties — loaded from Neon so Nest cold-start does not empty the unit dropdown.
 * Vacant = no active lease, and no active/pending reservation or hold.
 */
export async function loadOpsContextFromDb(
  portal: PortalRole,
): Promise<Record<string, unknown> | null> {
  if (!hasDatabaseUrl()) return null;
  if (portal !== 'owner' && portal !== 'developer') return null;

  const claims = await readClaims();
  if (!claims?.organizationId) return null;

  const cacheKey = `${portal}:${claims.organizationId}`;
  const cached = globalForOpsContext.__bhdROpsContextCache;
  if (cached && cached.key === cacheKey && Date.now() - cached.at < OPS_CONTEXT_TTL_MS) {
    return cached.value;
  }

  try {
    const value = await withinViewerTenant(claims, async (transaction) => {
      const orgId = claims.organizationId!;
      const ownerPartyId = ownerPartyScope(claims);

      const [
        propertyRows,
        unitRows,
        partyRows,
        roleRows,
        activeHolds,
        activeReservations,
        activeLeases,
      ] = await Promise.all([
        transaction
          .select({
            id: properties.id,
            nameAr: properties.nameAr,
            nameEn: properties.nameEn,
          })
          .from(properties)
          .where(
            and(
              eq(properties.organizationId, orgId),
              ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
              ne(properties.status, 'archived'),
            ),
          )
          .orderBy(asc(properties.nameAr)),
        transaction
          .select({
            id: units.id,
            propertyId: units.propertyId,
            code: units.code,
            nameAr: units.nameAr,
            nameEn: units.nameEn,
            currency: units.currency,
          })
          .from(units)
          .innerJoin(properties, eq(properties.id, units.propertyId))
          .where(
            and(
              eq(units.organizationId, orgId),
              ...(ownerPartyId ? [eq(properties.ownerPartyId, ownerPartyId)] : []),
            ),
          )
          .orderBy(asc(units.code)),
        transaction
          .select({ id: parties.id, name: parties.displayName, type: parties.type })
          .from(parties)
          .where(eq(parties.organizationId, orgId))
          .orderBy(asc(parties.displayName)),
        transaction
          .select({ partyId: partyRoles.partyId, roleKey: partyRoles.roleKey })
          .from(partyRoles)
          .where(
            and(
              eq(partyRoles.organizationId, orgId),
              eq(partyRoles.status, 'active'),
              inArray(partyRoles.roleKey, ['owner', 'tenant']),
            ),
          ),
        transaction
          .select({ unitId: holds.unitId })
          .from(holds)
          .where(
            and(
              eq(holds.organizationId, orgId),
              eq(holds.status, 'active'),
              sql`${holds.expiresAt} > now()`,
            ),
          ),
        transaction
          .select({ unitId: reservations.unitId })
          .from(reservations)
          .where(
            and(
              eq(reservations.organizationId, orgId),
              inArray(reservations.status, ['pending', 'confirmed']),
              sql`${reservations.expiresAt} > now()`,
            ),
          ),
        transaction
          .select({ unitId: leases.unitId })
          .from(leases)
          .where(
            and(
              eq(leases.organizationId, orgId),
              inArray(leases.status, [
                'draft',
                'active',
                'cancel_requested',
                'clearance_pending',
              ]),
            ),
          ),
      ]);

      const blockedUnitIds = new Set<string>([
        ...activeHolds.map((row) => row.unitId),
        ...activeReservations.map((row) => row.unitId),
        ...activeLeases.map((row) => row.unitId),
      ]);

      const unitsMapped = unitRows.map((row) => ({
        id: row.id,
        propertyId: row.propertyId,
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        currency: row.currency,
        name: `${row.code} · ${row.nameAr}`,
      }));

      const vacantUnits = unitsMapped.filter((row) => !blockedUnitIds.has(row.id));
      const ownerIds = new Set(
        roleRows.filter((row) => row.roleKey === 'owner').map((row) => row.partyId),
      );
      const tenantIds = new Set(
        roleRows.filter((row) => row.roleKey === 'tenant').map((row) => row.partyId),
      );

      return {
        properties: propertyRows.map((row) => ({
          id: row.id,
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          name: row.nameAr || row.nameEn,
        })),
        units: unitsMapped,
        vacantUnits,
        parties: partyRows,
        owners: partyRows.filter((row) => ownerIds.has(row.id)),
        tenants: partyRows.filter((row) => tenantIds.has(row.id)),
      };
    });
    globalForOpsContext.__bhdROpsContextCache = {
      key: cacheKey,
      at: Date.now(),
      value,
    };
    return value;
  } catch {
    return null;
  }
}
