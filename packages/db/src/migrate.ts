import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './index.js';

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsRoot = resolve(currentDirectory, '../migrations');
const { client, db } = createDatabase(databaseUrl, { max: 1 });

try {
  await client.unsafe(
    await readFile(resolve(migrationsRoot, 'custom/0000_extensions.sql'), 'utf8'),
  );
  await migrate(db, { migrationsFolder: resolve(migrationsRoot, 'generated') });
  await client.unsafe(await readFile(resolve(migrationsRoot, 'custom/0001_rls.sql'), 'utf8'));
  await client.unsafe(await readFile(resolve(migrationsRoot, 'custom/0015_stays_rls.sql'), 'utf8'));
  if (process.env.APPLY_PRIVILEGED_ROLES === 'true') {
    await client.unsafe(
      await readFile(resolve(migrationsRoot, 'privileged/runtime_roles.sql'), 'utf8'),
    );
    await client.unsafe(
      await readFile(resolve(migrationsRoot, 'privileged/worker_role.sql'), 'utf8'),
    );
  }
} finally {
  await client.end();
}
