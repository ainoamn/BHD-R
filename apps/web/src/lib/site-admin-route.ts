import 'server-only';
import { NextResponse } from 'next/server';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { ADMIN_ERROR_CODES, adminErrorBody } from '@/lib/site-admin-shared';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function failure(error: unknown, label: string) {
  if (error instanceof Error && ADMIN_ERROR_CODES.has(error.message)) {
    const failed = adminErrorBody(error.message);
    return NextResponse.json(failed.body, { status: failed.status, headers: NO_STORE });
  }
  const mapped = guardErrorResponse(error);
  if (mapped.status >= 500) console.error(label, error);
  return NextResponse.json(mapped.body, { status: mapped.status, headers: NO_STORE });
}

/** Runs a site-admin handler; known admin errors map to clear bilingual messages. */
export async function siteAdminRoute(
  label: string,
  work: () => Promise<unknown>,
): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    return NextResponse.json(await work(), { headers: NO_STORE });
  } catch (error) {
    return failure(error, label);
  }
}

/** Read-only handlers: a live session is enough. */
export function siteAdminRead(
  request: Request,
  label: string,
  work: (claims: SessionClaims) => Promise<unknown>,
): Promise<NextResponse> {
  return siteAdminRoute(label, async () => work(await requireLiveSession(request)));
}

export async function readJson<T>(request: Request, parse: (value: unknown) => T): Promise<T> {
  try {
    return parse(await request.json());
  } catch {
    throw new Error('invalid_body');
  }
}
