import { NextResponse } from 'next/server';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { guardErrorResponse, requireLiveSession } from '@/lib/next-route-guard';
import { readTenantRequestMedia } from '@/lib/tenant-requests-neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * GET /api/tenant/requests/:requestId/media/:mediaId — a photo or video added to a request, for the
 * tenant who sent it or the landlord's people who may see it. Answers byte ranges, which phone
 * browsers need before they play a video.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ requestId: string; mediaId: string }> },
) {
  if (!hasDatabaseUrl()) return new NextResponse(null, { status: 503 });
  let claims;
  try {
    claims = await requireLiveSession(request, { requireCsrf: false });
  } catch (error) {
    const mapped = guardErrorResponse(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const { requestId, mediaId } = await context.params;
  if (!UUID.test(requestId) || !UUID.test(mediaId)) return new NextResponse(null, { status: 404 });
  const media = await readTenantRequestMedia(claims, requestId, mediaId).catch((error) => {
    console.error('GET /api/tenant/requests/:id/media/:mediaId', error);
    return null;
  });
  if (!media) return new NextResponse(null, { status: 404 });

  const size = media.bytes.byteLength;
  const headers: Record<string, string> = {
    'content-type': media.mimeType,
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'; img-src 'self' data:; media-src 'self'",
    'x-content-type-options': 'nosniff',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    start = Math.max(0, start);
    if (start > end || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...headers, 'content-range': `bytes */${size}` },
      });
    }
    return new NextResponse(new Uint8Array(media.bytes.subarray(start, end + 1)), {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': String(end - start + 1),
      },
    });
  }
  return new NextResponse(new Uint8Array(media.bytes), {
    headers: { ...headers, 'content-length': String(size) },
  });
}
