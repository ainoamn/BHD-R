import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { createDatabase, parties, type Database } from '@bhd-r/db';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRPropertyWriteDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRPropertyWriteDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRPropertyWriteDb = { db };
  }
  return globalForDb.__bhdRPropertyWriteDb;
}

export type OwnerPartyOption = {
  id: string;
  displayName: string;
  type: string;
};

/** Active parties in the org — used to choose property ownership. */
export async function listOwnerPartyOptions(
  organizationId: string,
): Promise<OwnerPartyOption[]> {
  const { db } = getDatabase();
  return db
    .select({
      id: parties.id,
      displayName: parties.displayName,
      type: parties.type,
    })
    .from(parties)
    .where(and(eq(parties.organizationId, organizationId), eq(parties.status, 'active')))
    .orderBy(asc(parties.displayName));
}
