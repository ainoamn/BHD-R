import 'server-only';
import { sql } from 'drizzle-orm';
import { hasPermission, type SessionClaims } from '@bhd-r/authz';
import { stayPolicies, workflowEvents } from '@bhd-r/db';
import { listingVisibilityCode } from '@/lib/listing-visibility-sql';
import { ownerPartyScope, withinViewerTenant } from '@/lib/portal-ops-data';

type Tx = Parameters<Parameters<typeof withinViewerTenant>[1]>[0];

/**
 * A unit that has been leased on a long contract or sold. It stays on the site, marked leased
 * or sold, until the owner answers:
 * - `keep_selling` (listed for rent and sale, now leased): keep it for sale, or hide it;
 * - `hide` (leased rent-only unit, or sold): hide it from the listings, or keep showing it.
 * Daily-rental units never ask: they stay listed while they are offered by the night.
 */
export type SaleDecisionUnit = {
  unitId: string;
  unitCode: string | null;
  unitNameAr: string;
  unitNameEn: string | null;
  propertyId: string;
  propertyNameAr: string;
  propertyNameEn: string | null;
  question: 'keep_selling' | 'hide';
  reason: 'leased' | 'sold';
  /** The lease or sale the answer belongs to; a later lease or sale asks again. */
  takenRef: string;
  tenant: string | null;
  leasedSince: string;
  salePriceMinor: string | null;
  currency: string;
};

const POLICY_KIND = 'other';
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
    select * from (
      select
        u.id::text as "unitId",
        u.code as "unitCode",
        u.name_ar as "unitNameAr",
        u.name_en as "unitNameEn",
        p.id::text as "propertyId",
        p.name_ar as "propertyNameAr",
        p.name_en as "propertyNameEn",
        case
          when sold.id is null and u.listing_purpose = 'both' then 'keep_selling'
          else 'hide'
        end as "question",
        case when sold.id is not null then 'sold' else 'leased' end as "reason",
        coalesce(sold.id, lease.id)::text as "takenRef",
        coalesce(sold.party, lease.tenant) as "tenant",
        coalesce(sold.since, lease.since) as "leasedSince",
        u.sale_price_minor::text as "salePriceMinor",
        u.currency as "currency"
      from units u
      join properties p on p.id = u.property_id
      left join lateral (
        select sd.id, sd.updated_at as since, pa.display_name as party
        from sales_deals sd
        left join parties pa on pa.id = sd.buyer_party_id
        where sd.unit_id = u.id and sd.status::text = 'closed_won'
        order by sd.updated_at desc
        limit 1
      ) sold on true
      left join lateral (
        select le.id, le.created_at as since, pa.display_name as tenant
        from leases le
        left join parties pa on pa.id = le.tenant_party_id
        where le.unit_id = u.id and le.status::text in ${LIVE_LEASE}
        order by le.created_at desc
        limit 1
      ) lease on true
      where u.organization_id = ${orgId}::uuid
        and u.publish_when_available = true
        and p.status = 'active'
        and position('daily' in coalesce(u.offering_modes, '')) = 0
        and (sold.id is not null or lease.id is not null)
        and not (sold.id is null and u.listing_purpose = 'sale')
        ${options.ownerPartyId ? sql`and p.owner_party_id = ${options.ownerPartyId}::uuid` : sql``}
        ${options.propertyId ? sql`and p.id = ${options.propertyId}::uuid` : sql``}
    ) taken
    where not exists (
        select 1 from stay_policies sp
        where sp.organization_id = ${orgId}::uuid
          and sp.kind = 'other'
          and sp.code = 'listing_visibility:' || taken."unitId"
          and sp.status = 'active'
          and sp.rules_json->>'takenRef' = taken."takenRef"
      )
    order by taken."leasedSince" asc
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

/** Property page banner: leased or sold units on one property waiting for the owner's answer. */
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

export type ListingDecision =
  { question: 'keep_selling'; keepSelling: boolean } | { question: 'hide'; hide: boolean };

export type ListingDecisionResult = {
  unitId: string;
  listingPurpose: 'rent' | 'sale' | 'both';
  hidden: boolean;
};

/**
 * keep_selling: yes → listed for sale only and stays visible; no → rent only and hidden while leased.
 * hide: yes → hidden from the listings while this lease or sale lasts; no → stays listed, marked
 * leased or sold, and can't be booked.
 */
export async function decideUnitSale(
  claims: SessionClaims,
  unitId: string,
  decision: ListingDecision,
): Promise<ListingDecisionResult> {
  if (!canDecideUnitSale(claims)) throw new Error('forbidden');
  const orgId = claims.organizationId!;
  const ownerPartyId = ownerPartyScope(claims);
  return withinViewerTenant(claims, async (tx) => {
    const open = await listSaleDecisionUnits(tx, orgId, { ownerPartyId, limit: 500 });
    const unit = open.find((item) => item.unitId === unitId);
    if (!unit || unit.question !== decision.question) throw new Error('sale_decision_not_open');

    let listingPurpose: ListingDecisionResult['listingPurpose'];
    let hidden: boolean;
    if (decision.question === 'keep_selling') {
      listingPurpose = decision.keepSelling ? 'sale' : 'rent';
      hidden = !decision.keepSelling;
      await tx.execute(sql`
        update units
        set listing_purpose = ${listingPurpose}, updated_at = now()
        where id = ${unitId}::uuid and organization_id = ${orgId}::uuid
      `);
    } else {
      hidden = decision.hide;
      const [row] = rowsOf<{ purpose: ListingDecisionResult['listingPurpose'] }>(
        await tx.execute(
          sql`select listing_purpose as purpose from units where id = ${unitId}::uuid limit 1`,
        ),
      );
      listingPurpose = row?.purpose ?? 'rent';
    }

    const code = listingVisibilityCode(unitId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${orgId}:${code}`}))`);
    await tx.execute(sql`
      update stay_policies
      set status = 'archived', updated_at = now()
      where organization_id = ${orgId}::uuid
        and kind = 'other'
        and code = ${code}
        and status = 'active'
    `);
    const [latest] = rowsOf<{ version: number }>(
      await tx.execute(sql`
        select coalesce(max(version), 0)::int as version
        from stay_policies
        where organization_id = ${orgId}::uuid and kind = 'other' and code = ${code}
      `),
    );
    await tx.insert(stayPolicies).values({
      organizationId: orgId,
      kind: POLICY_KIND,
      code,
      nameAr: 'ظهور الوحدة بعد التأجير أو البيع',
      nameEn: 'Unit visibility after lease or sale',
      version: (latest?.version ?? 0) + 1,
      rulesJson: {
        scope: 'listing_visibility',
        unitId,
        takenRef: unit.takenRef,
        reason: unit.reason,
        hidden,
        decidedByUserId: claims.sub,
      },
      status: 'active',
    });

    await tx.insert(workflowEvents).values({
      organizationId: orgId,
      actorUserId: claims.sub,
      resourceType: 'unit',
      resourceId: unitId,
      eventType:
        decision.question === 'keep_selling'
          ? decision.keepSelling
            ? 'unit.kept_for_sale'
            : 'unit.sale_withdrawn'
          : hidden
            ? 'unit.listing_hidden'
            : 'unit.listing_kept',
      fromStatus: unit.reason,
      toStatus: hidden ? 'hidden' : 'listed',
      metadata: { propertyId: unit.propertyId, unitCode: unit.unitCode, takenRef: unit.takenRef },
    });
    return { unitId, listingPurpose, hidden };
  });
}
