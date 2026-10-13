import { sql } from 'drizzle-orm';

export function listingVisibilityCode(unitId: string): string {
  return `listing_visibility:${unitId}`;
}

/**
 * True when the owner chose to hide unit `u` for the long lease or sale it is under now
 * (expects `units u` in scope). Daily-rental units are never hidden.
 */
export const ownerHidTakenUnit = sql`exists (
  select 1 from stay_policies sp_vis
  where sp_vis.organization_id = u.organization_id
    and sp_vis.kind = 'other'
    and sp_vis.code = 'listing_visibility:' || u.id::text
    and sp_vis.status = 'active'
    and sp_vis.rules_json->>'hidden' = 'true'
    and position('daily' in coalesce(u.offering_modes, '')) = 0
    and (
      exists (
        select 1 from sales_deals sd_vis
        where sd_vis.unit_id = u.id
          and sd_vis.status::text = 'closed_won'
          and sd_vis.id::text = sp_vis.rules_json->>'takenRef'
      )
      or exists (
        select 1 from leases le_vis
        where le_vis.unit_id = u.id
          and le_vis.status::text in ('draft', 'active', 'cancel_requested', 'clearance_pending')
          and le_vis.id::text = sp_vis.rules_json->>'takenRef'
      )
    )
)`;
