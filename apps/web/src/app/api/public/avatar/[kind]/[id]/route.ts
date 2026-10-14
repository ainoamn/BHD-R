import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { readProfileImage } from '@/lib/profile-image-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ kind: string; id: string }> };

/** GET /api/public/avatar/:kind/:id — an account picture or organization logo its owner chose. */
export async function GET(request: Request, context: Context) {
  const { kind, id } = await context.params;
  if (!hasDatabaseUrl() || (kind !== 'user' && kind !== 'organization')) {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const image = await readProfileImage(kind, id);
    if (!image)
      return new NextResponse(null, {
        status: 404,
        headers: { 'cache-control': 'public, max-age=300' },
      });
    const versioned = new URL(request.url).searchParams.has('v');
    return new NextResponse(new Uint8Array(image.bytes), {
      headers: {
        'content-type': image.mime,
        'cache-control': versioned
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=300, stale-while-revalidate=3600',
        'last-modified': image.updatedAt.toUTCString(),
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('avatar read failed', error);
    return new NextResponse(null, { status: 404 });
  }
}
