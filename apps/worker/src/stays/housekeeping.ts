import type { Pool } from 'pg';

/**
 * Create a turnover housekeeping task after checkout (idempotent per booking).
 */
export async function ensureStayTurnoverTask(
  pool: Pool,
  input: {
    organizationId: string;
    bookingId: string;
    unitId: string;
    dueOn?: string;
  },
): Promise<{ created: boolean; taskId: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.worker = 'true'");
    await client.query("SET LOCAL app.platform_admin = 'true'");

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM stay_housekeeping_tasks
       WHERE booking_id = $1::uuid
         AND task_kind = 'turnover'
       LIMIT 1`,
      [input.bookingId],
    );
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { created: false, taskId: existing.rows[0].id };
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO stay_housekeeping_tasks (
         organization_id, booking_id, unit_id, task_kind, status, due_on, note
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'turnover', 'open',
         COALESCE($4::date, CURRENT_DATE),
         'Auto-created on checkout'
       )
       RETURNING id`,
      [input.organizationId, input.bookingId, input.unitId, input.dueOn ?? null],
    );

    await client.query('COMMIT');
    return { created: true, taskId: inserted.rows[0]!.id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
