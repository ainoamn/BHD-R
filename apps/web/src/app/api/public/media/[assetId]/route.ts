import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { resolvePublicPropertyMediaDelivery } from '@/lib/load-public-property-neon';
import {
  assertRouteRateLimit,
  clientIp,
  hashRateKey,
} from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 20;

/**
 * GET /api/public/media/:assetId — public gallery images.
 * Prefer 307 → short-lived R2/S3 signed URL so bytes skip the Vercel origin hop.
 * Inline Neon blobs still stream through this route.
 * Brand mark is CSS `.media-watermark` only (avoids double watermark with bake).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['public-media', clientIp(request)]),
    limit: 120,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const { assetId } = await context.params;
  try {
    const media = await resolvePublicPropertyMediaDelivery(assetId);
    if (!media) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    if (!media.mimeType.startsWith('image/')) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }

    if (media.kind === 'redirect') {
      // Cache redirect briefly at the edge; signed URL lasts ~1h.
      return NextResponse.redirect(media.url, {
        status: 307,
        headers: {
          'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
          vary: 'Accept',
        },
      });
    }

    if (media.bytes.byteLength > 12 * 1024 * 1024) {
      return NextResponse.json({ error: { code: 'too_large' } }, { status: 413 });
    }
    return new NextResponse(new Uint8Array(media.bytes), {
      status: 200,
      headers: {
        'content-type': media.mimeType,
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
        'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    console.error('GET /api/public/media failed', error);
    return NextResponse.json({ error: { code: 'read_failed' } }, { status: 500 });
  }
}
