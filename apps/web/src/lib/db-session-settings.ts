import { sql, type SQL } from 'drizzle-orm';
import type { SessionClaims } from '@bhd-r/authz';

type SqlExecutor = { execute: (query: SQL) => Promise<unknown> };

/**
 * Applies transaction-local settings in a single round-trip. Each separate
 * `select set_config(...)` costs a network round-trip before any real query runs.
 */
export async function applySessionSettings(
  executor: SqlExecutor,
  settings: Record<string, string>,
): Promise<void> {
  const entries = Object.entries(settings);
  if (!entries.length) return;
  await executor.execute(
    sql`select ${sql.join(
      entries.map(([name, value]) => sql`set_config(${name}, ${value}, true)`),
      sql`, `,
    )}`,
  );
}

/** RLS context for a signed-in portal viewer. */
export function viewerTenantSettings(
  claims: Pick<SessionClaims, 'organizationId' | 'sub' | 'partyId' | 'roles'>,
): Record<string, string> {
  return {
    'app.organization_id': claims.organizationId ?? '',
    'app.user_id': claims.sub,
    'app.party_id': claims.partyId ?? '',
    'app.platform_admin': String(claims.roles.includes('platform_admin')),
    'app.is_tenant': String(claims.roles.includes('tenant')),
    'app.public': 'false',
  };
}
