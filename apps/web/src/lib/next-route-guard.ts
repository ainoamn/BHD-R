import 'server-only';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { and, eq, isNull } from 'drizzle-orm';
import { verifySessionToken, type SessionClaims } from '@bhd-r/authz';
import { createDatabase, sessions, users, type Database } from '@bhd-r/db';
import { verifyCsrfToken } from '@bhd-r/security';
import { requireCsrfSecret, requireSessionSecret } from '@/lib/runtime-env';

type DbHandle = { db: Database };
const globalForDb = globalThis as unknown as { __bhdRRouteGuardDb?: DbHandle };

function getDatabase(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!globalForDb.__bhdRRouteGuardDb) {
    const { db } = createDatabase(url, { max: 2 });
    globalForDb.__bhdRRouteGuardDb = { db };
  }
  return globalForDb.__bhdRRouteGuardDb;
}

export class RouteGuardError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'RouteGuardError';
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function assertBrowserOrigin(request: Request): void {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') {
    throw new RouteGuardError(403, 'csrf_rejected');
  }
  const origin = request.headers.get('origin');
  // CSRF writes must prove same-origin browser context (P2 CSRF leftover).
  if (!origin) {
    if (fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none') {
      return;
    }
    throw new RouteGuardError(403, 'csrf_rejected');
  }
  try {
    const requestHost = new URL(request.url).host;
    const originHost = new URL(origin).host;
    if (requestHost !== originHost) {
      if (fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
        throw new RouteGuardError(403, 'csrf_rejected');
      }
    }
  } catch (error) {
    if (error instanceof RouteGuardError) throw error;
    throw new RouteGuardError(403, 'csrf_rejected');
  }
}

/**
 * Live session for Next Route Handlers (P0-02 interim):
 * JWT + DB user.sessionVersion + non-revoked sessions row + optional CSRF double-submit.
 */
export async function requireLiveSession(
  request: Request,
  options: { requireCsrf?: boolean } = {},
): Promise<SessionClaims> {
  const cookieStore = await cookies();
  const token = cookieStore.get('bhd_r_session')?.value;
  if (!token) throw new RouteGuardError(401, 'unauthorized');

  let claims: SessionClaims;
  try {
    claims = await verifySessionToken(token, requireSessionSecret());
  } catch {
    throw new RouteGuardError(401, 'unauthorized');
  }

  const { db } = getDatabase();
  const user = await db.query.users.findFirst({
    where: eq(users.id, claims.sub),
    columns: { id: true, disabledAt: true, sessionVersion: true },
  });
  if (!user || user.disabledAt || user.sessionVersion !== claims.sessionVersion) {
    throw new RouteGuardError(401, 'unauthorized');
  }

  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.id, claims.sid), eq(sessions.userId, claims.sub), isNull(sessions.revokedAt)),
    columns: { id: true, tokenIdHash: true, expiresAt: true, revokedAt: true },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    throw new RouteGuardError(401, 'unauthorized');
  }
  if (session.tokenIdHash !== tokenHash(token)) {
    throw new RouteGuardError(401, 'unauthorized');
  }

  if (options.requireCsrf) {
    assertBrowserOrigin(request);
    const header = request.headers.get('x-csrf-token');
    const cookie = cookieStore.get('bhd_r_csrf')?.value;
    if (
      !header ||
      !cookie ||
      header !== cookie ||
      !verifyCsrfToken(header, claims.sid, requireCsrfSecret())
    ) {
      throw new RouteGuardError(403, 'csrf_rejected');
    }
  }

  return claims;
}

export function guardErrorResponse(error: unknown): {
  status: number;
  body: { error: { code: string; message?: string; messageAr?: string } };
} {
  if (error instanceof RouteGuardError) {
    const messages: Record<string, { en: string; ar: string }> = {
      unauthorized: { en: 'Sign in required', ar: 'يلزم تسجيل الدخول' },
      csrf_rejected: {
        en: 'Security token rejected — refresh the page and retry',
        ar: 'رمز الحماية مرفوض — حدّث الصفحة وأعد المحاولة',
      },
      misconfigured: { en: 'Server misconfigured', ar: 'إعداد الخادم غير مكتمل' },
    };
    const known = messages[error.code];
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          ...(known ? { message: known.en, messageAr: known.ar } : {}),
        },
      },
    };
  }
  if (error instanceof Error && error.message === 'BHD_R_SESSION_SECRET_required') {
    return { status: 503, body: { error: { code: 'misconfigured' } } };
  }
  return { status: 500, body: { error: { code: 'internal_error' } } };
}
