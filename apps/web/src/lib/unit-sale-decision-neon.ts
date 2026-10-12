import 'server-only';
import { sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { workflowEvents } from '@bhd-r/db';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';

type Tx = Parameters<Parameters<typeof withinViewerTenant>[1]>[0];

/** A unit listed for rent and sale that has just been leased: the owner decides whether to keep selling it. */
export type SaleDecisionUnit = {
  unitId: string;
  unitCode: string | null;
  unitNameAr: string;
  unitNameEn: string | null;
  propertyId: string;
  propertyNameAr: string;
  propertyNameEn: string | null;
  tenant: string | null;
  leasedSince: string;
  salePriceMinor: string | null;
  currency: string;
};

const LIVE_LEASE = sql`('active', 'cancel_requested', 'clearance_pending')`;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

export async function listSaleDecisionUnits(
  tx: Tx,
  orgId: string,
  options: { ownerPartyId?: string | null; propertyId?: string | null; limit?: number } = {},
): Promise<SaleDecisionUnit[]> {
  const result = await tx.execute(sql`
    select
      u.id::text as "unitId",
      u.code as "unitCode",
      u.name_ar as "unitNameAr",
      u.name_en as "unitNameEn",
      p.id::text as "propertyId",
      p.name_ar as "propertyNameAr",
      p.name_en as "propertyNameEn",
      lease.tenant as "tenant",
      lease.since as "leasedSince",
      u.sale_price_minor::text as "salePriceMinor",
      u.currency as "currency"
    from units u
    join properties p on p.id = u.property_id
    join lateral (
      select le.created_at as since, pa.display_name as tenant
      from leases le
      left join parties pa on pa.id = le.tenant_party_id
      where le.unit_id = u.id and le.status::text in ${LIVE_LEASE}
      order by le.created_at desc
      limit 1
    ) lease on true
    where u.organization_id = ${orgId}::uuid
      and u.listing_purpose = 'both'
      and u.publish_when_available = true
      and p.status = 'active'
      ${options.ownerPartyId ? sql`and p.owner_party_id = ${options.ownerPartyId}::uuid` : sql``}
      ${options.propertyId ? sql`and p.id = ${options.propertyId}::uuid` : sql``}
    order by lease.since asc
    limit ${options.limit ?? 50}
  `);
  return rowsOf<Omit<SaleDecisionUnit, 'leasedSince'> & { leasedSince: Date | string }>(result).map(
    (row) => ({
      ...row,
      leasedSince:
        row.leasedSince instanceof Date ? row.leasedSince.toISOString() : String(row.leasedSince),
    }),
  );
}

export function canDecideUnitSale(claims: SessionClaims): boolean {
  return Boolean(claims.organizationId) && hasPermission(claims, 'unit.update');
}

/** Property page banner: leased rent-and-sale units on one property. */
export async function loadPropertySaleDecisions(
  claims: SessionClaims,
  propertyId: string,
): Promise<SaleDecisionUnit[]> {
  if (!canDecideUnitSale(claims)) return [];
  return withinViewerTenant(claims, (tx) =>
    listSaleDecisionUnits(tx, claims.organizationId!, {
      ownerPartyId: ownerPartyScope(claims),
      propertyId,
    }),
  );
}

/**
 * Yes → the unit stays on the site for sale only (the rent button disappears).
 * No → it is offered for rent only, so it stays hidden while leased and returns once vacant.
 */
export async function decideUnitSale(
  claims: SessionClaims,
  unitId: string,
  keepSelling: boolean,
): Promise<{ unitId: string; listingPurpose: 'sale' | 'rent' }> {
  if (!canDecideUnitSale(claims)) throw new Error('forbidden');
  const orgId = claims.organizationId!;
  const ownerPartyId = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    const open = await listSaleDecisionUnits(tx, orgId, { ownerPartyId, limit: 500 });
    const unit = open.find((item) => item.unitId === unitId);
    if (!unit) throw new Error('sale_decision_not_open');
    const listingPurpose = keepSelling ? 'sale' : 'rent';
    await tx.execute(sql`
      update units
      set listing_purpose = ${listingPurpose}, updated_at = now()
      where id = ${unitId}::uuid and organization_id = ${orgId}::uuid
    `);
    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'unit',
      resourceId: unitId,
      eventType: keepSelling ? 'unit.kept_for_sale' : 'unit.sale_withdrawn',
      fromStatus: 'both',
      toStatus: listingPurpose,
      metadata: { propertyId: unit.propertyId, unitCode: unit.unitCode },
    });
    return { unitId, listingPurpose };
  });
}
