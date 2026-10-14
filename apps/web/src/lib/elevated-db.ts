import 'server-only';
import { createDatabase, type Database } from '@bhd-r/db';
import { applySessionSettings } from '@/lib/db-session-settings';

export type ElevatedTx = Parameters<Parameters<Database['transaction']>[0]>[0];

const globalForDb = globalThis as unknown as { __bhdRWebDb?: { db: Database } };

function sharedDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRWebDb) {
    const { db } = createDatabase(url, { max: 3 });
    globalForDb.__bhdRWebDb = { db };
  }
  return globalForDb.__bhdRWebDb.db;
}

/**
 * A platform-level transaction for cross-organization tables (verification, profile images) and
 * jobs. Callers check the viewer's rights first and filter every query by organization explicitly.
 */
export function elevatedTx<T>(work: (tx: ElevatedTx) => Promise<T>, timeoutMs = 8_000): Promise<T> {
  return sharedDb().transaction(async (tx) => {
    await applySessionSettings(tx, {
      statement_timeout: String(timeoutMs),
      'app.platform_admin': 'true',
    });
    return work(tx);
  });
}

export function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

export function isoOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Postgres "undefined_table": a migration is not applied yet. */
export function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === '42P01' || (cause !== error && cause !== undefined && isMissingTable(cause));
}
