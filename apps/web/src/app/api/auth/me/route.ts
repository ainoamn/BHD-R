import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { createDatabase, users } from '@bhd-r/db';
import {
  ROSTER_COOKIE,
  inferProviders,
  readRosterCookie,
  upsertRoster,
  type RosterAccount,
} from '@/lib/bhd/account-roster';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { getShellViewer } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me — marketing chrome auth from Host-only `bhd_r_session`.
 * Cookie read only (BHD-SESSION-POLICY): no Set-Cookie here.
 * `accounts` mirrors identity `bhd_id_roster` for the header multi-account list.
 */
export async function GET() {
  try {
    const viewer = await getShellViewer();
    if (!viewer) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const cookieStore = await cookies();
    let accounts = readRosterCookie(cookieStore.get(ROSTER_COOKIE)?.value);
    let currentSub: string | null = null;

    if (hasDatabaseUrl() && viewer.id) {
      try {
        const { client, db } = createDatabase(process.env.DATABASE_URL!.trim(), { max: 1 });
        try {
          const row = await db.query.users.findFirst({
            where: eq(users.id, viewer.id),
            columns: {
              identitySubject: true,
              displayName: true,
              email: true,
              username: true,
              credentialHash: true,
            },
          });
          currentSub = row?.identitySubject?.trim() || null;
          if (currentSub) {
            const prior = accounts.find((item) => item.sub === currentSub);
            const self: RosterAccount = {
              sub: currentSub,
              name: row?.displayName || viewer.displayName,
              email: (row?.email || viewer.email || '').toLowerCase(),
              username: row?.username || viewer.username || null,
              phone: prior?.phone || null,
              picture: prior?.picture || null,
              providers: inferProviders({
                picture: prior?.picture ?? null,
                ...(prior?.providers ? { providers: prior.providers } : {}),
                hasPassword: Boolean(row?.credentialHash),
              }),
            };
            accounts = upsertRoster(accounts, self);
          }
        } finally {
          await client.end();
        }
      } catch {
        /* roster from cookie alone */
      }
    }

    if (!currentSub && accounts.length === 1) {
      currentSub = accounts[0]!.sub;
    } else if (!currentSub && viewer.email) {
      const email = viewer.email.trim().toLowerCase();
      const match = accounts.find((item) => item.email && item.email === email);
      currentSub = match?.sub ?? null;
    }

    return NextResponse.json({
      authenticated: true,
      ...viewer,
      currentSub,
      accounts,
    });
  } catch (error) {
    console.error('[auth/me] failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}
