import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { verifySessionToken } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { loadUnitMediaBytes } from '@/lib/upload-property-media-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function sessionSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.BHD_R_SESSION_SECRET ?? 'development-session-secret-at-least-32-characters',
  );
}

/** GET /api/owner/media/:assetId — stream stored property media for the signed-in org. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }

  let claims: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    claims = await verifySessionToken(token, sessionSecret());
  } catch {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }

  const { assetId } = await context.params;
  if (!assetId || assetId.length < 32) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  try {
    const media = await loadUnitMediaBytes(claims, assetId);
    if (!media) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(media.bytes), {
      status: 200,
      headers: {
        'content-type': media.mimeType,
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('GET /api/owner/media failed', error);
    return NextResponse.json({ error: { code: 'read_failed' } }, { status: 500 });
  }
}
