import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { clientSafeErrorCode, statusForSafeCode } from '@/lib/client-safe-error';
import { deleteMediaAssetNestOrNeon } from '@/lib/nest-or-neon-write';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { assertRouteRateLimit, clientIp, hashRateKey } from '@/lib/route-rate-limit';
import { loadUnitMediaBytes } from '@/lib/upload-property-media-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/owner/media/:assetId — stream stored property media for the signed-in org. */
export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request);
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
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

/** DELETE /api/owner/media/:assetId — Nest-first with Neon+S3 fallback. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: true });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const limited = assertRouteRateLimit({
    key: hashRateKey(['owner-media-delete', claims.sub, clientIp(request)]),
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited' } },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } },
    );
  }

  const { assetId } = await context.params;
  if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }

  try {
    const result = await deleteMediaAssetNestOrNeon(
      claims,
      assetId,
      request.headers.get('x-csrf-token'),
    );
    return NextResponse.json({ ok: true, assetId: result.assetId, via: result.via });
  } catch (error) {
    const code = clientSafeErrorCode(error, 'delete_failed');
    return NextResponse.json({ error: { code } }, { status: statusForSafeCode(code) });
  }
}
