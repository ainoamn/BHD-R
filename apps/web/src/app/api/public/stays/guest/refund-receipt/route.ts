import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { readGuestDepositTransferReceipt } from '@/lib/stay-deposit-settlement-docs-neon';
import { isStaysPublicSurfaceEnabled } from '@/lib/stays-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/**
 * GET /api/public/stays/guest/refund-receipt?ref=ST-…
 * Bank transfer slip for an executed deposit refund (same file the accountant uploaded).
 */
export async function GET(request: Request) {
  if (!isStaysPublicSurfaceEnabled() || !hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  const ref = new URL(request.url).searchParams.get('ref')?.trim() ?? '';
  if (ref.length < 4 || ref.length > 40) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  const limited = assertRouteRateLimit({
    key: hashRateKey(['guest-refund-receipt', clientIp(request), ref.toUpperCase()]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }
  try {
    const found = await readGuestDepositTransferReceipt(ref);
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
        'Content-Disposition': `inline; filename="transfer-receipt.${extension}"`,
      },
    });
  } catch (error) {
    console.error('GET /api/public/stays/guest/refund-receipt', error);
    return NextResponse.json({ error: { code: 'server_error' } }, { status: 500 });
  }
}
