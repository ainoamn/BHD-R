import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadPublicPropertyMediaBytes } from '@/lib/load-public-property-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/public/media/:assetId — stream gallery images for public property pages. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  const { assetId } = await context.params;
  try {
    const media = await loadPublicPropertyMediaBytes(assetId);
    if (!media) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(media.bytes), {
      status: 200,
      headers: {
        'content-type': media.mimeType,
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('GET /api/public/media failed', error);
    return NextResponse.json({ error: { code: 'read_failed' } }, { status: 500 });
  }
}
