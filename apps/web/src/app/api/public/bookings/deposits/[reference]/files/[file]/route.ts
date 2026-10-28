import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readReservationFileForTenant } from '@/lib/lease-reservation-lifecycle-neon';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const FILE =
  /^(?:signature|id-front|id-back|selfie|party-civil-id|party-passport|party-cr|doc-[a-z0-9_]{2,40}|cheque-[a-z0-9_.-]{2,80})$/i;

/**
 * GET /api/public/bookings/deposits/:reference/files/:file
 * Tenant preview of a document (`doc-<code>`) or cheque photo (`cheque-<key>`).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ reference: string; file: string }> },
) {
  if (!hasDatabaseUrl()) return new NextResponse(null, { status: 503 });
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const { reference, file } = await context.params;
  if (!FILE.test(file)) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });

  try {
    const found = await readReservationFileForTenant(claims, reference, file);
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
          "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; frame-src 'self' blob:",
      },
    });
  } catch (error) {
    console.error('GET /api/public/bookings/deposits/files failed', error);
    return NextResponse.json({ error: { code: 'load_failed' } }, { status: 500 });
  }
}
