import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { fetchIdentityAccountFile } from '@/lib/identity/account-bridge';
import { elevatedTx, rowsOf } from '@/lib/elevated-db';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { requireScope } from '@/lib/site-admin-neon';
import { ADMIN_ERROR_CODES, adminErrorBody } from '@/lib/site-admin-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set([
  'civil_id',
  'passport',
  'commercial_register',
  'authorization_letter',
]);

/** GET /api/site-admin/users/:id/identity-file?kind= — proxy Identity account attachment. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  const { userId } = await params;
  const kind = new URL(request.url).searchParams.get('kind')?.trim() || '';
  if (!UUID.test(userId) || !KINDS.has(kind)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE });
  }

  try {
    const claims = await requireLiveSession(request);
    const subject = await elevatedTx(async (tx) => {
      await requireScope(tx, claims, 'users');
      const [row] = rowsOf<{ identity_subject: string | null }>(
        await tx.execute(sql`
          select identity_subject from users where id = ${userId}::uuid limit 1
        `),
      );
      return row?.identity_subject?.trim() || null;
    }, 8_000);

    if (!subject) {
      return NextResponse.json({ error: 'identity_unlinked' }, { status: 404, headers: NO_STORE });
    }

    const file = await fetchIdentityAccountFile(subject, kind);
    if (!file) {
      return NextResponse.json({ error: 'file_not_found' }, { status: 404, headers: NO_STORE });
    }

    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': file.mime,
        'Content-Disposition': `inline; filename="${encodeURIComponent(file.filename)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof Error && ADMIN_ERROR_CODES.has(error.message)) {
      const failed = adminErrorBody(error.message);
      return NextResponse.json(failed.body, { status: failed.status, headers: NO_STORE });
    }
    const mapped = guardErrorResponse(error);
    if (mapped.status >= 500) {
      console.error('GET /api/site-admin/users/:id/identity-file', error);
    }
    return NextResponse.json(mapped.body, { status: mapped.status, headers: NO_STORE });
  }
}
