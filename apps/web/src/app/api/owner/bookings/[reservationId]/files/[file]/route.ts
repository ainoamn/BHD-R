import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readReservationFileForStaff } from '@/lib/lease-reservation-lifecycle-neon';
import { readClaims } from '@/lib/portal-ops-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const FILE =
  /^(?:signature|id-front|id-back|selfie|contract-signature|party-civil-id|party-passport|party-cr|doc-[a-z0-9_]{2,40}|cheque-[a-z0-9_.-]{2,80}|handover-recipient|handover-[0-5]|defect-[0-5])$/;

/**
 * GET /api/owner/bookings/:reservationId/files/:file
 * E-signature captures (signature, ID front/back, selfie), the tenant's contract signature,
 * and documents the customer sent (`doc-<code>`) for a website rent / purchase booking.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ reservationId: string; file: string }> },
) {
  const { reservationId, file } = await context.params;
  if (!hasDatabaseUrl() || !FILE.test(file)) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  const claims = await readClaims();
  if (!claims) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });

  try {
    const found = await readReservationFileForStaff(claims, reservationId, file);
    if (!found) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    const extension = found.mimeType === 'application/pdf' ? 'pdf' : found.mimeType.split('/')[1];
    const safeName = `${file}.${extension}`;
    return new NextResponse(new Uint8Array(found.bytes), {
      headers: {
        'Content-Type': found.mimeType,
        'Content-Length': String(found.bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Content-Security-Policy':
          "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      },
    });
  } catch (error) {
    console.error('GET /api/owner/bookings/files failed', error);
    return NextResponse.json({ error: { code: 'load_failed' } }, { status: 500 });
  }
}
