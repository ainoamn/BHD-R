import 'server-only';
import { sql } from 'drizzle-orm';

type Executable = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

/**
 * Production may lag behind schema commits. Idempotent ALTER so profile
 * reads/writes do not fail with "column does not exist".
 */
export async function ensurePropertyProfileListingColumns(
  transaction: Executable,
): Promise<void> {
  await transaction.execute(sql`
    ALTER TABLE "property_profiles"
    ADD COLUMN IF NOT EXISTS "show_owner_name_on_listing" boolean NOT NULL DEFAULT false
  `);
}
