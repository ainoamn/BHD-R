import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { readStayHandoverDocumentOnNeon } from '@/lib/stay-arrival-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/owner/properties/:propertyId/records/handover/:bookingId
 * Photo of the recipient's ID taken at check-in; booking managers of the property only.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ propertyId: string; bookingId: string }> },
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }
  const { propertyId, bookingId } = await context.params;
  if (!UUID.test(propertyId) || !UUID.test(bookingId)) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  try {
    const claims = await requireLiveSession(request);
    const found = await readStayHandoverDocumentOnNeon(claims, propertyId, bookingId);
    if (!found) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(found.bytes), {
      headers: {
        'Content-Type': found.mimeType,
        'Content-Length': String(found.bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="handover-id.${found.mimeType.split('/')[1]}"`,
      },
    });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    if (mapped.status >= 500) console.error('GET /api/owner/properties/records/handover', error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
