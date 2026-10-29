import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { createDatabase, users } from '@bhd-r/db';
import { hasDatabaseUrl, rebindProductSessionFromProfile } from '@/lib/bhd/identity-session';
import { identitySettings, safeReturnTo } from '@/lib/bhd/oauth';
import {
  ORGANIZATION_COOKIE,
  rememberedOrganization,
  setSessionCookies,
} from '@/lib/bhd/session-cookies';
import { requireLiveSession } from '@/lib/next-route-guard';
import { clientSecurityContext } from '@/lib/security-protection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type IdentityProfile = {
  sub: string;
  email: string;
  name: string;
};

async function profileFromWindowToken(token: string): Promise<IdentityProfile> {
  const { issuer } = identitySettings('https://r.bhd-om.com');
  const response = await fetch(`${issuer}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`me_${response.status}`);
  const body = (await response.json()) as {
    user?: { id?: string; email?: string; name?: string } | null;
  };
  const user = body.user;
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (!user?.id || !email) throw new Error('claims');
  return {
    sub: user.id,
    email,
    name:
      typeof user.name === 'string' && user.name.trim() ? user.name.trim() : email.split('@')[0]!,
  };
}

function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const xfHost = request.headers.get('x-forwarded-host');
  const xfProto = request.headers.get('x-forwarded-proto') || 'https';
  if (xfHost) return `${xfProto.split(',')[0]!.trim()}://${xfHost.split(',')[0]!.trim()}`;
  return url.origin;
}

function bindReturnPath(returnTo: string, sub: string) {
  const safe = safeReturnTo(returnTo, '/ar/portal');
  try {
    const url = new URL(safe, 'https://bhd.local');
    url.searchParams.set('au', sub);
    url.searchParams.set('_bhd', String(Date.now()));
    return `${url.pathname}${url.search}`;
  } catch {
    return safe;
  }
}

function wantsJson(request: Request) {
  const accept = request.headers.get('accept') || '';
  return accept.includes('application/json');
}

function redirectHome(origin: string, returnTo: string) {
  const response = NextResponse.redirect(new URL(returnTo, origin), 303);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

function jsonOk(
  payload: { ok: true; unchanged?: boolean; user: { id: string; email: string; name: string } },
  applyCookies?: (response: NextResponse) => void,
) {
  const response = NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    },
  });
  response.cookies.delete(ORGANIZATION_COOKIE);
  applyCookies?.(response);
  return response;
}

async function rebind(request: Request) {
  const origin = requestOrigin(request);
  const json = wantsJson(request);

  if (!hasDatabaseUrl()) {
    if (json) return NextResponse.json({ ok: false, error: 'api' }, { status: 503 });
    return NextResponse.redirect(new URL('/ar/login?bhd=api', origin), 303);
  }

  let token = '';
  let returnTo = '/ar/portal';
  const contentType = request.headers.get('content-type') || '';
  if (request.method === 'POST' && contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      returnTo?: string;
    };
    token = typeof body.token === 'string' ? body.token.trim() : '';
    returnTo = safeReturnTo(body.returnTo, '/ar/portal');
  } else if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    token = String(form?.get('token') || '').trim();
    returnTo = safeReturnTo(String(form?.get('returnTo') || ''), '/ar/portal');
  } else {
    returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'), '/ar/portal');
  }

  const header = request.headers.get('authorization');
  if (!token && header?.toLowerCase().startsWith('bearer ')) token = header.slice(7).trim();
  if (!token || token.length < 20) {
    if (json) return NextResponse.json({ ok: false, error: 'token' }, { status: 401 });
    return NextResponse.redirect(
      new URL(`/api/auth/bhd/start?returnTo=${encodeURIComponent(returnTo)}`, origin),
      303,
    );
  }

  const cookieStore = await cookies();
  const preferredOrganizationId = rememberedOrganization(
    cookieStore.get(ORGANIZATION_COOKIE)?.value,
  );

  let previousSessionId: string | undefined;
  let previousUserId: string | undefined;
  try {
    const claims = await requireLiveSession(request, { requireCsrf: false });
    previousSessionId = claims.sid;
    previousUserId = claims.sub;
  } catch {
    /* no prior product session */
  }

  try {
    const profile = await profileFromWindowToken(token);

    if (previousUserId) {
      const { client, db } = createDatabase(process.env.DATABASE_URL!.trim(), { max: 1 });
      try {
        const row = await db.query.users.findFirst({
          where: eq(users.id, previousUserId),
          columns: { identitySubject: true, email: true, displayName: true },
        });
        if (row?.identitySubject?.trim() === profile.sub) {
          if (json) {
            return jsonOk({
              ok: true,
              unchanged: true,
              user: {
                id: profile.sub,
                email: profile.email,
                name: row.displayName || profile.name,
              },
            });
          }
          const response = redirectHome(origin, bindReturnPath(returnTo, profile.sub));
          response.cookies.delete(ORGANIZATION_COOKIE);
          return response;
        }
      } finally {
        await client.end();
      }
    }

    const ctx = clientSecurityContext(request);
    const issued = await rebindProductSessionFromProfile({
      identitySubject: profile.sub,
      email: profile.email,
      name: profile.name,
      ...(previousSessionId && previousUserId ? { previousSessionId, previousUserId } : {}),
      ...(preferredOrganizationId ? { preferredOrganizationId } : {}),
      client: {
        ipHash: ctx.ipHash,
        userAgentHash: ctx.userAgentHash,
        countryCode: ctx.countryCode,
      },
    });

    if (json) {
      return jsonOk(
        { ok: true, user: { id: profile.sub, email: profile.email, name: profile.name } },
        (response) => setSessionCookies(response, issued),
      );
    }

    const response = redirectHome(origin, bindReturnPath(returnTo, profile.sub));
    response.cookies.delete(ORGANIZATION_COOKIE);
    setSessionCookies(response, issued);
    return response;
  } catch {
    if (json) {
      const response = NextResponse.json({ ok: false, error: 'rebind' }, { status: 401 });
      response.cookies.set({
        name: 'bhd_r_session',
        value: '',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
      response.cookies.delete(ORGANIZATION_COOKIE);
      return response;
    }
    const response = NextResponse.redirect(
      new URL(
        `/api/auth/bhd/logout?continue=${encodeURIComponent(`/api/auth/bhd/start?returnTo=${encodeURIComponent(returnTo)}`)}`,
        origin,
      ),
      303,
    );
    response.cookies.set({
      name: 'bhd_r_session',
      value: '',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    response.cookies.delete(ORGANIZATION_COOKIE);
    return response;
  }
}

export const POST = rebind;
export const GET = rebind;
