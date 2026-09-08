import 'server-only';
import { sql } from 'drizzle-orm';

type Executable = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

export async function ensureUnitOfferingModesColumn(transaction: Executable): Promise<void> {
  await transaction.execute(sql`
    ALTER TABLE "units"
    ADD COLUMN IF NOT EXISTS "offering_modes" varchar(64) NOT NULL DEFAULT 'monthly'
  `);
}
