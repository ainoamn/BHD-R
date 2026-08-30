import { cache } from 'react';
import { cookies } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { createDatabase, memberships, users, type Database } from '@bhd-r/db';
import { verifySessionToken } from '@bhd-r/authz';
import type { PortalRole, Viewer } from './types';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireSessionSecret } from '@/lib/runtime-env';

type DbHandle = { db: Database };

const globalForDb = globalThis as unknown as { __bhdRWebDb?: DbHandle };

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

function portalsForRoles(roles: readonly string[]): PortalRole[] {
  const portalSet = new Set<PortalRole>();
  if (roles.some((role) => role === 'platform_admin' || role === 'platform_support'))
    portalSet.add('platform');
  if (roles.includes('developer_admin')) portalSet.add('developer');
  if (roles.includes('tenant')) portalSet.add('tenant');
  if (
    roles.some((role) =>
      [
        'organization_owner',
        'organization_admin',
        'property_manager',
        'finance_manager',
        'maintenance_agent',
        'auditor',
      ].includes(role),
    )
  )
    portalSet.add('owner');
  return [...portalSet];
}

function getSharedDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRWebDb) {
    const { db } = createDatabase(url, { max: 1 });
    globalForDb.__bhdRWebDb = { db };
  }
  return globalForDb.__bhdRWebDb;
}

async function getViewerFromDatabase(): Promise<Viewer | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('bhd_r_session')?.value;
  if (!token) return null;
  try {
    const claims = await verifySessionToken(token, sessionSecret());
    const { db } = getSharedDatabase();
    const user = await db.query.users.findFirst({
      where: eq(users.id, claims.sub),
      columns: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        locale: true,
        disabledAt: true,
        sessionVersion: true,
      },
    });
    if (!user || user.disabledAt || user.sessionVersion !== claims.sessionVersion) return null;

    // Prefer live membership.partyId — JWT may still be null after SSO repair.
    let partyId = claims.partyId;
    if (claims.organizationId) {
      const orgMemberships = await db.query.memberships.findMany({
        where: and(
          eq(memberships.userId, claims.sub),
          eq(memberships.organizationId, claims.organizationId),
          eq(memberships.status, 'active'),
        ),
        columns: { partyId: true },
      });
      partyId = orgMemberships.find((row) => row.partyId)?.partyId ?? claims.partyId;
    }

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      partyId,
      locale: user.locale === 'en' ? 'en' : 'ar',
      organizationId: claims.organizationId,
      roles: claims.roles,
      permissions: claims.permissions,
      portals: portalsForRoles(claims.roles),
    };
  } catch {
    return null;
  }
}

/** One viewer resolution per RSC request (layout + page share the result). */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (hasDatabaseUrl()) return getViewerFromDatabase();

  const { ApiError, apiFetch } = await import('./server-api');
  try {
    const user = await apiFetch<Omit<Viewer, 'portals'> & { portals?: PortalRole[] }>('/v1/me');
    return { ...user, portals: portalsForRoles(user.roles) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
});

/**
 * Fast chrome auth for portal layouts: verify JWT locally and only wait briefly for DB.
 * Avoids full-page flicker when Nest/Neon is cold — shell stays mounted while the page loads.
 */
export const getShellViewer = cache(async (): Promise<Viewer | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get('bhd_r_session')?.value;
  if (!token) return null;

  let claims: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    claims = await verifySessionToken(token, sessionSecret());
  } catch {
    return null;
  }

  const stub: Viewer = {
    id: claims.sub,
    displayName: claims.locale === 'ar' ? 'مستخدم BHD' : 'BHD user',
    partyId: claims.partyId,
    locale: claims.locale === 'en' ? 'en' : 'ar',
    organizationId: claims.organizationId,
    roles: claims.roles,
    permissions: claims.permissions,
    portals: portalsForRoles(claims.roles),
  };

  if (!hasDatabaseUrl()) return stub;

  try {
    const raced = await Promise.race([
      getViewerFromDatabase().then((viewer) => ({ done: true as const, viewer })),
      new Promise<{ done: false }>((resolve) => {
        setTimeout(() => resolve({ done: false }), 900);
      }),
    ]);
    if (raced.done) return raced.viewer;
  } catch {
    /* fall through to JWT stub */
  }
  return stub;
});

export async function requirePortal(locale: string, portal: PortalRole): Promise<Viewer> {
  const { redirect } = await import('next/navigation');
  const viewer = await getViewer();
  if (viewer === null) {
    redirect(`/${locale}/login`);
    throw new Error('unreachable');
  }
  if (!viewer.portals.includes(portal)) {
    redirect(`/${locale}/portal?denied=${portal}`);
    throw new Error('unreachable');
  }
  return viewer;
}

/** Layout-only gate: prefer shell viewer so navigations do not blank the chrome. */
export async function requirePortalShell(locale: string, portal: PortalRole): Promise<Viewer> {
  const { redirect } = await import('next/navigation');
  const viewer = await getShellViewer();
  if (viewer === null) {
    redirect(`/${locale}/login`);
    throw new Error('unreachable');
  }
  if (!viewer.portals.includes(portal)) {
    redirect(`/${locale}/portal?denied=${portal}`);
    throw new Error('unreachable');
  }
  return viewer;
}
