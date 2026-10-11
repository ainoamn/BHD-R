import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { organizationLiveVersion, stayBookingLiveVersion } from '@/lib/live-changes-neon';
import { readClaims } from '@/lib/portal-ops-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^[A-Z0-9-]{4,40}$/i;
const HEADERS = { 'Cache-Control': 'private, no-store' };

/**
 * GET /api/live/pulse — change version for live sync.
 * - `?booking=<id>&ref=<code>`: one stay booking (guest page, no sign-in needed).
 * - otherwise: the signed-in viewer's organization.
 * `v: null` means live sync is unavailable; clients then back off.
 */
export async function GET(request: Request) {
  if (!hasDatabaseUrl()) return NextResponse.json({ v: null }, { headers: HEADERS });
  const url = new URL(request.url);
  const booking = url.searchParams.get('booking');
  const reference = url.searchParams.get('ref');

  try {
    if (booking || reference) {
      if (!booking || !reference || !UUID.test(booking) || !REFERENCE.test(reference)) {
        return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 });
      }
      const v = await stayBookingLiveVersion(booking, reference);
      return NextResponse.json({ v }, { headers: HEADERS });
    }

    const claims = await readClaims();
    if (!claims) {
      return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
    }
    if (!claims.organizationId) return NextResponse.json({ v: null }, { headers: HEADERS });
    const v = await organizationLiveVersion(claims.organizationId);
    return NextResponse.json({ v }, { headers: HEADERS });
  } catch (error) {
    console.error('GET /api/live/pulse failed', error);
    return NextResponse.json({ v: null }, { status: 503, headers: HEADERS });
  }
}
