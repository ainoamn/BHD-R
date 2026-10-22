import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readMaintenancePublic, readSitePagesPublic } from '@/lib/site-control-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/site/public-control — maintenance banner + page flags for the public shell. */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      {
        maintenance: { enabled: false, mode: 'banner', messageAr: '', messageEn: '' },
        pages: {},
      },
      { headers: { 'Cache-Control': 'public, max-age=15' } },
    );
  }
  try {
    const [maintenance, pages] = await Promise.all([
      readMaintenancePublic(),
      readSitePagesPublic(),
    ]);
    return NextResponse.json(
      {
        maintenance: {
          enabled: maintenance.enabled,
          mode: maintenance.mode,
          messageAr: maintenance.messageAr,
          messageEn: maintenance.messageEn,
        },
        pages: pages.pages,
      },
      { headers: { 'Cache-Control': 'private, max-age=20' } },
    );
  } catch {
    return NextResponse.json(
      {
        maintenance: { enabled: false, mode: 'banner', messageAr: '', messageEn: '' },
        pages: {},
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
