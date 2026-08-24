import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { reportQueries } from '../src/reports/processor.js';

const databaseUrl = process.env.WORKER_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('report database contract', () => {
  it('executes every report query and report state update as the restricted worker role', async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL app.worker = 'true'");
      const organizationId = randomUUID();

      for (const [type, definition] of Object.entries(reportQueries)) {
        const result = await client.query(definition.sql, [organizationId]);
        expect(result.rows, type).toEqual([]);
      }

      await expect(
        client.query(
          `UPDATE report_jobs
           SET status = status, object_key = object_key, expires_at = expires_at, updated_at = updated_at
           WHERE false`,
        ),
      ).resolves.toBeDefined();
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await pool.end();
    }
  }, 30_000);
});
