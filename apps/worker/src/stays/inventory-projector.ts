import type { Pool } from 'pg';

/**
 * Rebuild stay_inventory_days for one unit from active locks + profile rates.
 * Projection only — booking still re-checks stay_inventory_locks in the command path.
 */
export async function rebuildStayInventoryDaysForUnit(
  pool: Pool,
  input: { organizationId: string; unitId: string; horizonDays?: number },
): Promise<{ days: number }> {
  const horizon = Math.min(Math.max(input.horizonDays ?? 365, 1), 730);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.worker = 'true'");
    await client.query("SET LOCAL app.platform_admin = 'true'");

    const profile = await client.query<{
      currency: string;
      min_nights: number;
      advance_booking_days: number;
      base_nightly_minor: string | null;
    }>(
      `SELECT sp.currency,
              sp.min_nights,
              sp.advance_booking_days,
              (
                SELECT srp.base_nightly_minor::text
                FROM stay_rate_plans srp
                WHERE srp.stay_profile_id = sp.id
                  AND srp.enabled = true
                ORDER BY srp.priority ASC, srp.created_at ASC
                LIMIT 1
              ) AS base_nightly_minor
       FROM stay_profiles sp
       WHERE sp.organization_id = $1::uuid
         AND sp.unit_id = $2::uuid
       LIMIT 1`,
      [input.organizationId, input.unitId],
    );

    const row = profile.rows[0];
    const advance = row
      ? Math.min(Math.max(row.advance_booking_days || horizon, 1), horizon)
      : horizon;
    const currency = row?.currency ?? null;
    const minNights = row?.min_nights ?? null;
    const rateMinor = row?.base_nightly_minor ?? null;

    await client.query(
      `DELETE FROM stay_inventory_days
       WHERE organization_id = $1::uuid
         AND unit_id = $2::uuid
         AND stay_date >= CURRENT_DATE
         AND stay_date < CURRENT_DATE + ($3::int)`,
      [input.organizationId, input.unitId, advance],
    );

    const inserted = await client.query<{ count: string }>(
      `WITH days AS (
         SELECT generate_series(
           CURRENT_DATE,
           CURRENT_DATE + ($3::int - 1),
           '1 day'::interval
         )::date AS stay_date
       ),
       day_status AS (
         SELECT
           d.stay_date,
           CASE
             WHEN bool_or(l.kind = 'booking') THEN 'booked'
             WHEN bool_or(l.kind = 'hold') THEN 'hold'
             WHEN bool_or(l.kind = 'maintenance') THEN 'maintenance'
             WHEN bool_or(l.kind = 'lease') THEN 'lease'
             WHEN bool_or(l.kind IN ('owner_block', 'channel')) THEN 'blocked'
             ELSE 'available'
           END AS availability_status
         FROM days d
         LEFT JOIN stay_inventory_locks l
           ON l.unit_id = $2::uuid
          AND l.organization_id = $1::uuid
          AND l.status = 'active'
          AND d.stay_date >= lower(l.stay_range)
          AND d.stay_date < upper(l.stay_range)
         GROUP BY d.stay_date
       )
       INSERT INTO stay_inventory_days (
         organization_id, unit_id, stay_date, availability_status,
         effective_rate_minor, currency, min_nights
       )
       SELECT
         $1::uuid,
         $2::uuid,
         ds.stay_date,
         ds.availability_status,
         CASE WHEN $4::text IS NULL THEN NULL ELSE $4::bigint END,
         $5,
         $6
       FROM day_status ds
       RETURNING 1`,
      [input.organizationId, input.unitId, advance, rateMinor, currency, minNights],
    );

    await client.query('COMMIT');
    return { days: inserted.rowCount ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseExpiredStayHolds(pool: Pool): Promise<{ released: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.worker = 'true'");
    await client.query("SET LOCAL app.platform_admin = 'true'");

    const locks = await client.query<{ id: string }>(
      `UPDATE stay_inventory_locks
       SET status = 'released', updated_at = now()
       WHERE kind = 'hold'
         AND status = 'active'
         AND expires_at IS NOT NULL
         AND expires_at <= now()
       RETURNING id`,
    );

    await client.query(
      `UPDATE stay_holds
       SET status = 'expired', updated_at = now()
       WHERE status = 'active'
         AND expires_at <= now()`,
    );

    await client.query('COMMIT');
    return { released: locks.rowCount ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
