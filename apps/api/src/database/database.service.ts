import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createDatabase, type Database } from '@bhd-r/db';
import { sql } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';

export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly #tenantResources = createDatabase(
    process.env.DATABASE_URL ?? 'postgres://bhd_r:bhd_r@localhost:5432/bhd_r',
  );
  readonly #systemResources = createDatabase(
    process.env.SYSTEM_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgres://bhd_r:bhd_r@localhost:5432/bhd_r',
    { max: 5 },
  );

  get raw(): Database {
    return this.#tenantResources.db;
  }

  async withinTenant<T>(
    claims: SessionClaims,
    work: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return this.#tenantResources.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select set_config('app.organization_id', ${claims.organizationId ?? ''}, true)`,
      );
      await transaction.execute(sql`select set_config('app.user_id', ${claims.sub}, true)`);
      await transaction.execute(
        sql`select set_config('app.party_id', ${claims.partyId ?? ''}, true)`,
      );
      await transaction.execute(
        sql`select set_config('app.platform_admin', ${String(claims.roles.includes('platform_admin'))}, true)`,
      );
      await transaction.execute(
        sql`select set_config('app.is_tenant', ${String(claims.roles.includes('tenant'))}, true)`,
      );
      await transaction.execute(sql`select set_config('app.public', 'false', true)`);
      return work(transaction);
    });
  }

  async asSystem<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.#systemResources.db.transaction(async (transaction) => {
      await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
      await transaction.execute(sql`select set_config('app.public', 'false', true)`);
      return work(transaction);
    });
  }

  async asPublic<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.#tenantResources.db.transaction(async (transaction) => {
      await transaction.execute(sql`select set_config('app.platform_admin', 'false', true)`);
      await transaction.execute(sql`select set_config('app.public', 'true', true)`);
      return work(transaction);
    });
  }

  async asWebhookConsumer<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.#systemResources.db.transaction(async (transaction) => {
      await transaction.execute(sql`select set_config('app.platform_admin', 'true', true)`);
      await transaction.execute(sql`select set_config('app.public', 'false', true)`);
      await transaction.execute(sql`select set_config('app.webhook_consumer', 'true', true)`);
      return work(transaction);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.#tenantResources.client.end(), this.#systemResources.client.end()]);
  }
}
