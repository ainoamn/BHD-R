import { cache } from 'react';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { createDatabase, users, type Database } from '@bhd-r/db';
import { verifySessionToken } from '@bhd-r/authz';
import type { PortalRole, Viewer } from './types';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';

type DbHandle = { db: Database };

const globalForDb = globalThis as unknown as { __bhdRWebDb?: DbHandle };

function sessionSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.BHD_R_SESSION_SECRET ?? 'development-session-secret-at-least-32-characters',
  );
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
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      partyId: claims.partyId,
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
