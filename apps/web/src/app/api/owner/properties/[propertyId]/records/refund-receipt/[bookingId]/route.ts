import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { readDepositRefundReceiptOnNeon } from '@/lib/stay-deposit-refund-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/owner/properties/:propertyId/records/refund-receipt/:bookingId
 * Transfer receipt of a stay's deposit refund; booking managers, refund approvers and
 * accountants of the property only.
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
    const found = await readDepositRefundReceiptOnNeon(claims, propertyId, bookingId);
    if (!found) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    const extension = found.mimeType === 'application/pdf' ? 'pdf' : found.mimeType.split('/')[1];
    return new NextResponse(new Uint8Array(found.bytes), {
      headers: {
        'Content-Type': found.mimeType,
        'Content-Length': String(found.bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="refund-receipt.${extension}"`,
      },
    });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    if (mapped.status >= 500)
      console.error('GET /api/owner/properties/records/refund-receipt', error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
