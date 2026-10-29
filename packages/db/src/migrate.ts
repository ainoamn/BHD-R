import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './index.js';

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsRoot = resolve(currentDirectory, '../migrations');
const customRoot = resolve(migrationsRoot, 'custom');
const { client, db } = createDatabase(databaseUrl, { max: 1 });

async function applyCustomSql(fileName: string) {
  await client.unsafe(await readFile(resolve(customRoot, fileName), 'utf8'));
}

try {
  // Extensions before Drizzle-generated DDL.
  await applyCustomSql('0000_extensions.sql');
  await migrate(db, { migrationsFolder: resolve(migrationsRoot, 'generated') });

  // Every remaining custom/*.sql in lexical order so CI/Neon stay aligned with schema.
  // New files under custom/ are applied automatically — do not maintain a manual allowlist.
  const customFiles = (await readdir(customRoot))
    .filter((name) => name.endsWith('.sql') && name !== '0000_extensions.sql')
    .sort((a, b) => a.localeCompare(b, 'en'));
  for (const fileName of customFiles) {
    await applyCustomSql(fileName);
  }

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
