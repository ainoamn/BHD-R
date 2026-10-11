import 'server-only';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@bhd-r/db';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRLiveDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRLiveDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRLiveDb = { db };
  }
  return globalForDb.__bhdRLiveDb;
}

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as T[];
}

/** Postgres "undefined_table": the live_changes migration is not applied yet. */
function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === '42P01' || (cause !== error && isMissingTable(cause));
}

async function readVersion(query: ReturnType<typeof sql>): Promise<string | null> {
  try {
    const rows = rowsOf<{ v: string | number | null }>(await getDatabase().db.execute(query));
    const value = rows[0]?.v;
    return value === null || value === undefined ? null : String(value);
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

/** Newest change id for an organization; moves whenever any of its records changes. */
export function organizationLiveVersion(organizationId: string): Promise<string | null> {
  return readVersion(sql`
    select coalesce(max(id), 0)::text as v
    from live_changes
    where organization_id = ${organizationId}::uuid
  `);
}

/**
 * Newest change id for one stay booking (the booking row, its status history,
 * guests and payments). Null unless the reference code matches the booking.
 */
export function stayBookingLiveVersion(
  bookingId: string,
  referenceCode: string,
): Promise<string | null> {
  return readVersion(sql`
    select (
      select coalesce(max(lc.id), 0)
      from live_changes lc
      where lc.resource_id = b.id
    )::text as v
    from stay_bookings b
    where b.id = ${bookingId}::uuid
      and b.reference_code = ${referenceCode.trim().toUpperCase()}
  `);
}
