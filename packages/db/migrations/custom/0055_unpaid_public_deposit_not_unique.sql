-- Unpaid website deposit drafts must not occupy the one-active-per-unit slot.
-- The unit is held only after depositPaidAt (or any non-public pending/confirmed booking).

DROP INDEX IF EXISTS reservations_one_active_per_unit;
CREATE UNIQUE INDEX reservations_one_active_per_unit
  ON public.reservations (unit_id)
  WHERE status = ANY (ARRAY['pending'::reservation_status, 'confirmed'::reservation_status])
    AND NOT (
      status = 'pending'::reservation_status
      AND coalesce(terms_snapshot->>'depositPaidAt', '') = ''
      AND (
        terms_snapshot->>'flow' = 'public_deposit_v1'
        OR coalesce(terms_snapshot->>'awaitingPublicDepositPayment', '') IN ('true', 't')
      )
    );

-- Keep public catalogue RLS aligned: unpaid public deposit drafts do not hide the listing.
CREATE OR REPLACE FUNCTION app_private.public_unit_available(target_unit_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
RETURN EXISTS (
  SELECT 1
  FROM units u
  JOIN listings l ON l.unit_id = u.id
  JOIN properties p ON p.id = u.property_id
  WHERE u.id = target_unit_id
    AND u.status = 'active' AND p.status = 'active'
    AND u.publish_when_available AND l.enabled AND l.published_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM holds h
      WHERE h.unit_id = u.id AND h.status = 'active' AND h.expires_at > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.unit_id = u.id
        AND r.status IN ('pending', 'confirmed')
        AND r.expires_at > now()
        AND NOT (
          r.status = 'pending'
          AND coalesce(r.terms_snapshot->>'depositPaidAt', '') = ''
          AND (
            r.terms_snapshot->>'flow' = 'public_deposit_v1'
            OR coalesce(r.terms_snapshot->>'awaitingPublicDepositPayment', '') IN ('true', 't')
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM leases x
      WHERE x.unit_id = u.id AND x.status IN ('draft', 'active') AND x.ends_on >= current_date
    )
    AND NOT EXISTS (
      SELECT 1 FROM maintenance_tickets m
      WHERE m.unit_id = u.id
        AND m.blocks_availability
        AND m.status NOT IN ('resolved', 'closed', 'cancelled')
    )
);
