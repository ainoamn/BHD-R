import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SessionClaims } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { SITE_ADMIN_LIMIT, claimErrorBody } from '@/lib/stay-deposit-claims';
import { loadSiteAdminSettings, saveSiteAdminSettings } from '@/lib/stay-deposit-claims-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    channel: z.enum(['email', 'whatsapp']),
    emails: z.array(z.string().max(160)).max(SITE_ADMIN_LIMIT),
    whatsapp: z.array(z.string().max(32)).max(SITE_ADMIN_LIMIT),
  })
  .strict();

const KNOWN = new Set(['forbidden', 'settings_invalid']);

function failure(error: unknown, label: string) {
  if (error instanceof Error && KNOWN.has(error.message)) {
    const failed = claimErrorBody(error.message);
    return NextResponse.json(failed.body, { status: failed.status });
  }
  const mapped = guardErrorResponse(error);
  if (mapped.status >= 500) console.error(label, error);
  return NextResponse.json(mapped.body, { status: mapped.status });
}

/** GET /api/site-admin/settings — who receives deposit complaints, and by email or WhatsApp. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    return NextResponse.json(
      { settings: await loadSiteAdminSettings(claims) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return failure(error, 'GET /api/site-admin/settings');
  }
}

/** PUT /api/site-admin/settings — change the complaint recipients or channel. */
export async function PUT(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  let claims: SessionClaims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    return failure(error, 'PUT /api/site-admin/settings');
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    const failed = claimErrorBody('invalid_body');
    return NextResponse.json(failed.body, { status: failed.status });
  }
  try {
    return NextResponse.json({ settings: await saveSiteAdminSettings(claims, body) });
  } catch (error) {
    return failure(error, 'PUT /api/site-admin/settings');
  }
}
