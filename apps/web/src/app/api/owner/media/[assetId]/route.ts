import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { verifySessionToken } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { requireSessionSecret } from '@/lib/runtime-env';
import { deleteUnitMediaAsset, loadUnitMediaBytes } from '@/lib/upload-property-media-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function sessionSecret(): Uint8Array {
  return requireSessionSecret();
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
        'cache-control': 'private, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    console.error('GET /api/owner/media failed', error);
    return NextResponse.json({ error: { code: 'read_failed' } }, { status: 500 });
  }
}

/** DELETE /api/owner/media/:assetId — permanently remove a gallery/attachment asset. */
export async function DELETE(
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
  if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  try {
    const removed = await deleteUnitMediaAsset(claims, assetId);
    if (!removed) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    return NextResponse.json({ ok: true, assetId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'delete_failed';
    if (message === 'forbidden') {
      return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
    }
    console.error('DELETE /api/owner/media failed', error);
    return NextResponse.json({ error: { code: 'delete_failed', message } }, { status: 500 });
  }
}
