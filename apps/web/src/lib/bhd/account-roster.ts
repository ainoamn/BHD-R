import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextResponse } from 'next/server';
import { PRODUCT_SESSION_MAX_AGE_SECONDS } from '@bhd-r/authz';
import {
  asProviders,
  inferProviders,
  type RosterAccount,
} from '@/lib/bhd/account-roster-shared';
import { secureCookies } from '@/lib/bhd/oauth';
import { requireSessionSecret } from '@/lib/runtime-env';

export {
  accountHandle,
  accountMeta,
  asProviders,
  inferProviders,
  type AuthProvider,
  type RosterAccount,
} from '@/lib/bhd/account-roster-shared';

/** Product-side mirror of identity `bhd_id_roster` — accounts that signed into BHD R here. */
export const ROSTER_COOKIE = 'bhd_r_roster';
export const MAX_ROSTER_ACCOUNTS = 8;

type RosterPayload = { v: 1; accounts: RosterAccount[] };

function sign(body: string): string {
  return createHmac('sha256', requireSessionSecret()).update(body).digest('base64url');
}

function pack(accounts: RosterAccount[]): string {
  const payload: RosterPayload = { v: 1, accounts: accounts.slice(0, MAX_ROSTER_ACCOUNTS) };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

function normalizeAccount(item: Partial<RosterAccount> & { sub: string }): RosterAccount {
  const picture = typeof item.picture === 'string' ? item.picture.slice(0, 500) : null;
  const providers = inferProviders({
    picture,
    providers: asProviders(item.providers),
  });
  return {
    sub: item.sub,
    name: (typeof item.name === 'string' ? item.name : '').slice(0, 120) || 'BHD',
    email: (typeof item.email === 'string' ? item.email : '').slice(0, 200).toLowerCase(),
    username:
      typeof item.username === 'string' && item.username.trim()
        ? item.username.trim().slice(0, 100)
        : null,
    phone:
      typeof item.phone === 'string' && item.phone.trim()
        ? item.phone.trim().slice(0, 40)
        : null,
    picture,
    providers: providers.length ? providers : (['password'] as RosterAccount['providers']),
  };
}

export function readRosterCookie(value: string | undefined): RosterAccount[] {
  if (!value || !value.includes('.')) return [];
  const [body, mac] = value.split('.');
  if (!body || !mac) return [];
  const expected = sign(body);
  try {
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return [];
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as RosterPayload;
    if (parsed.v !== 1 || !Array.isArray(parsed.accounts)) return [];
    return parsed.accounts
      .filter(
        (item): item is RosterAccount =>
          !!item && typeof item.sub === 'string' && item.sub.length >= 8,
      )
      .slice(0, MAX_ROSTER_ACCOUNTS)
      .map((item) => normalizeAccount(item));
  } catch {
    return [];
  }
}

export function mergeRosterAccount(
  prev: RosterAccount | undefined,
  next: RosterAccount,
): RosterAccount {
  return normalizeAccount({
    ...next,
    username: next.username || prev?.username || null,
    phone: next.phone || prev?.phone || null,
    picture: next.picture || prev?.picture || null,
    providers: inferProviders({
      picture: next.picture || prev?.picture,
      providers: [...(prev?.providers || []), ...(next.providers || [])],
    }),
  });
}

export function upsertRoster(accounts: RosterAccount[], next: RosterAccount): RosterAccount[] {
  const prev = accounts.find((item) => item.sub === next.sub);
  const merged = mergeRosterAccount(prev, next);
  const rest = accounts.filter((item) => item.sub !== next.sub);
  return [merged, ...rest].slice(0, MAX_ROSTER_ACCOUNTS);
}

export function setRosterCookie(response: NextResponse, accounts: RosterAccount[]) {
  response.cookies.set({
    name: ROSTER_COOKIE,
    value: pack(accounts),
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: PRODUCT_SESSION_MAX_AGE_SECONDS,
  });
}

export function clearRosterCookie(response: NextResponse) {
  response.cookies.set({
    name: ROSTER_COOKIE,
    value: '',
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
