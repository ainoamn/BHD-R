import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createReportProcessor } from '../src/reports/processor.js';
import type { StorageAdapter } from '../src/storage.js';

describe('report processor state transitions', () => {
  it('marks an unsupported report as failed instead of leaving it running forever', async () => {
    const statements: string[] = [];
    const client = {
      async query(sql: string) {
        statements.push(sql);
        if (sql.includes("SET status = 'running'")) {
          return {
            rows: [
              {
                id: '76af8da6-d9d4-4e48-b4c6-63736cccf63c',
                organization_id: 'b5af68da-d815-47cb-adc3-3213d8a88ca4',
                type: 'unsupported-report',
                format: 'csv',
                status: 'running',
              },
            ],
            fields: [],
          };
        }
        return { rows: [], fields: [] };
      },
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
    } as unknown as Pool;
    const storage = {
      get: vi.fn(),
      putPrivate: vi.fn(),
      putPublic: vi.fn(),
      deletePrivate: vi.fn(),
    } as unknown as StorageAdapter;
    const processor = createReportProcessor(pool, storage, vi.fn());

    await expect(
      processor({
        eventId: '5b62538c-f9f5-43a9-9cb8-a201d769678d',
        organizationId: 'b5af68da-d815-47cb-adc3-3213d8a88ca4',
        aggregateType: 'report_job',
        aggregateId: '76af8da6-d9d4-4e48-b4c6-63736cccf63c',
        topic: 'report.requested',
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'REPORT_TYPE_UNSUPPORTED' });

    expect(statements.some((sql) => sql.includes("SET status = 'failed'"))).toBe(true);
  });
});
