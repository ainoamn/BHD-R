import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { reportQueries } from '../src/reports/processor.js';

const databaseUrl = process.env.WORKER_DATABASE_URL;
const adminDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const financialIntegration = databaseUrl && adminDatabaseUrl ? it : it.skip;

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

  financialIntegration(
    'excludes draft journal entries from the trial balance',
    async () => {
      const organizationId = randomUUID();
      const accountId = randomUUID();
      const postedEntryId = randomUUID();
      const draftEntryId = randomUUID();
      const suffix = randomUUID().slice(0, 8);
      const admin = new Pool({ connectionString: adminDatabaseUrl, max: 1 });
      const worker = new Pool({ connectionString: databaseUrl, max: 1 });

      try {
        await admin.query('BEGIN');
        await admin.query("SET LOCAL app.platform_admin = 'true'");
        await admin.query(
          `INSERT INTO currencies
           (code, name_ar, name_en, symbol_ar, symbol_en, minor_unit)
         VALUES ('OMR', 'ريال عماني', 'Omani Rial', 'ر.ع.', 'OMR', 3)
         ON CONFLICT (code) DO NOTHING`,
        );
        await admin.query(
          `INSERT INTO country_packs (country_code, name_ar, name_en, default_currency)
         VALUES ('OM', 'عمان', 'Oman', 'OMR')
         ON CONFLICT (country_code) DO NOTHING`,
        );
        await admin.query(
          `INSERT INTO organizations
           (id, type, slug, legal_name, display_name_ar, display_name_en)
         VALUES ($1, 'company', $2, 'Report verification', 'اختبار التقارير', 'Report verification')`,
          [organizationId, `report-verification-${suffix}`],
        );
        await admin.query(
          `INSERT INTO ledger_accounts
           (id, organization_id, code, name_ar, name_en, type, currency)
         VALUES ($1, $2, '1000', 'النقد', 'Cash', 'asset', 'OMR')`,
          [accountId, organizationId],
        );
        await admin.query(
          `INSERT INTO journal_entries
           (id, organization_id, reference, occurred_on, description, status)
         VALUES
           ($1, $3, $4, CURRENT_DATE, 'Posted entry', 'posted'),
           ($2, $3, $5, CURRENT_DATE, 'Draft entry', 'draft')`,
          [postedEntryId, draftEntryId, organizationId, `POSTED-${suffix}`, `DRAFT-${suffix}`],
        );
        await admin.query(
          `INSERT INTO journal_lines
           (organization_id, journal_entry_id, account_id, debit_minor, credit_minor, currency, minor_unit)
         VALUES
           ($1, $2, $4, 100, 0, 'OMR', 3),
           ($1, $3, $4, 900, 0, 'OMR', 3)`,
          [organizationId, postedEntryId, draftEntryId, accountId],
        );
        await admin.query('COMMIT');

        const client = await worker.connect();
        try {
          await client.query('BEGIN');
          await client.query("SET LOCAL app.worker = 'true'");
          const result = await client.query(reportQueries.trial_balance!.sql, [organizationId]);
          expect(result.rows).toEqual([
            expect.objectContaining({ code: '1000', debit_minor: '100', credit_minor: '0' }),
          ]);
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      } catch (error) {
        await admin.query('ROLLBACK');
        throw error;
      } finally {
        await admin.query('BEGIN');
        await admin.query("SET LOCAL app.platform_admin = 'true'");
        await admin.query('DELETE FROM journal_lines WHERE organization_id = $1', [organizationId]);
        await admin.query('DELETE FROM journal_entries WHERE organization_id = $1', [
          organizationId,
        ]);
        await admin.query('DELETE FROM ledger_accounts WHERE organization_id = $1', [
          organizationId,
        ]);
        await admin.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
        await admin.query('COMMIT');
        await worker.end();
        await admin.end();
      }
    },
    30_000,
  );
});
