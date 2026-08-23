import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations/generated',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://bhd_r:bhd_r@localhost:5432/bhd_r' },
  strict: true,
  verbose: true,
});
