import type { NextResponse } from 'next/server';
import { identitySessionMaxAgeSecCached } from '@/lib/bhd/runtime';
import { secureCookies } from '@/lib/bhd/oauth';

/** Organization last chosen on this device; sign-in lands there when still a member. */
export const ORGANIZATION_COOKIE = 'bhd_r_org';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function rememberedOrganization(value: string | undefined): string | undefined {
  return value && UUID.test(value) ? value : undefined;
}

export function setSessionCookies(
  response: NextResponse,
  issued: { token: string; csrf: string; claims: { organizationId: string | null } },
) {
  response.cookies.set({
    name: 'bhd_r_session',
    value: issued.token,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: identitySessionMaxAgeSecCached(),
  });
  response.cookies.set({
    name: 'bhd_r_csrf',
    value: issued.csrf,
    httpOnly: false,
    secure: secureCookies(),
    sameSite: 'strict',
    path: '/',
    maxAge: identitySessionMaxAgeSecCached(),
  });
  if (!issued.claims.organizationId) return;
  response.cookies.set({
    name: ORGANIZATION_COOKIE,
    value: issued.claims.organizationId,
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
