import { createHash } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { and, eq, isNull } from 'drizzle-orm';
import { createDatabase, memberships, sessions, users, type Database } from '@bhd-r/db';
import { verifySessionToken } from '@bhd-r/authz';
import type { PortalRole, Viewer } from './types';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { canOpenPortalPath, portalsForRoles as portalsForRoleKeys } from '@/lib/portal-access';
import { requireSessionSecret } from '@/lib/runtime-env';

type DbHandle = { db: Database };

const globalForDb = globalThis as unknown as { __bhdRWebDb?: DbHandle };

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function portalsForRoles(roles: readonly string[]): PortalRole[] {
  // Any account can rent or book; the tenant space finds its records by verified email.
  return portalsForRoleKeys(roles, { tenantForEveryone: true });
}

function getSharedDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRWebDb) {
    const { db } = createDatabase(url, { max: 8 });
    globalForDb.__bhdRWebDb = { db };
  }
  return globalForDb.__bhdRWebDb;
}

/**
 * Full DB-backed viewer: JWT + user.sessionVersion + non-revoked sessions row.
 * Same live-session rules as requireLiveSession() in next-route-guard.
 */
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

    const session = await db.query.sessions.findFirst({
      where: and(
        eq(sessions.id, claims.sid),
        eq(sessions.userId, claims.sub),
        isNull(sessions.revokedAt),
      ),
      columns: { id: true, tokenIdHash: true, expiresAt: true },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) return null;
    if (session.tokenIdHash !== tokenHash(token)) return null;

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

/**
 * Authoritative viewer for data and portal-path access.
 * Never falls back to a JWT-only stub when the database is configured —
 * a revoked or expired session must fail closed.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  // Fixture e2e: always use mock Nest /v1/me (CI DB has no matching sessions row).
  if (process.env.E2E_FORCE_NEST_FIXTURES === '1') {
    const { ApiError, apiFetch } = await import('./server-api');
    try {
      const user = await apiFetch<Omit<Viewer, 'portals'> & { portals?: PortalRole[] }>('/v1/me');
      return { ...user, portals: portalsForRoles(user.roles) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  }

  if (hasDatabaseUrl()) {
    return getViewerFromDatabase();
  }

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
 * Fast chrome auth for portal layouts only: verify JWT locally and wait briefly for DB.
 * Must NOT be used to authorize data reads or protected path access.
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

  // Fixture e2e only (never set in production): trust verified JWT chrome even when
  // CI DATABASE_URL points at an empty migrated database.
  if (process.env.E2E_FORCE_NEST_FIXTURES === '1') return stub;

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
    /* fall through to JWT stub for chrome only */
  }
  return stub;
});

/** BHD-SESSION-POLICY: expired product session → one silent hop to Identity, no login screen. */
function silentIdentityStart(locale: string, portal: PortalRole): string {
  const safeLocale = locale === 'en' ? 'en' : 'ar';
  return `/api/auth/bhd/start?returnTo=${encodeURIComponent(`/${safeLocale}/${portal}`)}`;
}

export async function requirePortal(locale: string, portal: PortalRole): Promise<Viewer> {
  const { redirect } = await import('next/navigation');
  const viewer = await getViewer();
  if (viewer === null) {
    redirect(silentIdentityStart(locale, portal));
    throw new Error('unreachable');
  }
  if (!viewer.portals.includes(portal)) {
    redirect(`/${locale}/portal?denied=${portal}`);
    throw new Error('unreachable');
  }
  return viewer;
}

/** Pages outside the ops sections follow the same rules as their sidebar entry. */
export async function requirePortalPath(portal: PortalRole, path: string): Promise<void> {
  // Live DB session only — never authorize via getShellViewer JWT stub.
  const viewer = await getViewer();
  if (!viewer || !canOpenPortalPath(viewer, portal, path)) {
    const { notFound } = await import('next/navigation');
    notFound();
  }
}

/** Layout-only gate: prefer shell viewer so navigations do not blank the chrome. */
export async function requirePortalShell(locale: string, portal: PortalRole): Promise<Viewer> {
  const { redirect } = await import('next/navigation');
  const viewer = await getShellViewer();
  if (viewer === null) {
    redirect(silentIdentityStart(locale, portal));
    throw new Error('unreachable');
  }
  if (!viewer.portals.includes(portal)) {
    redirect(`/${locale}/portal?denied=${portal}`);
    throw new Error('unreachable');
  }
  return viewer;
}
