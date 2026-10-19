import { NextResponse } from 'next/server';
import { accountingErrorResponse } from '@/lib/accounting-gl-http';
import { getAccountingSettings, setAccountingSettings } from '@/lib/accounting-gl-neon';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/owner/accounting/settings — org VAT, taxes, FX, integrity flags. */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    return NextResponse.json(
      { settings: await getAccountingSettings(claims) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return accountingErrorResponse(error, 'GET /api/owner/accounting/settings');
  }
}

/** PUT /api/owner/accounting/settings — save accounting policy (manage only). */
export async function PUT(request: Request) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  try {
    const claims = await requireLiveSession(request);
    const body = await request.json().catch(() => null);
    return NextResponse.json({ settings: await setAccountingSettings(claims, body) });
  } catch (error) {
    return accountingErrorResponse(error, 'PUT /api/owner/accounting/settings');
  }
}
