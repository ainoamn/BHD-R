import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { bakeBrandWatermark } from '@/lib/bake-brand-watermark';
import { loadPublicPropertyMediaBytes } from '@/lib/load-public-property-neon';
import {
  assertRouteRateLimit,
  clientIp,
  hashRateKey,
} from '@/lib/route-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/public/media/:assetId — stream gallery images (brand mark baked into bytes). */
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
    const media = await loadPublicPropertyMediaBytes(assetId);
    if (!media) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    if (!media.mimeType.startsWith('image/')) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    if (media.bytes.byteLength > 12 * 1024 * 1024) {
      return NextResponse.json({ error: { code: 'too_large' } }, { status: 413 });
    }
    const watermarked = await bakeBrandWatermark(media.bytes, media.mimeType);
    return new NextResponse(new Uint8Array(watermarked.bytes), {
      status: 200,
      headers: {
        'content-type': watermarked.mimeType,
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
        'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    console.error('GET /api/public/media failed', error);
    return NextResponse.json({ error: { code: 'read_failed' } }, { status: 500 });
  }
}
